import { GoogleGenAI } from "@google/genai";

const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
};

export default async function handler(req, res) {
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

    // 실시간 분석일 경우 historyData 활용
    let historyContext = "";
    if (type === 'REALTIME' && historyData && historyData.length > 1) {
        const latest = historyData[historyData.length - 1];
        const prev = historyData[historyData.length - 2];
        historyContext = `Recent update: ${latest.time} (${latest.audiCnt} reservations). Prev: ${prev.time} (${prev.audiCnt}). Change: ${latest.audiCnt - prev.audiCnt}.`;
    }

    const prompt = `
    Role: Box Office Analyst.
    Target: ${movieName} (${type}).
    Data: ${historyContext || `Total Audi: ${currentAudiAcc}`}.
    
    Task:
    1. If Realtime: Analyze reservation audience count trend (Increasing/Decreasing?). Compare with previous time.
    2. If Daily: Analyze daily audience trend.
    3. Write 3 short Korean paragraphs.
    4. Predict next 3 days numbers.

    Output JSON ONLY:
    {
      "analysis": "Korean text...",
      "forecast": [0,0,0],
      "keywords": ["a", "b"]
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
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
      analysisText: "분석 데이터를 처리하는 중입니다.", 
      predictionSeries: [0, 0, 0]
    });
  }
}
