export interface DailyBoxOfficeList {
  rnum: string;
  rank: string;
  rankInten: string;
  rankOldAndNew: string;
  movieCd: string;
  movieNm: string;
  openDt: string;
  salesAmt: string;
  salesShare: string;
  salesInten: string;
  salesChange: string;
  salesAcc: string;
  audiCnt: string;
  audiInten: string;
  audiChange: string;
  audiAcc: string;
  scrnCnt: string;
  showCnt: string;
}

export interface BoxOfficeResult {
  boxofficeType: string;
  showRange: string;
  dailyBoxOfficeList?: DailyBoxOfficeList[];
  weeklyBoxOfficeList?: DailyBoxOfficeList[]; // Weekly uses same structure for items
}

export interface KobisResponse {
  boxOfficeResult: BoxOfficeResult;
}

export interface TrendDataPoint {
  date: string;
  dateDisplay: string;
  audiCnt: number;
  scrnCnt?: number; // Added for analysis
  // Optional fields for chart merging
  similarCnt?: number;
  predictCnt?: number;
}

// Movie Detail Types
export interface MovieInfo {
  movieCd: string;
  movieNm: string;
  movieNmEn: string;
  showTm: string;
  openDt: string;
  prdtStatNm: string;
  typeNm: string;
  nations: { nationNm: string }[];
  genres: { genreNm: string }[];
  directors: { peopleNm: string; peopleNmEn: string }[];
  actors: { peopleNm: string; peopleNmEn: string }[];
  audits: { watchGradeNm: string }[];
  companys: { companyNm: string }[];
}

export interface MovieInfoResult {
  movieInfo: MovieInfo;
}

export interface KobisMovieInfoResponse {
  movieInfoResult: MovieInfoResult;
}

export interface SimilarMovieScenario {
  name: string;
  finalAudi: string;
  similarityReason: string;
  comparisonMetric: string; // Specific data point (e.g. "Opening Score 98% match")
  matchType: 'OPTIMISTIC' | 'REALISTIC' | 'PESSIMISTIC';
}

export interface PredictionResult {
  analysisText: string;
  predictedFinalAudi: {
    min: number;
    max: number;
    avg: number;
  };
  // Algorithm factors to display in UI
  logicFactors: {
    decayFactor: string; // e.g., "-15% (Week 3)"
    seasonalityScore: string; // e.g., "High (Saturday Approaching)"
    momentum: string; // e.g., "Stable"
  };
  similarMovies: SimilarMovieScenario[];
  similarMovieSeries: number[]; // Trend of the most realistic match
  predictionSeries: number[]; // Next 3 days prediction
}

// [추가] 실시간 예매 데이터 타입
// ... 기존 코드 유지 ...

// [수정] ReservationData에 페이지 소스의 필드들 추가
export interface ReservationData {
  rank: string;
  title: string;
  rate: string;      // 예매율
  salesAmt: string;  // 예매매출액 (New)
  salesAcc: string;  // 누적매출액 (New)
  audiCnt: string;   // 예매관객수
  audiAcc: string;   // 누적관객수 (New)
}
}
