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
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData, productionCost } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // 데이터 요약
    const recentTrend = Array.isArray(trendData) && trendData.length > 0
      ? trendData.slice(-7).map((d: any) => `[${d.dateDisplay}] Audi: ${d.audiCnt}, Sales: ${d.salesAmt}`).join("\n")
      : "No daily trend data";

    const realtimeTrend = Array.isArray(historyData) && historyData.length > 0
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank: ${d.rank}, Rate: ${d.rate}%, Audi: ${d.val_audi}`).join("\n")
      : "No realtime data";

    // 현재 총 매출액 추정 (일별 데이터 합산이 정확하지 않을 수 있으므로 누적 관객수 기반 추정치 참고용)
    // 실제로는 클라이언트에서 salesAcc를 보내주는 게 좋지만, 여기서는 트렌드 데이터의 salesAmt를 참고
    
    let costPrompt = "";
    if (productionCost > 0) {
        costPrompt = `
        **Financial Data**:
        - Production Cost: ${productionCost.toLocaleString()} KRW
        - (Important) Calculate the approximate Break-Even Point (BEP) based on the current sales and production cost.
        - Analyze if the movie has passed the BEP or how much is left.
        - **Final Prediction**: Estimate the final total audience number based on the BEP progress and current momentum.
        `;
    }

    const prompt = `
    Role: Senior Box Office & Financial Analyst.
    
    Target Movie: "${movieName}"
    Current Total Audience: ${currentAudiAcc}
    ${costPrompt}

    Input Data (Daily Trend):
    ${recentTrend}

    Input Data (Realtime Trend):
    ${realtimeTrend}

    Task:
    1. **Momentum Analysis**: Calculate growth/decline rates.
    2. **Financial Analysis**: If Production Cost is provided, analyze the BEP status in detail.
    3. **Forecast**: Predict audience numbers for next 3 days AND the *Final Total Audience*.
    4. **Report**: Write a 3-paragraph Korean report:
       - **Paragraph 1 (Box Office Status)**: Current rank, audience trend, and viral factors.
       - **Paragraph 2 (Financial & BEP Analysis)**: Compare current performance against production cost (if available). Are they profitable yet? How long until BEP?
       - **Paragraph 3 (Final Prediction)**: Strategic outlook and estimated final audience score.
    
    Output JSON Schema:
    {
      "analysis": "String (Korean report)",
      "forecast": [Number, Number, Number], // Next 3 days
      "predictedFinalAudi": { "min": Number, "max": Number, "avg": Number }, // Final total prediction
      "keywords": ["String", "String"]
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
      result = { analysis: "분석 불가", forecast: [0,0,0], predictedFinalAudi: {min:0,max:0,avg:0} };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: result.predictedFinalAudi || { min: 0, max: 0, avg: 0 }
    });

  } catch (error: any) {
    console.error("AI Error:", error);
    return res.status(200).json({ analysisText: `Error: ${error.message}`, predictionSeries: [0,0,0] });
  }
}
