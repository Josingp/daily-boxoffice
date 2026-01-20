import { GoogleGenAI } from "@google/genai";

const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
};

export default async function handler(req, res) {
  // CORS (생략)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Key Missing" });

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // [1] 데이터 전처리 알고리즘 (AI에게 떠먹여줄 데이터 생성)
    let analysisContext = "";
    
    if (type === 'REALTIME' && historyData && historyData.length > 1) {
        // 실시간: 최근 5분/1시간 변화량 계산
        const latest = historyData[historyData.length - 1];
        const prev = historyData[historyData.length - 2];
        const diff = latest.val_audi - prev.val_audi;
        const trend = diff > 0 ? "Increasing" : diff < 0 ? "Decreasing" : "Stable";
        
        analysisContext = `
        [Realtime Data Analysis]
        - Latest Update: ${latest.time}
        - Current Reservations: ${latest.audiCnt} people (${latest.rate})
        - Change since last update (${prev.time}): ${diff > 0 ? '+' : ''}${diff} people
        - Trend Direction: ${trend}
        `;
    } else if (type === 'DAILY' && trendData && trendData.length > 0) {
        // 일별: 최근 3일 추이 및 총계
        const recent = trendData.slice(-3);
        const summary = recent.map(d => `${d.dateDisplay}: ${d.audiCnt} (Sales: ${d.salesAmt})`).join(", ");
        analysisContext = `
        [Daily Trend Analysis]
        - Recent 3 Days: ${summary}
        - Total Audience: ${currentAudiAcc}
        `;
    }

    // [2] 프롬프트 엔지니어링
    const prompt = `
    Role: Professional Film Market Analyst.
    Target Movie: ${movieName}
    Context: ${type} Box Office.
    
    [Statistical Data Provided by System]
    ${analysisContext}

    Task:
    1. Analyze the data above. Specifically mention the time and numbers (e.g., "Compared to 14:00, reservations increased by 500").
    2. Write a 3-paragraph report in Korean:
       - Current Status (Fact-based)
       - Trend Analysis (Why is it moving?)
       - Prediction (Short-term outlook)
    3. Predict audience numbers for the next 3 days.

    Output JSON ONLY:
    {
      "analysis": "Korean text...",
      "forecast": [0,0,0],
      "keywords": ["key1", "key2"]
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", 
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    let text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result = JSON.parse(cleanJsonString(text));

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    return res.status(200).json({ 
      analysisText: "데이터 부족으로 분석을 완료할 수 없습니다.", 
      predictionSeries: [0, 0, 0] 
    });
  }
}
