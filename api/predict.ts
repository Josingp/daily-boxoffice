import { GoogleGenAI } from "@google/genai";

// [Helper] 요일 구하기
const getDayName = (dateStr: string) => {
  if (!dateStr || dateStr.length < 8) return '';
  const cleanStr = dateStr.replace(/-/g, '');
  const y = parseInt(cleanStr.substring(0, 4));
  const m = parseInt(cleanStr.substring(4, 6)) - 1;
  const d = parseInt(cleanStr.substring(6, 8));
  const date = new Date(y, m, d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
};

// [Helper] 개봉 경과일
const getDaysSinceRelease = (currentDateStr: string, openDt: string) => {
  if (!currentDateStr || !openDt) return 0;
  const c = currentDateStr.replace(/-/g, '');
  const o = openDt.replace(/-/g, '');
  const curr = new Date(parseInt(c.substring(0,4)), parseInt(c.substring(4,6))-1, parseInt(c.substring(6,8)));
  const open = new Date(parseInt(o.substring(0,4)), parseInt(o.substring(4,6))-1, parseInt(o.substring(6,8)));
  return Math.floor((curr.getTime() - open.getTime()) / (1000 * 60 * 60 * 24)) + 1;
};

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
  if (!apiKey) return res.status(500).json({ error: "Server API Key Missing" });

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, comparison } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // 1. 데이터 가공
    const window = trendData.slice(-14);
    const enriched = window.map((d, idx) => {
      const scrn = d.scrnCnt ?? 0;
      const prev = idx > 0 ? window[idx - 1].audiCnt : 0;
      return {
        date: d.dateDisplay,
        day: getDayName(d.date),
        audi: d.audiCnt,
        scrn: scrn,
        psa: scrn > 0 ? (d.audiCnt / scrn).toFixed(1) : "0",
        growth: prev > 0 ? ((d.audiCnt - prev) / prev * 100).toFixed(1) + "%" : "0%"
      };
    });

    const genre = movieInfo.genres?.join(", ") || "Unknown";

    // 2. 프롬프트 (JSON 출력 강제)
    const prompt = `
    Role: Senior Box Office Analyst.
    Task: Predict future audience numbers and analyze the trend.

    [Target Movie]
    - Title: ${movieName} (${genre})
    - Open Date: ${movieInfo.openDt}
    - Total Audience: ${currentAudiAcc}
    
    [Real-time Status (Today vs Yesterday)]
    ${comparison ? `Today(Expected): ${comparison.today} / Yesterday: ${comparison.yesterday} / Growth: ${comparison.rate}%` : "No real-time data"}

    [Recent Performance (Last 14 days)]
    ${JSON.stringify(enriched)}

    [Requirements]
    1. Analyze the trend based on PSA, growth rate, and weekday/weekend patterns.
    2. **Predict specific audience numbers** for the next 3 days (Tomorrow, D+2, D+3).
       - Consider the 'Real-time Status' heavily. If today shows growth, reflect it.
       - Consider the day of the week (Weekend usually higher).
    3. Extract 3 search keywords for finding news about this movie.

    [Output Format]
    You MUST return a valid JSON object strictly matching this schema. Do not include markdown formatting like \`\`\`json.
    {
      "analysis": "Korean analysis text (3-5 sentences). Mention specific reasons for your forecast.",
      "forecast": [number, number, number],
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
    `;

    console.log("Calling Gemini for Prediction...");
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", // JSON 모드가 잘 작동하는 모델 권장
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" } // JSON 강제
    });

    // 3. 응답 파싱
    let responseText = "";
    if (typeof response.text === 'function') responseText = response.text();
    else if (response.text) responseText = response.text;
    else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) responseText = response.response.candidates[0].content.parts[0].text;

    // JSON 파싱 시도
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON Parse Error:", responseText);
      // 파싱 실패 시 텍스트만이라도 살려서 보냄
      result = {
        analysis: responseText.slice(0, 200) + "...",
        forecast: [0, 0, 0],
        keywords: [movieName]
      };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast, // AI가 예측한 수치 사용
      searchKeywords: result.keywords,   // 뉴스 검색용 키워드
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(200).json({ 
      analysisText: "분석 서버 연결 실패", 
      predictionSeries: [0, 0, 0],
      searchKeywords: [movieName],
      error: error.message 
    });
  }
}
