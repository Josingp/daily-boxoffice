import { GoogleGenAI } from "@google/genai";

// Vercel Serverless Function (Node.js)
export default async function handler(req, res) {
  // CORS 설정 (필수)
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

    // 데이터 요약
    const trendSummary = trendData.slice(-7).map(d => 
      `${d.dateDisplay}: 관객 ${d.audiCnt}, 스크린 ${d.scrnCnt || 0}`
    ).join("\n");

    const genre = movieInfo.genres?.map(g => g.genreNm).join(", ") || "Unknown";

    const prompt = `
    [Role]
    You are a Korean Box Office Analyst.

    [Data]
    - Movie: ${movieName} (${genre})
    - Released: ${movieInfo.openDt}
    - Total Audience: ${currentAudiAcc}
    - Recent Trend:
    ${trendSummary}

    [Task]
    Analyze the box office trend based on the data above.
    - Mention if the audience is increasing or decreasing (PSA).
    - Provide a short outlook for the next few days.
    - Write in Korean, concise (3-5 sentences).
    - Plain text only.
    `;

    // [중요] 사용자 요청 모델 사용
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: { parts: [{ text: prompt }] }
    });

    const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "분석을 완료할 수 없습니다.";
    
    return res.status(200).json({
      analysisText: text.trim(),
      predictedFinalAudi: predictedFinalAudi || { min: 0, max: 0, avg: 0 },
      predictionSeries: predictionSeries || [],
      logicFactors: {},
      similarMovies: []
    });

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(500).json({ error: error.message || "AI Error" });
  }
}
