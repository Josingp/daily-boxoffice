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
    const { movieName, trendData, movieInfo, currentAudiAcc, predictionSeries, predictedFinalAudi, comparison } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // 트렌드 요약 (최근 5일 + 오늘)
    const trendSummary = trendData.slice(-6).map(d => 
      `${d.dateDisplay}: ${d.audiCnt}명`
    ).join(", ");

    const genre = movieInfo.genres?.join(", ") || "Unknown";
    
    // [NEW] 비교 리포트용 문구 생성
    let comparisonText = "정보 없음";
    if (comparison) {
        const diffStr = comparison.diff > 0 ? `+${comparison.diff}` : `${comparison.diff}`;
        comparisonText = `Today(${comparison.today}명) vs Yesterday(${comparison.yesterday}명) -> Change: ${diffStr}명 (${comparison.rate}%)`;
    }

    const prompt = `
    [Role]
    Korean Box Office Analyst.

    [Data]
    - Movie: ${movieName} (${genre})
    - Open Date: ${movieInfo.openDt}
    - Total Audience: ${currentAudiAcc}
    - Recent Trend (End is Today): ${trendSummary}
    - [IMPORTANT] Real-time Comparison: ${comparisonText}

    [Task]
    1. Analyze the box office trend (Rising/Falling/Stable).
    2. [IMPORTANT] Specifically mention the difference between today (Real-time) and yesterday. (e.g., "전일 대비 약 20% 상승했습니다")
    3. Predict the potential for the next few days.
    4. Write in Korean (Natural, 3-5 sentences).
    5. Plain text only (No markdown).
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", 
      contents: { parts: [{ text: prompt }] }
    });

    const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "분석 결과를 불러올 수 없습니다.";
    
    // 예측값 시리즈 생성 (간단한 로직: 최근 3일 평균으로 미래 예측)
    const lastVal = comparison ? comparison.today : (trendData[trendData.length - 1]?.audiCnt || 0);
    const mockPrediction = [
        Math.floor(lastVal * 0.9), 
        Math.floor(lastVal * 0.85), 
        Math.floor(lastVal * 0.8)
    ];

    return res.status(200).json({
      analysisText: text.trim(),
      predictedFinalAudi: predictedFinalAudi || { min: 0, max: 0, avg: 0 },
      predictionSeries: mockPrediction, // 간단 예측값
      logicFactors: {},
      similarMovies: []
    });

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(200).json({ 
      analysisText: "AI 분석 서버 연결 실패 (잠시 후 다시 시도해주세요)",
      error: error.message 
    });
  }
}
