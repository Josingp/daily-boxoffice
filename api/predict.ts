import { GoogleGenAI } from "@google/genai";

const getDayName = (dateStr: string) => {
  if (!dateStr || dateStr.length < 8) return '';
  const c = dateStr.replace(/-/g, '');
  const date = new Date(parseInt(c.substring(0,4)), parseInt(c.substring(4,6))-1, parseInt(c.substring(6,8)));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
};

// JSON 정제 (마크다운 코드블록 제거)
const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  let cleaned = str.replace(/```json/g, "").replace(/```/g, "").trim();
  return cleaned;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API Key Missing" });

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, comparison } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // 개봉 여부 판단
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const openDtStr = movieInfo.openDt.replace(/-/g, "");
    const isUnreleased = parseInt(openDtStr) > parseInt(todayStr);

    // 데이터 가공
    const window = trendData.slice(-14);
    const enriched = window.map((d, idx) => {
      const scrn = d.scrnCnt ?? 0;
      const prev = idx > 0 ? window[idx - 1].audiCnt : 0;
      return {
        date: d.dateDisplay,
        day: getDayName(d.date),
        audi: d.audiCnt,
        growth: prev > 0 ? ((d.audiCnt - prev) / prev * 100).toFixed(1) + "%" : "0%"
      };
    });

    const genre = movieInfo.genres?.join(", ") || "Unknown";

    let specificTask = isUnreleased 
      ? "This movie is unreleased. Focus heavily on 'Pre-release Hype' and reservation trends." 
      : "Analyze daily trends, weekday/weekend patterns, and drop rates.";

    // [프롬프트 강화] 상세 분석 요청
    const prompt = `
    Role: Professional Senior Box Office Analyst.
    [Target] ${movieName} (${genre}), Open: ${movieInfo.openDt}
    [Status] Total: ${currentAudiAcc}
    [Real-time] ${comparison ? `Today: ${comparison.today}, Yest: ${comparison.yesterday}` : "No data"}
    [Recent Data] ${JSON.stringify(enriched)}
    
    [Task]
    ${specificTask}
    1. Write a **DETAILED** Korean analysis.
    2. Structure your analysis into clear sections (but return as one string): 
       - Current Status & Real-time Check.
       - Trend Analysis (Growth rate, Weekday/Weekend pattern).
       - Future Outlook (Success potential).
    3. Length: **At least 8-10 sentences**. Do NOT be concise. Provide deep insights.
    4. Predict next 3 days audience.
    5. Extract 2 keywords for news search.

    [Output Format - JSON ONLY]
    You MUST return a raw JSON object. NO Markdown.
    {
      "analysis": "Write rich text here with \\n for line breaks.",
      "forecast": [0, 0, 0],
      "keywords": ["keyword1", "keyword2"]
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", 
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    let text = "";
    if (typeof response.text === 'function') text = response.text();
    else if (response.text) text = response.text;
    else if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) text = response.response.candidates[0].content.parts[0].text;

    let result;
    try {
      // 마크다운 제거 후 파싱 시도
      result = JSON.parse(cleanJsonString(text));
    } catch (e) {
      console.error("JSON Parse Error:", text);
      // 파싱 실패 시, 정규식으로 'analysis' 부분만이라도 추출 시도
      const analysisMatch = text.match(/"analysis":\s*"((?:[^"\\]|\\.)*)"/);
      const cleanAnalysis = analysisMatch ? analysisMatch[1] : "상세 분석 내용을 불러오는 중입니다.";
      
      result = {
        analysis: cleanAnalysis,
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
    return res.status(200).json({ 
      analysisText: "분석 서버 연결 실패", 
      predictionSeries: [0, 0, 0],
      searchKeywords: [movieName],
      error: error.message 
    });
  }
}
