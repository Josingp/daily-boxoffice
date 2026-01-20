import { TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

// [공통] 하이브리드 로딩 (JSON -> API)
const fetchWithFallback = async <T>(
  jsonUrl: string, 
  apiUrl: string, 
  transformFn?: (json: any) => T
): Promise<T | null> => {
  try {
    const jsonRes = await fetch(`${jsonUrl}?t=${Date.now()}`);
    if (jsonRes.ok) {
      const data = await jsonRes.json();
      return transformFn ? transformFn(data) : data;
    }
  } catch (e) {}

  try {
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
      if (json.status === 'ok') return json; // API 응답인 경우

      // History 파일 형식인 경우 변환
      if (!json || Object.keys(json).length === 0) return null;
      
      const list: RealtimeMovie[] = Object.keys(json).map((title, idx) => {
        const history = json[title];
        if (!Array.isArray(history) || history.length === 0) return null;
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

export const fetchMovieNews = async (keyword: string): Promise<NewsItem[]> => {
  try {
    const res = await fetch(`/api/news?keyword=${encodeURIComponent(keyword)}`);
    return res.ok ? (await res.json()).items : [];
  } catch { return []; }
};

export const fetchMoviePoster = async (movieName: string): Promise<string> => {
  try {
    const res = await fetch(`/api/poster?movieName=${encodeURIComponent(movieName)}`);
    return res.ok ? (await res.json()).url : "";
  } catch { return ""; }
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
    return json.found ? { data: { ...json.data, crawledTime: json.crawledTime } } : { data: null };
  } catch { return { data: null }; }
};
