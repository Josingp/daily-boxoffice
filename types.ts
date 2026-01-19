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
}

export interface MovieInfo {
  movieCd: string;
  movieNm: string;
  openDt: string;
  genres: { genreNm: string }[];
  directors: { peopleNm: string }[];
  actors: { peopleNm: string }[];
}

export interface KobisMovieInfoResponse {
  movieInfoResult: {
    movieInfo: MovieInfo;
  };
}

export interface PredictionResult {
  analysisText: string;
  predictedFinalAudi: { min: number; max: number; avg: number };
  predictionSeries: number[];
}

// [수정] 시간 정보 포함
export interface ReservationData {
  rank: string;
  title: string;
  rate: string;
  salesAmt: string;
  salesAcc: string;
  audiCnt: string;
  audiAcc: string;
  crawledTime?: string;
}

// [NEW] 실시간 랭킹용 인터페이스
export interface RealtimeMovie {
  movieCd: string;
  rank: string;
  title: string;
  rate: string;
  salesAmt: string;
  salesAcc: string;
  audiCnt: string;
  audiAcc: string;
}
