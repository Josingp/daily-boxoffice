import { TrendDataPoint, MovieInfo, PredictionResult } from "../types";

// [수정] Vercel 백엔드(/predict)로 요청을 보냅니다.
export const predictMoviePerformance = async (
  movieName: string,
  trendData: TrendDataPoint[],
  movieInfo?: MovieInfo | null,
  currentAudiAcc: string = "0"
): Promise<PredictionResult | null> => {
  
  if (!movieInfo) return null;

  try {
    // 422 에러 해결: backend의 Pydantic 모델과 필드를 정확히 일치시켜야 함
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
      },
      // [!!!중요!!!] 이 줄이 빠져서 422 에러가 났던 것입니다. 꼭 넣어주세요.
      currentAudiAcc: currentAudiAcc.replace(/,/g, '') 
    };

    // 백엔드로 POST 요청
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
