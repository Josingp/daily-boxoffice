import { GoogleGenAI } from "@google/genai";

// Vercel Serverless Function (Node.js)
export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // API 키 확인
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server API Key Missing" });
  }

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, predictionSeries, predictedFinalAudi } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // [사용자 로직 적용] 데이터 가공
    const getDayName = (dateStr) => {
      const y = parseInt(dateStr.substring(0, 4));
      const m = parseInt(dateStr.substring(4, 6)) - 1;
      const d = parseInt(dateStr.substring(6, 8));
      const date = new Date(y, m, d);
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    };

    const getDaysSinceRelease = (currentDateStr, openDt) => {
      const y = parseInt(currentDateStr.substring(0, 4));
      const m = parseInt(currentDateStr.substring(4, 6)) - 1;
      const d = parseInt(currentDateStr.substring(6, 8));
      const current = new Date(y, m, d);
      const openStr = openDt.replace(/-/g, '');
      const oy = parseInt(openStr.substring(0, 4));
      const om = parseInt(openStr.substring(4, 6)) - 1;
      const od = parseInt(openStr.substring(6, 8));
      const open = new Date(oy, om, od);
      return Math.floor((current.getTime() - open.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    };

    const window = trendData.slice(-14);
    const enriched = window.map((d, idx) => {
      const scrn = d.scrnCnt ?? 0;
      const psa = scrn > 0 ? (d.audiCnt / scrn) : 0;
      const prev = idx > 0 ? window[idx - 1].audiCnt : 0;
      return {
        date: d.date,
        dow: getDayName(d.date),
        lifecycleDay: getDaysSinceRelease(d.date, movieInfo.openDt),
        audiCnt: d.audiCnt,
        scrnCnt: d.scrnCnt ?? 0,
        psa: Number(psa.toFixed(1)),
        growthPct: prev > 0 ? Number(((d.audiCnt - prev) / prev * 100).toFixed(1)) : null
      };
    });

    const genre = movieInfo.genres?.map(g => g.genreNm).join(", ") || "Unknown";

    const prompt = `
    You are a Korean box office analyst.

    TARGET:
    - title: ${movieName} (${genre})
    - openDt: ${movieInfo.openDt}
    - currentAudiAcc: ${currentAudiAcc}

    RECENT PERFORMANCE:
    ${JSON.stringify(enriched)}

    OFFICIAL FORECAST:
    - Next 3 Days: ${JSON.stringify(predictionSeries)}
    - Final Range: ${predictedFinalAudi ? JSON.stringify(predictedFinalAudi) : "N/A"}

    Write a concise Korean analysis (3~6 sentences) focusing on PSA, trend, and future outlook.
    Return plain text only.
    `;

    // [복구 완료] 사용자님이 원하시는 모델 사용
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: { parts: [{ text: prompt }] }
    });

    const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // 프론트엔드 호환용 JSON 반환
    return res.status(200).json({
      analysisText: text.trim(),
      predictedFinalAudi: predictedFinalAudi || { min: 0, max: 0, avg: 0 },
      predictionSeries: predictionSeries || [],
      logicFactors: {},
      similarMovies: []
    });

  } catch (error) {
    console.error("AI Error:", error);
    // 모델명을 틀렸거나 없는 경우 404가 뜹니다.
    return res.status(500).json({ error: error.message || "AI Processing Failed" });
  }
}
