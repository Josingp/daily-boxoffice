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

// [Helper] JSON 문자열 정제 (마크다운 제거)
const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  // ```json 또는 ``` 제거
  let cleaned = str.replace(/```json/g, "").replace(/```/g, "").trim();
  return cleaned;
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

    // 1. 개봉 여부 확인
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const openDtStr = movieInfo.openDt.replace(/-/g, "");
    const isUnreleased = parseInt(openDtStr) > parseInt(todayStr);

    // 2. 데이터 가공
    const window = trendData.slice(-14);
    const enriched = window.map((d, idx) => {
      const scrn = d.scrnCnt ?? 0;
      const prev = idx > 0 ? window[idx - 1].audiCnt : 0;
      return {
        date: d.dateDisplay,
        audi: d.audiCnt,
        psa: scrn > 0 ? (d.audiCnt / scrn).toFixed(1) : "0",
        growth: prev > 0 ? ((d.audiCnt - prev) / prev * 100).toFixed(1) + "%" : "0%"
      };
    });

    const genre = movieInfo.genres?.join(", ") || "Unknown";

    // 3. 프롬프트 구성 (개봉 전/후 분기)
    let specificTask = "";
    if (isUnreleased) {
      specificTask = `
      - This movie is **NOT RELEASED YET**. 
      - The 'trendData' might be empty or show pre-release screenings.
      - Focus heavily on the 'Real-time Status' (Reservation rate) and 'Pre-release Hype'.
      - Predict the 'Opening Day' score based on current reservation numbers.
      `;
    } else {
      specificTask = `
      - Analyze the daily trend (Rising/Falling).
      - Mention the 'Real-time Status' (Today's performance vs Yesterday).
      - Consider weekday vs weekend patterns.
      `;
    }

    const prompt = `
    Role: Box Office Analyst.
    Task: Forecast audience numbers and provide insights.

    [Movie Info]
    - Title: ${movieName} (${genre})
    - Opening: ${movieInfo.openDt}
    - Total Audience: ${currentAudiAcc}
    
    [Real-time Status (Today vs Yesterday)]
    ${comparison ? `Today: ${comparison.today} / Yesterday: ${comparison.yesterday} / Growth: ${comparison.rate}%` : "No real-time data"}

    [Recent Data]
    ${JSON.stringify(enriched)}

    [Analysis Instructions]
    ${specificTask}
    - Extract 3 search keywords for news (e.g., "MovieTitle review", "MovieTitle box office").

    [Output Format - JSON ONLY]
    You MUST return a raw JSON object. NO Markdown.
    {
      "analysis": "Korean text (3-5 sentences). Natural language summary.",
      "forecast": [number, number, number],
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
    `;

    console.log("Calling Gemini...");
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    // 4. 응답 파싱 및 안전장치
    let responseText = "";
    if (typeof response.text === 'function') responseText = response.text();
    else if (response.text) responseText = response.text;
    else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) responseText = response.response.candidates[0].content.parts[0].text;

    let result;
    try {
      // 마크다운 제거 후 파싱
      const cleanedText = cleanJsonString(responseText);
      result = JSON.parse(cleanedText);
    } catch (e) {
      console.error("JSON Parse Error. Raw:", responseText);
      // 파싱 실패 시 텍스트만 추출 시도 (Regex)
      const analysisMatch = responseText.match(/"analysis":\s*"([^"]*)"/);
      result = {
        analysis: analysisMatch ? analysisMatch[1] : "분석 내용을 불러오는 중 형식이 맞지 않습니다.",
        forecast: [0, 0, 0],
        keywords: [movieName]
      };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(200).json({ 
      analysisText: "분석 서비스를 일시적으로 사용할 수 없습니다.", 
      predictionSeries: [0, 0, 0],
      searchKeywords: [movieName],
      error: error.message 
    });
  }
}
