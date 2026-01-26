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

// [수정] 드라마 상세 정보 필드 추가
export interface DramaItem {
  rank: string;
  channel: string;
  title: string;
  rating: string;     
  ratingVal: number;  
  area: string;
  trend?: DramaTrend[]; 
  
  // 네이버 크롤링 추가 필드
  posterUrl?: string;
  broadcaster?: string; // 편성 정보 (예: KBS2 월~금...)
  cast?: string;        // 출연진
  summary?: string;     // 줄거리/소개
}

export interface DramaData {
  date: string;
  nationwide: DramaItem[];
  capital: DramaItem[];
}
