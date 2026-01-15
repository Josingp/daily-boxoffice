import { GoogleGenAI } from "@google/genai";
import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

// Helper to get day of week name
const getDayName = (dateStr: string) => {
  const y = parseInt(dateStr.substring(0, 4));
  const m = parseInt(dateStr.substring(4, 6)) - 1;
  const d = parseInt(dateStr.substring(6, 8));
  const date = new Date(y, m, d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
};

// Helper to calculate days since release
const getDaysSinceRelease = (currentDateStr: string, openDt: string) => {
  const y = parseInt(currentDateStr.substring(0, 4));
  const m = parseInt(currentDateStr.substring(4, 6)) - 1;
  const d = parseInt(currentDateStr.substring(6, 8));
  const current = new Date(y, m, d);

  const openY = parseInt(openDt.replace(/-/g, '').substring(0, 4));
  const openM = parseInt(openDt.replace(/-/g, '').substring(4, 6)) - 1;
  const openD = parseInt(openDt.replace(/-/g, '').substring(6, 8));
  const open = new Date(openY, openM, openD);

  const diffTime = Math.abs(current.getTime() - open.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
};

export const predictMoviePerformance = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo?: MovieInfo | null,
  currentAudiAcc: string = "0"
): Promise<PredictionResult | null> => {
  // Check if API KEY exists. 
  // If user hasn't set up the env variable, return null gracefully.
  if (!process.env.API_KEY || !movieInfo) {
    console.warn("Gemini API Key is missing. AI predictions disabled.");
    return null;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    // 1. Feature Engineering (Prepare data for the "Model")
    const enrichedData = trendData.map((d, index) => {
      const dayName = getDayName(d.date);
      const daysSinceOpen = getDaysSinceRelease(d.date, movieInfo.openDt);
      
      const psa = d.scrnCnt && d.scrnCnt > 0 ? (d.audiCnt / d.scrnCnt).toFixed(1) : "0";

      let growthD1 = "N/A";
      if (index > 0) {
        const prev = trendData[index - 1].audiCnt;
        if (prev > 0) growthD1 = ((d.audiCnt - prev) / prev * 100).toFixed(1) + "%";
      }

      return {
        date: d.date,
        dayOfWeek: dayName,
        lifecycleDay: daysSinceOpen,
        audiCnt: d.audiCnt,
        scrnCnt: d.scrnCnt,
        psa: psa, 
        growthPrevDay: growthD1, 
      };
    });

    const genre = movieInfo.genres.map(g => g.genreNm).join(", ") || "Unknown";
    
    // 2. Construct Prompt
    const prompt = `
      You are a specialized Korean Box Office Analyst Algorithm.
      
      **TARGET MOVIE:**
      - Title: "${movieName}" (${genre})
      - Release Date: ${movieInfo.openDt}
      - Current Accumulated Audience: ${currentAudiAcc}
      - Recent 7-Day Performance Metrics:
      ${JSON.stringify(enrichedData)}

      **ALGORITHM EXECUTION INSTRUCTIONS:**

      1. **Analyze PSA (Per Screen Average) Efficiency**:
         - Calculate the PSA trend. 
         - Logic: If PSA is consistently low (e.g., < 20-30 people per screen), predict a *sharp* screen reduction (Screen Decay Rate > 50%) for the coming week.
         - Logic: If PSA is high (> 80), assume "Word of Mouth" is active and screens will hold steady or increase.

      2. **Lifecycle & Seasonality Regression**:
         - Adjust the "Weekend Multiplier" based on the PSA. High PSA = Higher Multiplier.
         - Apply Logarithmic Decay based on 'lifecycleDay'.

      3. **Final Total Prediction**:
         - Forecast = Current Accumulated + (Projected Daily Run * Screen Retention Rate).
         - Stop the forecast when daily audience < 1,000.

      **OUTPUT REQUIREMENTS (JSON):**
      - Use "X만", "X억" format for ALL large numbers (e.g. "250만", "1.5억"). NO "2.5M".
      - "comparisonMetric": A distinct, short string highlighting EXACTLY what data point was similar (e.g. "개봉 첫 주 오프닝 스코어 98% 일치", "2주차 드랍율 -45% 유사", "PSA(좌석판매율) 추이 동일").

      {
        "analysisText": "한국어 분석 (PSA 효율성 언급 필수).",
        "predictedFinalAudi": { "min": number, "max": number, "avg": number },
        "logicFactors": {
           "decayFactor": "e.g. '스크린 효율 저하로 인한 급감'",
           "seasonalityScore": "e.g. '주말 반등폭 제한적'",
           "momentum": "e.g. '좌석 판매율(PSA) 15명 (위험)'"
        },
        "similarMovies": [
          { "name": "Movie A", "finalAudi": "350만", "similarityReason": "Reason text", "comparisonMetric": "Specific Data Match Info", "matchType": "OPTIMISTIC" },
          { "name": "Movie B", "finalAudi": "280만", "similarityReason": "Reason text", "comparisonMetric": "Specific Data Match Info", "matchType": "REALISTIC" },
          { "name": "Movie C", "finalAudi": "150만", "similarityReason": "Reason text", "comparisonMetric": "Specific Data Match Info", "matchType": "PESSIMISTIC" }
        ],
        "similarMovieSeries": [Array of 7 numbers for the REALISTIC match, normalized to fit current scale],
        "predictionSeries": [Array of 3 integers for D+1, D+2, D+3]
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) return null;
    
    return JSON.parse(text) as PredictionResult;

  } catch (error) {
    console.error("Prediction Error:", error);
    return null;
  }
};