import { GoogleGenAI } from "@google/genai";

const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API Key Missing" });

  try {
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData, productionCost, salesAcc } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    const recentTrend = Array.isArray(trendData) && trendData.length > 0
      ? trendData.slice(-7).map((d: any) => `[${d.dateDisplay}] Audi: ${d.audiCnt}, Sales: ${d.salesAmt}`).join("\n")
      : "No daily trend data";

    const realtimeTrend = Array.isArray(historyData) && historyData.length > 0
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank: ${d.rank}, Rate: ${d.rate}%, Audi: ${d.val_audi}`).join("\n")
      : "No realtime data";

    let bepContext = "Production cost unknown.";
    if (productionCost && productionCost > 0) {
        const cost = Number(productionCost);
        const sales = Number(salesAcc || 0);
        const percent = ((sales / cost) * 100).toFixed(1);
        bepContext = `Production Cost: ${cost} KRW, Current Sales: ${sales} KRW. BEP Progress: ${percent}%.`;
    }

    // 개봉일 확인
    const openDate = movieInfo?.openDt || "";
    
    // [핵심] 전문 분석가 페르소나 및 개봉 전/후 시나리오 프롬프트
    const prompt = `
    Role: Senior Data Scientist & Box Office Analyst.
    
    Target Movie: "${movieName}"
    Open Date: ${openDate} (YYYYMMDD)
    Current Status: Total Audience ${currentAudiAcc}
    Financial Context: ${bepContext}
    
    Input Data (Daily Trend):
    ${recentTrend}

    Input Data (Realtime Trend):
    ${realtimeTrend}

    Task:
    1. **Check Release Status**: Compare 'Open Date' with today. 
       - If **Unreleased**: Focus strictly on "Pre-release Hype", "Reservation Rate Growth", and "Expectation". Do NOT criticize low audience numbers as it hasn't opened yet.
       - If **Released**: Analyze "Box Office Momentum", "Drop Rate", and "Viral Factor".
    
    2. **Forecast Algorithm**: 
       - Use linear/logarithmic regression to predict next 3 days. 
       - If unreleased, predict based on reservation growth trends.
    
    3. **Final Prediction**: Estimate the *Final Total Audience* considering the BEP and current pace.

    4. **Report Generation**: Write a 3-paragraph Korean report with emojis.
       - Para 1: Current Momentum (Reservation rate or Daily audience).
       - Para 2: Analysis (Why is this happening? Genre, Competition, Buzz).
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
      model: "gemini-2.0-flash", 
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
