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
  // [NEW] 확장 필드
  scrnInten?: number; // 스크린 수 변동
  showInten?: number; // 상영 횟수 변동
  realtime?: {        // 실시간 예매 데이터 병합
    rank: string;
    rate: string;
    audiCnt: string;
    audiAcc: string;
    salesAmt: string;
    salesAcc: string;
  };
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

export interface PredictionResult {
  analysisText: string;
  predictedFinalAudi: { min: number; max: number; avg: number };
  predictionSeries: number[];
}

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

export interface NewsItem {
  title: string;
  link: string;
  desc: string;
  press: string;
}
