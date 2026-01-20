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
    const { movieName, trendData, movieInfo, currentAudiAcc, type } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // 1.5 Flash 모델 사용 (안정성 확보)
    const prompt = `
    Role: Box Office Analyst.
    Target: ${movieName} (${type}).
    Status: Total ${currentAudiAcc || 0}.
    
    Task:
    Analyze the current trend and write a 3-paragraph Korean report (Status, Analysis, Outlook).
    Predict 3-day numbers. Provide 2 search keywords.

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
    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch {
      // 파싱 실패시 기본값
      result = { 
          analysis: "현재 AI 분석 서버 연결 상태가 원활하지 않아 간략한 정보만 표시합니다. (데이터 집계 중)", 
          forecast: [0, 0, 0] 
      };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    return res.status(200).json({ 
      analysisText: `AI 분석 요청 실패 (잠시 후 다시 시도해주세요)`, 
      predictionSeries: [0, 0, 0]
    });
  }
}
