import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

const BACKEND_URL = "http://localhost:8000/predict";

export const getMoviePrediction = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo: MovieInfo,
  currentAudiAcc: string
): Promise<PredictionResult | null> => {
  try {
    // 1. Construct the payload matching the Python Pydantic models
    const payload = {
      movieName: movieName,
      trendData: trendData.map(d => ({
        date: d.date,
        audiCnt: d.audiCnt,
        scrnCnt: d.scrnCnt || 0
      })),
      movieInfo: {
        movieNm: movieInfo.movieNm,
        openDt: movieInfo.openDt,
        genres: movieInfo.genres.map(g => g.genreNm),
        audiAcc: currentAudiAcc.replace(/,/g, '') // Remove commas if any
      }
    };

    // 2. Call the Backend
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Backend Error: ${response.status}`);
    }

    const result: PredictionResult = await response.json();
    return result;

  } catch (error) {
    console.error("Prediction Service Failed:", error);
    // Fallback: Return null so UI handles it gracefully (or use local fallback logic if needed)
    return null;
  }
};
