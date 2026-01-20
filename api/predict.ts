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

    // 실시간 분석일 경우 historyData 활용하여 증감 계산
    let trendAnalysis = "";
    if (type === 'REALTIME' && historyData && historyData.length > 1) {
        const last = historyData[historyData.length-1];
        const prev = historyData[historyData.length-2];
        const diff = (last.val_audi || 0) - (prev.val_audi || 0);
        trendAnalysis = `Compared to ${prev.time}, reservations changed by ${diff > 0 ? '+' : ''}${diff} people.`;
    }

    const prompt = `
    Role: Box Office Analyst.
    Target: ${movieName} (${type}).
    Status: Total ${currentAudiAcc}.
    ${trendAnalysis}
    
    Task:
    1. Analyze the trend (${type}). Mention specific numbers (increase/decrease).
    2. Write a 3-paragraph Korean report (Status, Analysis, Outlook).
    3. Predict 3-day numbers. Provide 2 keywords.

    Output JSON ONLY:
    {
      "analysis": "Korean text...",
      "forecast": [0,0,0],
      "keywords": ["a", "b"]
    }
    `;
    
    // [수정 1] SDK 버전에 맞는 파라미터 구조 (config 사용)
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", 
      contents: [{ parts: [{ text: prompt }] }], // contents는 배열이어야 안전함
      config: { responseMimeType: "application/json" } // generationConfig -> config
    });

    // [수정 2] 응답 객체 구조 변경 대응 (response.response 제거)
    // 최신 SDK에서는 response 자체가 결과를 담고 있거나 candidates에 바로 접근합니다.
    let text = "{}";
    if (response.candidates && response.candidates.length > 0) {
        text = response.candidates[0].content?.parts?.[0]?.text || "{}";
    } else if (typeof response.text === 'function') {
        text = response.text() || "{}";
    }

    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch {
      result = { analysis: "분석 데이터를 생성하는 중입니다.", forecast: [0, 0, 0] };
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
      analysisText: `분석 실패: ${error.message || "알 수 없는 오류"}`, 
      predictionSeries: [0, 0, 0]
    });
  }
}
