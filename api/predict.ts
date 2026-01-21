import { GoogleGenAI } from "@google/genai";

const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
};

export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API Key Missing" });

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // [수정] 데이터 안전 처리 (historyData가 배열일 때만 slice 호출)
    const recentTrend = Array.isArray(trendData) && trendData.length > 0
      ? trendData.slice(-7).map((d: any) => `[${d.dateDisplay}] Audi: ${d.audiCnt}, Sales: ${d.salesAmt}`).join("\n")
      : "No daily trend data";

    const realtimeTrend = Array.isArray(historyData) && historyData.length > 0
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank: ${d.rank}, Rate: ${d.rate}%, Audi: ${d.val_audi}`).join("\n")
      : "No realtime data";

    const prompt = `
    Role: Senior Data Scientist & Box Office Analyst.
    
    Target Movie: "${movieName}"
    Current Status: Total Audience ${currentAudiAcc}
    
    Input Data (Daily Trend - Last 7 days):
    ${recentTrend}

    Input Data (Realtime Trend - Last 10 records):
    ${realtimeTrend}

    Task:
    1. **Mathematical Analysis**: Calculate the momentum based on the provided data.
    2. **Forecast Algorithm**: Predict the audience numbers for the next 3 days (Day+1, Day+2, Day+3).
    3. **Report Generation**: Write a professional 3-paragraph report in Korean:
       - **Paragraph 1 (Status & Momentum)**: Analyze current performance using specific metrics.
       - **Paragraph 2 (Audience Psychology)**: Interpret the data to explain trends.
       - **Paragraph 3 (Future Outlook)**: Provide the strategic forecast.
    
    Output JSON Schema:
    {
      "analysis": "String (Korean report with emojis)",
      "forecast": [Number, Number, Number],
      "keywords": ["String", "String"]
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", 
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    let text = "{}";
    if (response.candidates && response.candidates.length > 0) {
        text = response.candidates[0].content?.parts?.[0]?.text || "{}";
    } else if (typeof (response as any).text === 'function') {
        text = (response as any).text() || "{}";
    }

    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch {
      result = { analysis: "데이터 부족으로 분석할 수 없습니다.", forecast: [0, 0, 0], keywords: [] };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error: any) {
    console.error("AI Error:", error);
    return res.status(200).json({ 
      analysisText: `분석 서버 오류: ${error.message}`, 
      predictionSeries: [0, 0, 0]
    });
  }
}
