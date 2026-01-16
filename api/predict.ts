import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server API Key Missing" });
  }

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, predictionSeries, predictedFinalAudi } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    const trendSummary = trendData.slice(-7).map(d => 
      `${d.dateDisplay}: ${d.audiCnt}명`
    ).join(", ");

    const genre = movieInfo.genres?.map(g => g.genreNm).join(", ") || "Unknown";

    const prompt = `
    [Role]
    Korean Box Office Analyst.

    [Data]
    - Movie: ${movieName} (${genre})
    - Open: ${movieInfo.openDt}
    - Total: ${currentAudiAcc}
    - Trend: ${trendSummary}

    [Task]
    Analyze the trend (rising/falling/stable).
    Predict box office potential.
    Write in Korean (3-5 sentences).
    Plain text only.
    `;

    // [확정] 사용자 요청 모델: gemini-3-flash-preview
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: { parts: [{ text: prompt }] }
    });

    const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "분석 결과가 비어있습니다.";
    
    return res.status(200).json({
      analysisText: text.trim(),
      predictedFinalAudi: predictedFinalAudi || { min: 0, max: 0, avg: 0 },
      predictionSeries: predictionSeries || [],
      logicFactors: {},
      similarMovies: []
    });

  } catch (error) {
    console.error("AI Error:", error);
    // 에러 발생 시에도 빈 값을 보내 프론트엔드 크래시 방지
    return res.status(200).json({ 
      analysisText: "AI 분석 서버 연결 실패 (잠시 후 다시 시도해주세요)",
      error: error.message 
    });
  }
}
