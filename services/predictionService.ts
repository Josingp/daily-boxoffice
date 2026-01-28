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
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server API Key Missing" });

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    const genre = movieInfo?.genres?.map((g: any) => g.genreNm).join(", ") || "Unknown";
    const openDt = movieInfo?.openDt || "Unknown";
    
    let prompt = "";

    if (type === 'DAILY') {
        const enriched = trendData.slice(-10).map((d: any) => `${d.dateDisplay}: ${d.audiCnt}명`);
        prompt = `
        Role: Box Office Analyst.
        Target: ${movieName} (${genre}), Open: ${openDt}
        Current Total: ${currentAudiAcc}
        Recent Trend: ${JSON.stringify(enriched)}

        Task:
        1. Analyze performance.
        2. Evaluate growth/decline.
        3. Write 3 paragraphs (Status, Trend, Outlook) in Korean.
        4. Predict next 3 days audience numbers.

        Output JSON: { "analysis": "...", "forecast": [0,0,0] }
        `;
    } else {
        const historySummary = historyData ? JSON.stringify(historyData.slice(-5)) : "No history";
        prompt = `
        Role: Real-time Reservation Analyst.
        Target: ${movieName} (${genre}), Open: ${openDt}
        Reservation History: ${historySummary}

        Task:
        1. Analyze reservation rate trend.
        2. Discuss pre-release hype or current momentum.
        3. Write 3 paragraphs in Korean.
        4. Predict next 3 days audience.

        Output JSON: { "analysis": "...", "forecast": [0,0,0] }
        `;
    }
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", 
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
      analysisText: "분석 서버 연결 실패", 
      predictionSeries: [0, 0, 0],
      error: error.message 
    });
  }
}
