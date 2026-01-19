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
  weeklyBoxOfficeList?: DailyBoxOfficeList[];
}

export interface KobisResponse {
  boxOfficeResult: BoxOfficeResult;
}

export interface TrendDataPoint {
  date: string;
  dateDisplay: string;
  audiCnt: number;
  scrnCnt?: number;
  similarCnt?: number;
  predictCnt?: number;
}

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
  comparisonMetric: string;
  matchType: 'OPTIMISTIC' | 'REALISTIC' | 'PESSIMISTIC';
}

export interface PredictionResult {
  analysisText: string;
  predictedFinalAudi: {
    min: number;
    max: number;
    avg: number;
  };
  logicFactors: {
    decayFactor: string;
    seasonalityScore: string;
    momentum: string;
  };
  similarMovies: SimilarMovieScenario[];
  similarMovieSeries: number[];
  predictionSeries: number[];
}

// [수정됨] crawledTime 필드 추가
export interface ReservationData {
  rank: string;
  title: string;
  rate: string;
  salesAmt: string;
  salesAcc: string;
  audiCnt: string;
  audiAcc: string;
  crawledTime?: string; // 예: "2026/01/19 10:52"
}
