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

    // BEP 정보 생성
    let bepContext = "Production cost unknown.";
    if (productionCost && productionCost > 0) {
        const cost = Number(productionCost);
        const sales = Number(salesAcc || 0);
        const percent = ((sales / cost) * 100).toFixed(1);
        bepContext = `Production Cost: ${cost} KRW, Current Sales: ${sales} KRW. BEP Progress: ${percent}%.`;
    }

    const prompt = `
    Role: Senior Data Scientist & Box Office Analyst.
    
    Target Movie: "${movieName}"
    Current Status: Total Audience ${currentAudiAcc}
    Financial Context: ${bepContext}
    
    Input Data (Daily Trend):
    ${recentTrend}

    Input Data (Realtime Trend):
    ${realtimeTrend}

    Task:
    1. **Mathematical Analysis**: Calculate momentum.
    2. **Forecast Algorithm**: Predict next 3 days audience.
    3. **Final Prediction**: Estimate the *Final Total Audience* based on current pace and BEP status.
    4. **Report Generation**: Write a 3-paragraph Korean report.
       - Para 1: Status & Momentum.
       - Para 2: Audience Psychology.
       - Para 3: Future Outlook & BEP Analysis.
    
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
