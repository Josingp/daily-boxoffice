export interface TrendDataPoint {
  date: string;
  dateDisplay?: string; // 옵션으로 변경
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
  audiCnt: string; // 예매 관객수
  salesAmt: string;
  audiAcc: string; // 누적 관객수
  salesAcc: string;
  crawledTime?: string;
  detail?: MovieInfo; // 상세정보 포함 가능
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
  trend?: TrendDataPoint[]; // 트렌드 데이터
  detail?: MovieInfo;       // 상세 정보
  realtime?: RealtimeMovie; // 실시간 정보 (매칭될 경우)
  scrnInten?: number;       // 전일 대비 스크린 증감 (계산됨)
  showInten?: number;       // 전일 대비 상영회차 증감 (계산됨)
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

// [추가됨] 드라마 데이터 타입
export interface DramaItem {
  rank: string;
  channel: string;
  title: string;
  rating: string;
  area: string;
}

export interface DramaData {
  date: string;
  nationwide: DramaItem[];
  capital: DramaItem[];
}
