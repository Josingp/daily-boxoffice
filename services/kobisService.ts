import { TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

// [핵심] JSON 파일 우선 -> 실패 시 실시간 API 호출
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
    console.warn(`File not found: ${jsonUrl}, trying API...`);
  }

  try {
    // 2. API 시도 (첫 실행이거나 파일 없을 때)
    const apiRes = await fetch(apiUrl);
    if (!apiRes.ok) throw new Error('API Error');
    return await apiRes.json();
  } catch (e) {
    return null;
  }
};

export const fetchDailyBoxOffice = async (targetDt: string): Promise<any> => {
  const data = await fetchWithFallback(
    '/daily_data.json',
    `/kobis/daily?targetDt=${targetDt}`,
    (json) => {
      if (json.movies) return { boxOfficeResult: { dailyBoxOfficeList: json.movies } };
      return json;
    }
  );
  return data || { boxOfficeResult: { dailyBoxOfficeList: [] } };
};

export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  const result = await fetchWithFallback(
    '/realtime_data.json',
    '/api/realtime',
    (json) => {
      // API 응답 구조인 경우
      if (json.status === 'ok') return json;

      // History 파일 구조인 경우 (최신값 추출)
      if (!json || Object.keys(json).length === 0) return null;
      
      const list: RealtimeMovie[] = Object.keys(json).map((title, idx) => {
        const history = json[title];
        if (!history || history.length === 0) return null;
        const latest = history[history.length - 1];
        return {
          movieCd: String(idx),
          rank: String(latest.rank),
          title: title,
          rate: String(latest.rate) + "%",
          salesAmt: "0", salesAcc: "0", audiCnt: "0", audiAcc: "0"
        };
      }).filter(Boolean) as RealtimeMovie[];

      list.sort((a, b) => Number(a.rank) - Number(b.rank));
      const time = list.length > 0 ? json[list[0].title].slice(-1)[0].time : "";
      
      return { status: "ok", data: list, crawledTime: time };
    }
  );

  return (result && result.status === 'ok') ? result : { data: [], crawledTime: "" };
};

// ... (뉴스, 상세정보 등 기존 유지)
export const fetchMovieNews = async (keyword: string): Promise<NewsItem[]> => {
  try {
    const res = await fetch(`/api/news?keyword=${encodeURIComponent(keyword)}`);
    return res.ok ? (await res.json()).items : [];
  } catch { return []; }
};

export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  try {
    const res = await fetch(`/kobis/detail?movieCd=${movieCd}`);
    return (await res.json()).movieInfoResult.movieInfo;
  } catch { return null; }
};

export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    const res = await fetch(`/kobis/trend?movieCd=${movieCd}&endDate=${endDateStr}`);
    return res.ok ? await res.json() : [];
  } catch { return []; }
};

export const fetchRealtimeReservation = async (movieName: string, movieCd?: string) => {
  try {
    const q = movieCd ? `?movieName=${encodeURIComponent(movieName)}&movieCd=${movieCd}` : `?movieName=${encodeURIComponent(movieName)}`;
    const res = await fetch(`/api/reservation${q}`);
    const json = await res.json();
    if (json.found) return { data: { ...json.data, crawledTime: json.crawledTime } };
    return { data: null, error: json.debug_error };
  } catch (e: any) { return { data: null, error: e.message }; }
};
