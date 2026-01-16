import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

// [수정] 배포 환경을 위해 상대 경로 사용 ("/predict")
const BACKEND_URL = "/predict";

export const getMoviePrediction = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo: MovieInfo,
  currentAudiAcc: string
): Promise<PredictionResult | null> => {
  try {
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
        audiAcc: currentAudiAcc.replace(/,/g, '')
      }
    };

    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Prediction Error (${response.status})`);
    }

    return await response.json();

  } catch (error) {
    console.error("Gemini Prediction Failed:", error);
    return null;
  }
};
