import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

export const predictMoviePerformance = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo?: MovieInfo | null,
  currentAudiAcc: string = "0",
  comparison?: { today: number; yesterday: number; diff: number; rate: string } | null
): Promise<PredictionResult | null> => {
  
  if (!movieInfo) return null;

  try {
    const payload = {
      movieName: movieName,
      trendData: trendData.map(d => ({
        date: d.date,
        dateDisplay: d.dateDisplay, // [추가] 오늘/날짜 표시용
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
      comparison: comparison // [NEW] 전일 대비 증감 데이터 전달
    };

    const response = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Backend Error (${response.status}):`, errorText);
      return null;
    }

    return await response.json();

  } catch (error) {
    console.error("AI Service Error:", error);
    return null;
  }
};
