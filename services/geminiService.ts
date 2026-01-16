import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

// [수정] Google 라이브러리 제거! 
// 이제 브라우저가 아니라, Vercel 백엔드(/predict)에게 대신 물어봅니다.
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

    // Vercel 백엔드로 요청 전송
    const response = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // 백엔드 에러 로그 확인
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
