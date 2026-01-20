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
  rate: string;       // 예매율
  audiCnt: string;    // 예매관객수 (그래프 기준)
  salesAmt: string;   // 예매매출액
  audiAcc: string;    // 누적관객수
  salesAcc: string;   // 누적매출액
  crawledTime?: string; // 업데이트 기준 시간
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
  
  // 확장 데이터
  scrnInten?: number; 
  showInten?: number;
  trend?: TrendDataPoint[];
  realtime?: RealtimeData;
  posterUrl?: string;
}

export interface RealtimeMovie {
  movieCd: string;
  rank: string;
  title: string;
  rate: string;
  audiCnt: string;
  salesAmt: string;
  audiAcc: string;
  salesAcc: string;
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

export interface NewsItem {
  title: string;
  link: string;
  desc: string;
  press: string;
}
