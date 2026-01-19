import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

// [수정] 결과 인터페이스 확장
export interface ExtendedPredictionResult extends PredictionResult {
  searchKeywords?: string[];
}

export const predictMoviePerformance = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo?: MovieInfo | null,
  currentAudiAcc: string = "0",
  comparison?: { today: number; yesterday: number; diff: number; rate: string } | null
): Promise<ExtendedPredictionResult | null> => {
  
  if (!movieInfo) return null;

  try {
    const payload = {
      movieName,
      trendData: trendData.map(d => ({
        date: d.date,
        dateDisplay: d.dateDisplay,
        audiCnt: d.audiCnt,
        scrnCnt: d.scrnCnt || 0
      })),
      movieInfo: {
        movieNm: movieInfo.movieNm,
        openDt: movieInfo.openDt,
        genres: movieInfo.genres.map(g => g.genreNm),
        audiAcc: currentAudiAcc.replace(/,/g, '')
      },
      currentAudiAcc: currentAudiAcc.replace(/,/g, ''),
      comparison
    };

    const response = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return null;
    return await response.json();

  } catch (error) {
    console.error("AI Service Error:", error);
    return null;
  }
};
