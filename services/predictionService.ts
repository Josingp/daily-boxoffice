import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

export const predictMoviePerformance = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo?: MovieInfo | null,
  currentAudiAcc: string = "0"
): Promise<PredictionResult | null> => {
  if (!movieInfo) return null;

  try {
    // 1. 간단한 예측값 계산 (Node.js로 넘기기 전 D+1~3 단순 계산)
    // 복잡한 로직은 백엔드에서 처리하거나, 여기서 계산해서 넘겨도 됩니다.
    // 여기서는 간단히 '0'으로 채워서 넘기고 백엔드(AI)가 분석에 집중하게 합니다.
    const lastAudi = trendData[trendData.length - 1]?.audiCnt || 0;
    const predictionSeries = [lastAudi, lastAudi, lastAudi]; // 임시 값

    const payload = {
      movieName,
      trendData,
      movieInfo: {
        movieNm: movieInfo.movieNm,
        openDt: movieInfo.openDt,
        genres: movieInfo.genres.map(g => ({ genreNm: g.genreNm })),
        audiAcc: currentAudiAcc.replace(/,/g, '')
      },
      currentAudiAcc: currentAudiAcc.replace(/,/g, ''),
      predictionSeries,
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    };

    const response = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Backend Error (${response.status})`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("AI Service Error:", error);
    return null;
  }
};
