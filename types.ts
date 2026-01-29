export interface TrendDataPoint {
  date: string;
  dateDisplay?: string; 
  audiCnt: number;
  salesAmt: number;
  scrnCnt: number;
  showCnt: number;
}

export interface MovieInfo {
  movieNm: string;
  movieNmEn: string;
  showTm: string;
  prdtYear: string;
  openDt: string;
  genres: { genreNm: string }[];
  directors: { peopleNm: string }[];
  actors: { peopleNm: string }[];
  watchGradeNm?: string;
}

export interface RealtimeMovie {
  rank: string;
  title: string;
  rate: string;
  audiCnt: string; 
  salesAmt: string;
  audiAcc: string; 
  salesAcc: string;
  crawledTime?: string;
  detail?: MovieInfo; 
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
  trend?: TrendDataPoint[]; 
  detail?: MovieInfo;       
  realtime?: RealtimeMovie; 
  scrnInten?: number;       
  showInten?: number;       
}

export interface BoxOfficeResult {
  boxofficeType: string;
  showRange: string;
  dailyBoxOfficeList: DailyBoxOfficeList[];
}

export interface PredictionResult {
    movieName: string;
    predictionSeries: number[];
    analysisText: string;
    predictedFinalAudi: {
        min: number;
        max: number;
        avg: number;
    } | null;
}

export interface DramaTrend {
    date: string;
    rating: number; 
}

export interface DramaItem {
  rank: string | number; // 순위가 숫자일 수도 있음
  mediaType?: string;    // 지상파/종편/케이블 구분
  channel: string;
  title: string;
  rating: string;     
  ratingVal: number;  
  area: string;
  trend?: DramaTrend[]; 
  
  // 네이버 크롤링 추가 필드
  posterUrl?: string;
  broadcaster?: string; 
  cast?: string;        
  summary?: string;     
}

// [수정] 주간 순위 데이터 추가
export interface DramaData {
  date: string;
  nationwide: DramaItem[];        // 일일 전국
  capital: DramaItem[];           // 일일 수도권
  weekly_nationwide?: DramaItem[]; // 주간 전국 (옵셔널)
  weekly_capital?: DramaItem[];    // 주간 수도권 (옵셔널)
}
