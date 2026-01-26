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

// [핵심] 드라마 트렌드 타입: rating은 숫자여야 함
export interface DramaTrend {
    date: string;
    rating: number; 
}

export interface DramaItem {
  rank: string;
  channel: string;
  title: string;
  rating: string;     // 화면 표시용 (예: "17.1")
  ratingVal: number;  // 그래프용 숫자 (예: 17.1)
  area: string;
  trend?: DramaTrend[]; // 추이 데이터
}

export interface DramaData {
  date: string;
  nationwide: DramaItem[];
  capital: DramaItem[];
}
