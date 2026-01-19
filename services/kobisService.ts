import { KobisResponse, TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

// [공통] 데이터 가져오기 (JSON 파일 -> 실패 시 API 호출)
const fetchWithFallback = async <T>(
  jsonUrl: string, 
  apiUrl: string, 
  transformFn?: (json: any) => T
): Promise<T | null> => {
  try {
    // 1. JSON 파일 시도 (캐시 방지)
    const jsonRes = await fetch(`${jsonUrl}?t=${Date.now()}`);
    if (jsonRes.ok) {
      const data = await jsonRes.json();
      return transformFn ? transformFn(data) : data;
    }
  } catch (e) {
    console.warn(`JSON Fetch Failed (${jsonUrl}), falling back to API...`);
  }

  try {
    // 2. 파일 없으면 API 호출
    const apiRes = await fetch(apiUrl);
    if (!apiRes.ok) throw new Error('API Error');
    return await apiRes.json();
  } catch (e) {
    console.error(`All fetch methods failed for ${apiUrl}`);
    return null;
  }
};

// 1. 일별 박스오피스 (JSON -> API)
export const fetchDailyBoxOffice = async (targetDt: string): Promise<any> => {
  // JSON 파일에서 읽기 시도
  const data = await fetchWithFallback(
    '/daily_data.json',
    `/kobis/daily?targetDt=${targetDt}`,
    (json) => {
      // JSON 파일 구조가 API 응답 구조와 다를 수 있으므로 맞춤
      if (json.movies) return { boxOfficeResult: { dailyBoxOfficeList: json.movies } };
      return json;
    }
  );
  
  return data || { boxOfficeResult: { dailyBoxOfficeList: [] } };
};

// 2. 실시간 예매율 (JSON -> API)
export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  const result = await fetchWithFallback(
    '/realtime_data.json',
    '/api/realtime',
    (json) => {
      // JSON(누적 데이터)에서 최신 랭킹 추출 로직
      if (!json || Object.keys(json).length === 0) return null;
      
      // 누적 데이터에서 최신 스냅샷 생성
      const list: RealtimeMovie[] = Object.keys(json).map((title, idx) => {
        const history = json[title];
        if (!history || history.length === 0) return null;
        const latest = history[history.length - 1];
        return {
          movieCd: String(idx), // 임시 ID
          rank: latest.rank,
          title: title,
          rate: String(latest.rate) + "%",
          salesAmt: "0", salesAcc: "0", audiCnt: "0", audiAcc: "0"
        };
      }).filter(item => item !== null) as RealtimeMovie[];

      list.sort((a, b) => Number(a.rank) - Number(b.rank));
      // 시간 정보 추출
      const time = list.length > 0 ? json[list[0].title].slice(-1)[0].time : "";
      
      return { status: "ok", data: list, crawledTime: time };
    }
  );

  if (result && result.status === 'ok') {
    return { data: result.data, crawledTime: result.crawledTime };
  }
  return { data: [], crawledTime: "" };
};

// 3. 뉴스 검색 (네이버 API 경유)
export const fetchMovieNews = async (keyword: string): Promise<NewsItem[]> => {
  try {
    const res = await fetch(`/api/news?keyword=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.status === 'ok' ? json.items : [];
  } catch { return []; }
};

// 4. 영화 상세정보
export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  try {
    const res = await fetch(`/kobis/detail?movieCd=${movieCd}`);
    const data = await res.json();
    return data.movieInfoResult.movieInfo;
  } catch { return null; }
};

// 5. 트렌드 (통계)
export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    const res = await fetch(`/kobis/trend?movieCd=${movieCd}&endDate=${endDateStr}`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
};

// 6. 실시간 상세 (예매율)
export const fetchRealtimeReservation = async (movieName: string, movieCd?: string) => {
  try {
    const q = movieCd ? `?movieName=${encodeURIComponent(movieName)}&movieCd=${movieCd}` : `?movieName=${encodeURIComponent(movieName)}`;
    const res = await fetch(`/api/reservation${q}`);
    const json = await res.json();
    if (json.found) return { data: { ...json.data, crawledTime: json.crawledTime } };
    return { data: null, error: json.debug_error };
  } catch (e: any) { return { data: null, error: e.message }; }
};
