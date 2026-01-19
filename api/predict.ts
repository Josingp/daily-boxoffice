import { GoogleGenAI } from "@google/genai";

const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
};

export default async function handler(req, res) {
  // CORS Setup
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
      // 에러 메시지를 클라이언트로 보냄
      return res.status(200).json({ 
          analysisText: "⚠️ 서버 설정 오류: Gemini API Key가 없습니다.", 
          predictionSeries: [0,0,0],
          predictedFinalAudi: {min:0,max:0,avg:0}
      });
  }

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // 간단 프롬프트 (오류 최소화)
    const prompt = `
    Role: Box Office Analyst.
    Task: Analyze "${movieName}" (${type}).
    Data: Current Audi ${currentAudiAcc}. Trend: ${JSON.stringify(trendData?.slice(-5) || [])}.
    
    Output JSON ONLY:
    {
      "analysis": "Write a 3-paragraph Korean analysis about current status, trend, and future outlook.",
      "forecast": [1000, 2000, 3000],
      "keywords": ["movie", "review"]
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", // 가장 안정적인 모델
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    let text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch (e) {
      console.error("JSON Parse Error", text);
      result = { 
          analysis: "AI 분석 결과를 처리하는 중 오류가 발생했습니다.\n(잠시 후 다시 시도해주세요)", 
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
    console.error("Gemini Error:", error);
    return res.status(200).json({ 
      analysisText: `❌ AI 분석 실패: ${error.message}`, 
      predictionSeries: [0, 0, 0],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });
  }
}
