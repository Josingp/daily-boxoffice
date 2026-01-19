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

    // [강력한 프롬프트]
    const prompt = `
    Role: Senior Box Office Analyst.
    Target: ${movieName} (${type}).
    Status: ${currentAudiAcc || 'N/A'}.
    
    Task:
    1. Analyze the current trend (${type === 'DAILY' ? 'Box Office' : 'Real-time Reservation'}).
    2. Write a detailed 3-paragraph Korean report (Status, Analysis, Prediction).
    3. Predict 3-day audience numbers.
    4. Provide 2 search keywords.

    Output JSON ONLY:
    {
      "analysis": "String",
      "forecast": [0,0,0],
      "keywords": ["a", "b"]
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // [요청하신 모델]
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    let text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch {
      result = { analysis: "분석 데이터를 처리하는 중입니다.", forecast: [0, 0, 0] };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    console.error("Gemini Error:", error);
    return res.status(200).json({ 
      analysisText: `AI 분석 실패: ${error.message}`, 
      predictionSeries: [0, 0, 0]
    });
  }
}
