export interface TrendDataPoint {
  date: string;
  dateDisplay: string;
  audiCnt: number;
  salesAmt: number;
  scrnCnt: number;
  showCnt: number;
}

export interface RealtimeData {
  rank: string;
  rate: string;
  audiCnt: string; // 예매 관객
  audiAcc: string; // 누적 관객 (크롤링 데이터엔 없을 수도 있음)
  salesAmt: string; // 예매 매출
  salesAcc: string; // 누적 매출
}

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
  // [NEW] 확장 데이터 (미리 저장됨)
  trend?: TrendDataPoint[]; 
  realtime?: RealtimeData;
  posterUrl?: string;
  plot?: string;
}

export interface BoxOfficeResult {
  boxofficeType: string;
  showRange: string;
  dailyBoxOfficeList?: DailyBoxOfficeList[];
}

export interface RealtimeMovie {
  movieCd: string;
  rank: string;
  title: string;
  rate: string;
  audiCnt: string;
  salesAmt: string;
}

export interface NewsItem {
  title: string;
  link: string;
  desc: string;
  press: string;
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
