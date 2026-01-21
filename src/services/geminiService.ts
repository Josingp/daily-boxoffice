import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

export interface ExtendedPredictionResult extends PredictionResult {
  searchKeywords?: string[];
}

export const predictMoviePerformance = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo?: MovieInfo | null,
  currentAudiAcc: string = "0",
  // [추가] 제작비 정보 (없으면 0)
  productionCost: number = 0,
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
        scrnCnt: d.scrnCnt || 0,
        salesAmt: d.salesAmt || 0 // 매출액 정보 필수
      })),
      movieInfo: {
        movieNm: movieInfo.movieNm,
        openDt: movieInfo.openDt,
        genres: movieInfo.genres.map(g => g.genreNm),
        audiAcc: currentAudiAcc.replace(/,/g, '')
      },
      currentAudiAcc: currentAudiAcc.replace(/,/g, ''),
      productionCost, // [추가] 제작비 전달
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
