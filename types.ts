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

// [추가] 드라마 트렌드 타입
export interface DramaTrend {
    date: string;
    rating: number;
}

// [수정] 드라마 아이템 타입
export interface DramaItem {
  rank: string;
  channel: string;
  title: string;
  rating: string;     // 화면 표시용 (예: "15.4")
  ratingVal: number;  // 그래프용 숫자 (예: 15.4)
  area: string;
  trend?: DramaTrend[]; // 30일 추이 데이터
}

export interface DramaData {
  date: string;
  nationwide: DramaItem[];
  capital: DramaItem[];
}
