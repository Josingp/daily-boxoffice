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
  if (!apiKey) return res.status(500).json({ error: "Server API Key Missing" });

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, type } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // [모델] gemini-1.5-flash (안정적)
    const prompt = `
    Role: Box Office Analyst.
    Target: ${movieName} (${type}).
    Status: Total ${currentAudiAcc}.
    
    Task:
    Analyze the trend and write a 3-paragraph Korean report (Status, Analysis, Outlook).
    Predict 3-day numbers. Provide 2 search keywords.

    Output JSON ONLY:
    {
      "analysis": "Korean text...",
      "forecast": [0,0,0],
      "keywords": ["a", "b"]
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash", 
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    let text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch {
      result = { analysis: "현재 분석 서버가 혼잡하여 데이터를 집계 중입니다.", forecast: [0, 0, 0] };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    return res.status(200).json({ 
      analysisText: `분석 실패: ${error.message}`, 
      predictionSeries: [0, 0, 0]
    });
  }
}
