import { GoogleGenAI } from "@google/genai";

const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  // 마크다운 코드 블록 제거
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
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
    const { movieName, trendData, movieInfo, currentAudiAcc, type, historyData } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    // 데이터 전처리: 최근 7일(또는 7개 포인트) 데이터만 추출하여 분석 효율성 증대
    const recentTrend = trendData ? trendData.slice(-7) : [];
    const recentHistory = historyData ? historyData.slice(-12) : []; // 최근 1시간(5분*12)

    // AI에게 부여할 역할 및 알고리즘 명세
    const systemInstruction = `
    You are an expert Data Scientist specializing in Box Office prediction.
    Your goal is to analyze the given time-series data and forecast future audience numbers using statistical reasoning.

    [Input Data]
    - Movie: ${movieName}
    - Type: ${type} (DAILY = Daily Audience, REALTIME = Realtime Reservations)
    - Current Total Audience: ${currentAudiAcc}
    - Recent Trend Data: ${JSON.stringify(type === 'DAILY' ? recentTrend : recentHistory)}
    - Movie Info: ${JSON.stringify(movieInfo || {})}

    [Prediction Algorithm]
    1. **Trend Analysis**: Calculate the recent growth rate (CAGR or linear slope).
    2. **Seasonality/Day Factor**: 
       - If DAILY: Apply weighted multipliers for weekends (Fri: 1.2x, Sat: 2.0x, Sun: 1.8x vs Weekdays).
       - If REALTIME: Consider the time of day (evening peaks).
    3. **Momentum**: If 'rate' (reservation rate) is increasing, apply a positive bias.

    [Task]
    1. Predict the audience count for the **next 3 time points** (Next 3 days for DAILY, Next 3 time slots for REALTIME).
    2. Write a professional report in **Korean** (3 paragraphs):
       - **현황 분석 (Status)**: Analyze the current trajectory based on the data.
       - **예측 모델링 (Forecast)**: Explain the logic used for prediction (e.g., "Due to the weekend effect...").
       - **미래 전망 (Outlook)**: Suggest strategic insights.

    [Output Format - JSON Only]
    {
      "analysis": "Korean report text...",
      "forecast": [1000, 1500, 2000], // Numbers only, no strings
      "keywords": ["Keyword1", "Keyword2"]
    }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", 
      contents: [{ parts: [{ text: systemInstruction }] }],
      config: { responseMimeType: "application/json" }
    });

    let text = "{}";
    if (response.candidates && response.candidates.length > 0) {
        text = response.candidates[0].content?.parts?.[0]?.text || "{}";
    }

    let result;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch (e) {
      console.error("JSON Parse Error:", text);
      result = { analysis: "분석 데이터를 처리하는 중 오류가 발생했습니다.", forecast: [0, 0, 0] };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || [0, 0, 0],
      searchKeywords: result.keywords || [movieName]
    });

  } catch (error: any) {
    console.error("AI Service Error:", error);
    return res.status(200).json({ 
      analysisText: `분석 실패: ${error.message}`, 
      predictionSeries: [0, 0, 0] 
    });
  }
}
