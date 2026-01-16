import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

// [핵심 수정] Google 라이브러리 직접 사용 금지 (API 키 노출/누락 방지)
// 대신 Vercel 백엔드(/predict)로 요청을 보냅니다.
export const predictMoviePerformance = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo?: MovieInfo | null,
  currentAudiAcc: string = "0"
): Promise<PredictionResult | null> => {
  
  if (!movieInfo) return null;

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

    // 백엔드로 POST 요청
    const response = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Backend Error: ${response.status}`);
      return null;
    }

    return await response.json();

  } catch (error) {
    console.error("AI Service Error:", error);
    return null;
  }
};
