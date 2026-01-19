import { GoogleGenAI } from "@google/genai";

const getDayName = (dateStr: string) => {
  if (!dateStr || dateStr.length < 8) return '';
  const c = dateStr.replace(/-/g, '');
  const date = new Date(parseInt(c.substring(0,4)), parseInt(c.substring(4,6))-1, parseInt(c.substring(6,8)));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
};

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
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    const genre = movieInfo.genres?.join(", ") || "Unknown";
    
    let prompt = "";

    // ----------------------------------------------------------------
    // [DAILY] 일별 박스오피스 모드: 흥행 성적 집중 분석
    // ----------------------------------------------------------------
    if (type === 'DAILY') {
        const enriched = trendData.slice(-10).map(d => `${d.dateDisplay}: ${d.audiCnt}명`);
        prompt = `
        Role: Box Office Analyst.
        Target: ${movieName} (${genre}), Open: ${movieInfo.openDt}
        Current Total: ${currentAudiAcc}
        Recent Trend: ${JSON.stringify(enriched)}

        Task:
        1. Analyze the box office performance since release.
        2. Evaluate the trend (Growth/Decline) based on daily audience numbers.
        3. Predict if it will reach the break-even point or next million milestone.
        4. Write 3 paragraphs (Current Status, Trend Analysis, Future Outlook) in Korean.
        5. Predict next 3 days audience.

        Output JSON: { "analysis": "...", "forecast": [0,0,0] }
        `;
    } 
    // ----------------------------------------------------------------
    // [REALTIME] 실시간 예매율 모드: 예매율 추이 및 기대감 분석
    // ----------------------------------------------------------------
    else {
        // historyData가 있으면 활용 (GitHub에서 가져온 누적 데이터)
        const historySummary = historyData ? JSON.stringify(historyData.slice(-5)) : "No history yet";
        
        prompt = `
        Role: Real-time Reservation Analyst.
        Target: ${movieName} (${genre}), Open: ${movieInfo.openDt}
        Current Reservation Status: High interest expected.
        Reservation History (Last 5 checks): ${historySummary}

        Task:
        1. This movie is in the "Real-time Reservation Top 10".
        2. Analyze the **Reservation Rate Trend**. Is it rising?
        3. If unreleased, analyze the "Pre-release Hype".
        4. If released, compare reservation momentum with actual performance.
        5. Write 3 paragraphs in Korean focused on *Momentum* and *Expectation*.
        6. Predict next 3 days *Audience* based on this reservation hype.

        Output JSON: { "analysis": "...", "forecast": [0,0,0] }
        `;
    }
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    let text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch (e) {
      result = { analysis: "분석 데이터를 처리하는 중입니다.", forecast: [0, 0, 0] };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    return res.status(200).json({ 
      analysisText: "분석 실패", 
      predictionSeries: [0, 0, 0],
      error: error.message 
    });
  }
}
