import { GoogleGenAI } from "@google/genai";
import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";
import { GEMINI_API_KEY } from "../constants";

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
  // Use the provided GEMINI_API_KEY from constants.ts
  if (!GEMINI_API_KEY || !movieInfo) {
    console.warn("Gemini API Key is missing. AI predictions disabled.");
    return null;
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  try {
    // 1. Feature Engineering (Prepare data for the "Model")
    const enrichedData = trendData.map((d, index) => {
      const dayName = getDayName(d.date);
      const daysSinceOpen = getDaysSinceRelease(d.date, movieInfo.openDt);
      
      // Calculate PSA (Per Screen Average)
      // PSA < 20 often triggers screen reduction in Korean theaters.
      const psa = d.scrnCnt && d.scrnCnt > 0 ? (d.audiCnt / d.scrnCnt).toFixed(1) : "0";

      // Calculate Growth Rate
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
    
    // 2. Construct the "Data Scientist" Prompt
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
         - Logic: If PSA is consistently low (< 20-30), predict screen reduction (decay).
         - Logic: If PSA is high (> 80), assume "Word of Mouth" boost.

      2. **Lifecycle & Seasonality**:
         - Apply log-decay based on 'lifecycleDay'.
         - Increase multiplier for upcoming Fri/Sat/Sun.

      3. **Final Total Prediction**:
         - Forecast = Current Accumulated + Projected Run.
         - Be conservative if the movie is older than 4 weeks.

      **OUTPUT REQUIREMENTS (JSON ONLY):**
      - Format numbers as "X만", "X.X억" (Korean format).
      - "comparisonMetric": Be specific (e.g. "Opening Score 98% match").

      {
        "analysisText": "Provide a concise Korean analysis focusing on PSA and momentum.",
        "predictedFinalAudi": { "min": number, "max": number, "avg": number },
        "logicFactors": {
           "decayFactor": "e.g. '-15% due to low PSA'",
           "seasonalityScore": "e.g. 'Weekend boost expected'",
           "momentum": "e.g. 'Stable'"
        },
        "similarMovies": [
          { "name": "Name", "finalAudi": "X만", "similarityReason": "Reason", "comparisonMetric": "Metric", "matchType": "OPTIMISTIC" },
          { "name": "Name", "finalAudi": "X만", "similarityReason": "Reason", "comparisonMetric": "Metric", "matchType": "REALISTIC" },
          { "name": "Name", "finalAudi": "X만", "similarityReason": "Reason", "comparisonMetric": "Metric", "matchType": "PESSIMISTIC" }
        ],
        "similarMovieSeries": [Array of 7 integers for the REALISTIC trend graph],
        "predictionSeries": [Array of 3 integers for D+1, D+2, D+3 forecast]
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
    console.error("Gemini Prediction Error:", error);
    return null;
  }
};