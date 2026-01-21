import { GoogleGenAI } from "@google/genai";

const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
};

// [핵심] 날짜 문자열(YYYYMMDD)을 받아 요일과 주말 여부를 반환하는 함수
const getDayContext = (dateStr: string) => {
  if (!dateStr || dateStr.length !== 8) return "";
  
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1; // 월은 0부터 시작
  const day = parseInt(dateStr.substring(6, 8));
  
  const date = new Date(year, month, day);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = days[date.getDay()];
  
  // 토, 일은 Weekend, 나머지는 Weekday로 명시
  const type = (dayName === 'Sat' || dayName === 'Sun') ? 'Weekend' : 'Weekday';
  
  return `(${dayName}, ${type})`;
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
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData, productionCost, salesAcc, audiAcc, avgTicketPrice } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // [핵심] 일별 데이터에 요일과 주말 정보를 강제로 주입
    const recentTrend = Array.isArray(trendData) && trendData.length > 0
      ? trendData.slice(-7).map((d: any) => {
          const dayContext = getDayContext(d.date); // 예: (Sat, Weekend)
          return `[${d.dateDisplay} ${dayContext}] Audi: ${d.audiCnt}, Sales: ${d.salesAmt}`;
        }).join("\n")
      : "No daily trend data";

    // 실시간 데이터
    const realtimeTrend = Array.isArray(historyData) && historyData.length > 0
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank: ${d.rank}, Rate: ${d.rate}%, Audi: ${d.val_audi}`).join("\n")
      : "No realtime data";

    // BEP 정보 생성
    let bepContext = "Production cost unknown.";
    if (productionCost && productionCost > 0) {
        const cost = Number(productionCost);
        const atp = Number(avgTicketPrice || 12000);
        const bepAudi = Math.round(cost / (atp * 0.4));
        const percent = ((Number(audiAcc)/bepAudi) * 100).toFixed(1);
        bepContext = `Production Cost: ${cost} KRW. Real Avg Ticket Price: ${Math.round(atp)} KRW. BEP Target: approx ${bepAudi}. Progress: ${percent}%.`;
    }

    const openDate = movieInfo?.openDt || "";
    
    // [핵심] 현재 한국 시간 구하기
    const nowKST = new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"});

    const prompt = `
    Role: Senior Data Scientist & Box Office Analyst.
    
    Target Movie: "${movieName}"
    Open Date: ${openDate} (YYYYMMDD)
    Current Time (KST): ${nowKST}
    Current Status: Total Audience ${currentAudiAcc}
    Financial Context: ${bepContext}
    
    Input Data (Daily Trend - Look at the Day of Week!):
    ${recentTrend}
    * Note: In Korea, audiences typically double or triple on Weekends (Sat, Sun) compared to Weekdays. 
    * If today is Monday, a drop from Sunday is normal. If today is Saturday, a surge is expected.

    Input Data (Realtime Trend):
    ${realtimeTrend}

    Task:
    1. **Check Release Status**: Compare 'Open Date' with 'Current Time'. 
       - If **Unreleased**: Focus strictly on "Pre-release Hype", "Reservation Rate Growth".
       - If **Released**: Analyze "Box Office Momentum" and "Drop Rate" considering Weekday/Weekend cycles.
    
    2. **Forecast Algorithm**: 
       - Use regression to predict next 3 days.
       - IMPORTANT: Adjust predictions based on the upcoming Day of Week (e.g., if tomorrow is Saturday, predict a rise).
    
    3. **Final Prediction**: Estimate the *Final Total Audience* considering the BEP and current pace.

    4. **Report Generation**: Write a 3-paragraph Korean report with emojis.
       - Para 1: Current Momentum (Mention specific numbers & Day of Week effects).
       - Para 2: Analysis (Genre, Competition, Buzz).
       - Para 3: Strategic Outlook & Final Prediction.
    
    Output JSON Schema:
    {
      "analysis": "String (Korean report)",
      "forecast": [Number, Number, Number],
      "keywords": ["String", "String"],
      "predictedFinalAudi": { "min": Number, "max": Number, "avg": Number }
    }
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });

    let text = "{}";
    if (response.candidates && response.candidates.length > 0) {
        text = response.candidates[0].content?.parts?.[0]?.text || "{}";
    }

    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch {
      result = { analysis: "분석 불가", forecast: [0,0,0], keywords: [], predictedFinalAudi: {min:0,max:0,avg:0} };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: result.predictedFinalAudi || { min: 0, max: 0, avg: 0 }
    });

  } catch (error: any) {
    console.error("AI Error:", error);
    return res.status(200).json({ 
      analysisText: `오류: ${error.message}`, 
      predictionSeries: [0, 0, 0]
    });
  }
}
