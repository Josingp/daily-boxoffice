import { GoogleGenAI } from "@google/genai";

// [도구] JSON 문자열 정제
const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/g, "").replace(/```/g, "").trim();
};

// [알고리즘 1] 가중 이동 평균 (최신 데이터에 더 많은 가중치)
const calculateWeightedAverage = (data: number[]) => {
  if (data.length === 0) return 0;
  let sum = 0;
  let weightSum = 0;
  data.forEach((val, idx) => {
    const weight = idx + 1; // 뒤로 갈수록(최신일수록) 가중치 증가
    sum += val * weight;
    weightSum += weight;
  });
  return Math.round(sum / weightSum);
};

// [알고리즘 2] 선형 회귀 기울기 (추세선)
const calculateTrendSlope = (data: number[]) => {
  if (data.length < 2) return 0;
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  data.forEach((y, x) => {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return slope; // 양수면 상승세, 음수면 하락세
};

export default async function handler(req, res) {
  // CORS 설정
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

    // -----------------------------------------------------------
    // 1. 데이터 전처리 및 기초 통계 계산 (Mathematical Algorithm)
    // -----------------------------------------------------------
    let statsReport = "";
    let baseForecast = [0, 0, 0];

    if (type === 'DAILY') {
        // 일별 데이터 (관객수)
        const recentAudi = trendData.slice(-7).map((d: any) => d.audiCnt); // 최근 7일
        const avg = calculateWeightedAverage(recentAudi);
        const slope = calculateTrendSlope(recentAudi);
        
        // 요일 보정 (내일, 모레, 글피 요일 구하기)
        const today = new Date();
        const multipliers = [1, 1, 1].map((_, i) => {
            const d = new Date(today);
            d.setDate(today.getDate() + i + 1);
            const day = d.getDay();
            // 금(5), 토(6)은 관객수 증가, 일(0)은 유지/소폭하락, 월(1)은 급락 패턴 적용
            if (day === 5) return 1.3; // 금
            if (day === 6) return 1.8; // 토
            if (day === 0) return 1.5; // 일
            return 0.8; // 평일
        });

        // 기초 예측값 계산 (평균 + 기울기반영 * 요일가중치)
        baseForecast = multipliers.map((m, i) => {
            const projected = avg + (slope * (i + 1));
            return Math.round(Math.max(0, projected) * m);
        });

        statsReport = `
        - Recent 7-day Weighted Avg: ${formatNumber(avg)}
        - Trend Slope: ${slope.toFixed(2)} (${slope > 0 ? 'Upward' : 'Downward'})
        - Day-of-Week Multipliers Applied: ${multipliers.join(', ')}
        - Statistical Base Forecast: ${baseForecast.join(', ')}
        `;

    } else {
        // 실시간 데이터 (예매율)
        // historyData: { time, rate, rank }
        const recentRates = historyData?.slice(-10).map((d: any) => d.rate) || [];
        const currentRate = recentRates[recentRates.length - 1] || 0;
        const slope = calculateTrendSlope(recentRates);
        
        // 예매율 관성 적용 (현재 추세가 유지된다고 가정)
        baseForecast = [
            currentRate + slope * 24, // 24시간 후 (단순 선형 가정)
            currentRate + slope * 48,
            currentRate + slope * 72
        ].map(v => Math.max(0, parseFloat(v.toFixed(1)))); // 음수 방지

        statsReport = `
        - Current Reservation Rate: ${currentRate}%
        - Rate Momentum (Slope): ${slope.toFixed(3)} / hour
        - Hype Factor: ${slope > 0.1 ? 'Explosive' : slope > 0 ? 'Steady' : 'Cooling down'}
        `;
    }

    // -----------------------------------------------------------
    // 2. Gemini 프롬프트 설계 (Role-Playing & Analysis)
    // -----------------------------------------------------------
    const genre = movieInfo?.genres?.map((g: any) => g.genreNm).join(", ") || "Unknown";
    
    const prompt = `
    [Role]
    You are a **Senior Box Office Quant Analyst**. Your job is to predict future audience numbers/rates using statistical data and market insights.
    Do NOT write generic text. Be precise, analytical, and professional.

    [Target Movie]
    - Title: ${movieName} (${genre})
    - Open Date: ${movieInfo?.openDt || 'Unknown'}
    - Current Total Audience: ${currentAudiAcc}
    - Analysis Type: ${type === 'DAILY' ? 'Daily Box Office Trend' : 'Real-time Reservation Trend'}

    [Statistical Engineering Data]
    I have already calculated the mathematical base model for you:
    ${statsReport}

    [Task]
    1. **Analyze the Situation**: meaningful interpretation of the slope and weighted average. Is it performing above or below expectations?
    2. **Refine the Forecast**: Review the "Statistical Base Forecast" I provided. 
       - If there are external factors (e.g., new blockbuster release, holidays, bad reviews), ADJUST the numbers.
       - If the base model looks correct, use it.
       - Output the final predicted numbers for the next 3 days (Audience count for DAILY, Reservation Rate % for REALTIME).
    3. **Write a Report**: Write 3 short but dense paragraphs in **Korean**.
       - Para 1: Current Status & Data Interpretation (Mention the slope/trend).
       - Para 2: Market Factors (Competitors, Genre popularity, Weekend effect).
       - Para 3: Final Verdict (Hit/Flop/Steady Seller).

    [Output Format - JSON ONLY]
    {
      "analysis": "Korean text here...",
      "forecast": [number, number, number],
      "keywords": ["keyword1", "keyword2"]
    }
    `;
    
    // -----------------------------------------------------------
    // 3. AI 호출
    // -----------------------------------------------------------
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", // 속도와 안정성 균형
      contents: { parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: "application/json" }
    });

    let text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result;
    
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch (e) {
      // JSON 파싱 실패 시, 우리가 계산한 '기초 통계값'이라도 보여주는 안전장치
      console.error("AI JSON Error, falling back to stats.");
      result = { 
          analysis: `AI 분석 응답 형식이 올바르지 않아 기초 통계 데이터를 표시합니다.\n\n${statsReport}`, 
          forecast: baseForecast, // AI가 실패해도 수학적 계산값은 나감
          keywords: [movieName]
      };
    }

    return res.status(200).json({
      analysisText: result.analysis,
      predictionSeries: result.forecast || baseForecast,
      searchKeywords: result.keywords || [movieName],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });

  } catch (error) {
    console.error("Predict API Error:", error);
    return res.status(200).json({ 
      analysisText: `분석 시스템 오류: ${error.message}`, 
      predictionSeries: [0, 0, 0]
    });
  }
}

// Helper
function formatNumber(num: number) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
