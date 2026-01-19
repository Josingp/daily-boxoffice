import { GoogleGenAI } from "@google/genai";

// ------------------------------------------------------------------
// [Helper 1] 요일 구하기
// ------------------------------------------------------------------
const getDayName = (dateStr) => {
  if (!dateStr || dateStr.length !== 8) return '';
  const y = parseInt(dateStr.substring(0, 4));
  const m = parseInt(dateStr.substring(4, 6)) - 1;
  const d = parseInt(dateStr.substring(6, 8));
  const date = new Date(y, m, d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
};

// ------------------------------------------------------------------
// [Helper 2] 개봉 후 경과일 계산
// ------------------------------------------------------------------
const getDaysSinceRelease = (currentDateStr, openDt) => {
  if (!currentDateStr || !openDt) return 0;
  
  const y = parseInt(currentDateStr.substring(0, 4));
  const m = parseInt(currentDateStr.substring(4, 6)) - 1;
  const d = parseInt(currentDateStr.substring(6, 8));
  const current = new Date(y, m, d);

  const openStr = openDt.replace(/-/g, '');
  const oy = parseInt(openStr.substring(0, 4));
  const om = parseInt(openStr.substring(4, 6)) - 1;
  const od = parseInt(openStr.substring(6, 8));
  const open = new Date(oy, om, od);

  const diffTime = current.getTime() - open.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

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

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server API Key Missing" });
  }

  try {
    const { 
      movieName, 
      trendData, 
      movieInfo, 
      currentAudiAcc, 
      predictionSeries, 
      predictedFinalAudi,
      comparison // 클라이언트에서 보낸 실시간 비교 데이터
    } = req.body;

    const ai = new GoogleGenAI({ apiKey });

    // ---------------------------------------------------------
    // 1. 데이터 가공 (Enrichment) - 사용자 제공 로직 적용
    // ---------------------------------------------------------
    // 최근 14일 데이터만 사용
    const window = trendData.slice(-14);

    const enriched = window.map((d, idx) => {
      // 날짜 문자열 정제 (YYYYMMDD 형식 보장)
      const rawDate = d.date ? d.date.replace(/-/g, '') : '';
      
      const dayName = getDayName(rawDate);
      const lifecycleDay = getDaysSinceRelease(rawDate, movieInfo.openDt);

      const scrn = d.scrnCnt ?? 0;
      const psa = scrn > 0 ? (d.audiCnt / scrn) : 0;

      const prev = idx > 0 ? window[idx - 1].audiCnt : 0;
      const growth = prev > 0 ? ((d.audiCnt - prev) / prev * 100) : null;

      return {
        date: d.dateDisplay || d.date, // 화면용 날짜 우선
        dow: dayName,
        lifecycleDay,
        audiCnt: d.audiCnt,
        scrnCnt: d.scrnCnt ?? null,
        psa: Number(psa.toFixed(1)),
        growthPct: growth === null ? null : Number(growth.toFixed(1))
      };
    });

    const genre = movieInfo.genres?.join(", ") || "Unknown";

    // ---------------------------------------------------------
    // 2. 프롬프트 구성 (Prompt Engineering)
    // ---------------------------------------------------------
    const prompt = `
    You are a Korean box office analyst.

    IMPORTANT:
    - Do NOT invent numbers.
    - Use the provided predictionSeries as the official D+1~D+3 forecast.
    - If something is missing, say it is uncertain rather than guessing.

    TARGET:
    - Title: ${movieName} (${genre})
    - Open Date: ${movieInfo.openDt}
    - Current Total Audience: ${currentAudiAcc}
    
    [Real-time Status (Today vs Yesterday)]:
    ${comparison ? `Today: ${comparison.today} / Yesterday: ${comparison.yesterday} / Diff: ${comparison.diff} (${comparison.rate}%)` : "No real-time data"}

    RECENT PERFORMANCE (Last 14 days):
    ${JSON.stringify(enriched, null, 2)}

    OFFICIAL FORECAST (from deterministic model):
    - D+1~D+3 audience series: ${JSON.stringify(predictionSeries)}
    - final audience range (optional): ${predictedFinalAudi ? JSON.stringify(predictedFinalAudi) : "N/A"}

    Write a concise Korean analysis (3~6 sentences):
    - Analyze the trend based on PSA (Per Screen Average) and audience growth.
    - Mention risks related to day-of-week patterns (Weekend vs Weekday).
    - Comment on the lifecycle stage (opening week, holdover, declining) based on 'lifecycleDay'.
    - Incorporate the Real-time status if available.
    
    Return plain text only (no JSON, no markdown).
    `;

    // ---------------------------------------------------------
    // 3. Gemini 호출 (gemini-3-flash-preview 적용)
    // ---------------------------------------------------------
    console.log("Calling Gemini 3.0 Flash Preview...");
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // [주의] 3.0이 아직 불안정하다면 2.0-flash로 자동 폴백하거나 명시
      // 사용자 요청: gemini-3-flash-preview
      // 만약 404 에러가 나면 "gemini-1.5-flash" 또는 "gemini-2.0-flash"로 변경해주세요.
      // 현재 코드는 사용자 요청을 우선 반영합니다.
      // model: "gemini-3-flash-preview", 
      contents: { parts: [{ text: prompt }] }
    });

    const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini response was empty.");
    }
    
    // 성공 응답
    return res.status(200).json({
      analysisText: text.trim(),
      predictedFinalAudi: predictedFinalAudi || { min: 0, max: 0, avg: 0 },
      predictionSeries: predictionSeries || [],
      logicFactors: {},
      similarMovies: []
    });

  } catch (error) {
    console.error("AI Analysis Error:", error);
    
    // 에러 상세 내용을 클라이언트로 전달 (디버깅용)
    return res.status(200).json({ 
      analysisText: `분석 실패: ${error.message}`,
      // 에러가 나도 그래프는 그려지도록 더미 데이터 전송
      predictedFinalAudi: { min: 0, max: 0, avg: 0 },
      predictionSeries: [],
      error: error.toString()
    });
  }
}
