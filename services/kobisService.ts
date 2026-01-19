import { KobisResponse, TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

// [변경] 일별 데이터는 이제 JSON 파일에서 읽어옵니다.
export const fetchDailyBoxOffice = async (targetDt: string): Promise<any> => {
  try {
    // 캐시 방지를 위해 타임스탬프 추가
    const res = await fetch(`/daily_data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error("Load Failed");
    const json = await res.json();
    return { 
      boxOfficeResult: { 
        dailyBoxOfficeList: json.movies 
      } 
    };
  } catch (e) {
    console.error(e);
    return { boxOfficeResult: { dailyBoxOfficeList: [] } };
  }
};

// [변경] 실시간 데이터도 JSON 파일에서 최신값만 추출해서 보여줍니다.
export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  try {
    const res = await fetch(`/realtime_data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error("Load Failed");
    const json = await res.json();
    
    // JSON({영화명: [이력...]})을 리스트 형태로 변환
    const list: RealtimeMovie[] = Object.keys(json).map((title, idx) => {
      const history = json[title];
      const latest = history[history.length - 1]; // 가장 최신 데이터
      return {
        movieCd: String(idx), // 임시 ID
        rank: latest.rank,
        title: title,
        rate: String(latest.rate) + "%",
        salesAmt: "0",
        salesAcc: "0",
        audiCnt: "0", // 실시간은 예매율 위주로
        audiAcc: "0"
      };
    }).sort((a, b) => Number(a.rank) - Number(b.rank)); // 순위 정렬

    // 최신 시간 추출
    const time = list.length > 0 ? json[list[0].title].slice(-1)[0].time : "";

    return { data: list, crawledTime: time };
  } catch (e) {
    return { data: [], crawledTime: "" };
  }
};

// 뉴스 검색 (서버 경유)
export const fetchMovieNews = async (keyword: string): Promise<NewsItem[]> => {
  try {
    const response = await fetch(`/api/news?keyword=${encodeURIComponent(keyword)}`);
    if (!response.ok) return [];
    const json = await response.json();
    return json.status === 'ok' ? json.items : [];
  } catch {
    return [];
  }
};

// 트렌드 데이터 (필요 시 기존 API 사용)
export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
    try {
        const res = await fetch(`/kobis/trend?movieCd=${movieCd}&endDate=${endDateStr}`);
        if(!res.ok) return [];
        return await res.json();
    } catch { return []; }
};

export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
    // 일별 데이터에 이미 detail이 포함되어 있다면 그걸 써야 하지만, 
    // 구조상 여기선 API를 호출하거나, App.tsx에서 전달받은 데이터를 써야 함.
    try {
        const res = await fetch(`/kobis/detail?movieCd=${movieCd}`);
        const data = await res.json();
        return data.movieInfoResult.movieInfo;
    } catch { return null; }
};

// 실시간 예약 (상세)
export const fetchRealtimeReservation = async (movieName: string, movieCd?: string) => {
  try {
    const q = movieCd ? `?movieName=${encodeURIComponent(movieName)}&movieCd=${movieCd}` : `?movieName=${encodeURIComponent(movieName)}`;
    const res = await fetch(`/api/reservation${q}`);
    const json = await res.json();
    if (json.found) return { data: { ...json.data, crawledTime: json.crawledTime } };
    return { data: null, error: json.debug_error };
  } catch (e: any) { return { data: null, error: e.message }; }
};
