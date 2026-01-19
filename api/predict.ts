import { GoogleGenAI } from "@google/genai";

// ------------------------------------------------------------------
// [Helper 1] 요일 구하기
// ------------------------------------------------------------------
const getDayName = (dateStr: string) => {
  if (!dateStr || dateStr.length < 8) return '';
  // YYYY-MM-DD or YYYYMMDD
  const cleanStr = dateStr.replace(/-/g, '');
  const y = parseInt(cleanStr.substring(0, 4));
  const m = parseInt(cleanStr.substring(4, 6)) - 1;
  const d = parseInt(cleanStr.substring(6, 8));
  const date = new Date(y, m, d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
};

// ------------------------------------------------------------------
// [Helper 2] 개봉 후 경과일 계산
// ------------------------------------------------------------------
const getDaysSinceRelease = (currentDateStr: string, openDt: string) => {
  if (!currentDateStr || !openDt) return 0;
  
  const cleanCurr = currentDateStr.replace(/-/g, '');
  const cleanOpen = openDt.replace(/-/g, '');

  const cy = parseInt(cleanCurr.substring(0, 4));
  const cm = parseInt(cleanCurr.substring(4, 6)) - 1;
  const cd = parseInt(cleanCurr.substring(6, 8));
  const current = new Date(cy, cm, cd);

  const oy = parseInt(cleanOpen.substring(0, 4));
  const om = parseInt(cleanOpen.substring(4, 6)) - 1;
  const od = parseInt(cleanOpen.substring(6, 8));
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
      predictedFinalAudi 
    } = req.body;

    const ai = new GoogleGenAI({ apiKey });

    // ---------------------------------------------------------
    // 1. 데이터 가공 (Enrichment) - 사용자 제공 로직 적용
    // ---------------------------------------------------------
    // 최근 14일 데이터만 사용
    const window = trendData.slice(-14);

    const enriched = window.map((d, idx) => {
      const dayName = getDayName(d.date);
      const lifecycleDay = getDaysSinceRelease(d.date, movieInfo.openDt);

      const scrn = d.scrnCnt ?? 0;
      const psa = scrn > 0 ? (d.audiCnt / scrn) : 0;

      const prev = idx > 0 ? window[idx - 1].audiCnt : 0;
      const growth = prev > 0 ? ((d.audiCnt - prev) / prev * 100) : null;

      return {
        date: d.date,
        dow: dayName,
        lifecycleDay,
        audiCnt: d.audiCnt,
        scrnCnt: d.scrnCnt ?? null,
        // showCnt: d.showCnt ?? null, // 필요 시 추가
        psa: Number(psa.toFixed(1)),
        growthPct: growth === null ? null : Number(growth.toFixed(1))
      };
    });

    const genre = movieInfo.genres?.map(g => g.genreNm).join(", ") || "Unknown";

    // ---------------------------------------------------------
    // 2. 프롬프트 구성 (사용자 제공 템플릿)
    // ---------------------------------------------------------
    // 예측값이 없으면 임시로 생성 (그래프 오류 방지용)
    const finalSeries = predictionSeries && predictionSeries.length > 0 
      ? predictionSeries 
      : [0, 0, 0]; // 데이터가 없을 경우 0으로 채움

    const prompt = `
    You are a Korean box office analyst.

    IMPORTANT:
    - Do NOT invent numbers.
    - Use the provided predictionSeries as the official D+1~D+3 forecast.
    - If something is missing, say it is uncertain rather than guessing.

    TARGET:
    - title: ${movieName} (${genre})
    - openDt: ${movieInfo.openDt}
    - currentAudiAcc: ${currentAudiAcc}

    RECENT PERFORMANCE (up to 14 days):
    ${JSON.stringify(enriched)}

    OFFICIAL FORECAST (from deterministic model):
    - D+1~D+3 audience series: ${JSON.stringify(finalSeries)}
    - final audience range (optional): ${predictedFinalAudi ? JSON.stringify(predictedFinalAudi) : "N/A"}

    Write a concise Korean analysis (3~6 sentences):
    - Comment on PSA 수준(가능하면)과 스크린 변화 가능성
    - 주말/평일 패턴 리스크
    - 현재가 개봉 몇 주차인지에 따른 감쇠/유지 가능성
    Return plain text only (no JSON, no markdown).
    `;

    // ---------------------------------------------------------
    // 3. Gemini 호출
    // ---------------------------------------------------------
    console.log("Calling Gemini Model...");
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: { parts: [{ text: prompt }] }
    });

    // [중요] 응답 텍스트 추출 방식 개선 (@google/genai 최신 버전 대응)
    let text = "";
    if (typeof response.text === 'function') {
        text = response.text();
    } else if (response.text) {
        text = response.text; // 프로퍼티인 경우
    } else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = response.response.candidates[0].content.parts[0].text; // 깊은 구조
    }

    if (!text) {
      throw new Error("Gemini response was empty or blocked.");
    }
    
    // 성공 응답
    return res.status(200).json({
      analysisText: text.trim(),
      predictedFinalAudi: predictedFinalAudi || { min: 0, max: 0, avg: 0 },
      predictionSeries: finalSeries,
      logicFactors: {},
      similarMovies: []
    });

  } catch (error) {
    console.error("AI Analysis Error:", error);
    
    // 에러 발생 시에도 프론트엔드가 죽지 않도록 기본 응답 반환
    return res.status(200).json({ 
      analysisText: `AI 분석에 실패했습니다. (${error.message})`,
      predictedFinalAudi: { min: 0, max: 0, avg: 0 },
      predictionSeries: [0, 0, 0],
      error: error.toString()
    });
  }
}
