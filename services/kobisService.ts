import { TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

const fetchWithFallback = async <T>(
  jsonUrl: string, 
  apiUrl: string, 
  transformFn?: (json: any) => T
): Promise<T | null> => {
  try {
    const jsonRes = await fetch(`${jsonUrl}?t=${Date.now()}`);
    if (jsonRes.ok) {
      const data = await jsonRes.json();
      if (data && Object.keys(data).length > 0) return transformFn ? transformFn(data) : data;
    }
  } catch (e) { console.warn(`Fallback to API for ${jsonUrl}`); }

  try {
    const apiRes = await fetch(apiUrl);
    if (!apiRes.ok) throw new Error('API Error');
    return await apiRes.json();
  } catch (e) { return null; }
};

export const fetchDailyBoxOffice = async (targetDt: string): Promise<any> => {
  return await fetchWithFallback(
    '/daily_data.json',
    `/kobis/daily?targetDt=${targetDt}`,
    (json) => {
      if (json.movies) return { boxOfficeResult: { dailyBoxOfficeList: json.movies } };
      return json;
    }
  ) || { boxOfficeResult: { dailyBoxOfficeList: [] } };
};

export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  const result = await fetchWithFallback(
    '/realtime_data.json',
    '/api/realtime',
    (json) => {
      if (json.status === 'ok') return json;

      try {
        const meta = json.meta || {};
        const movieKeys = Object.keys(json).filter(k => k !== 'meta');
        
        const list: RealtimeMovie[] = movieKeys.map((title, idx) => {
          const history = json[title];
          if (!Array.isArray(history) || history.length === 0) return null;
          const latest = history[history.length - 1];
          const rawRate = String(latest.rate);
          const formattedRate = rawRate.includes('%') ? rawRate : `${rawRate}%`;

          // [핵심] 저장된 상세정보 매핑
          return {
            movieCd: String(idx),
            rank: String(latest.rank),
            title: title,
            rate: formattedRate,
            salesAmt: String(latest.salesAmt || "0").replace(/,/g, ''),
            salesAcc: String(latest.salesAcc || "0").replace(/,/g, ''),
            audiCnt: String(latest.audiCnt || "0").replace(/,/g, ''),
            audiAcc: String(latest.audiAcc || "0").replace(/,/g, ''),
            detail: meta[title] || null // <-- 여기서 포스터/감독 정보가 들어감
          };
        }).filter(Boolean) as RealtimeMovie[];

        list.sort((a, b) => Number(a.rank) - Number(b.rank));
        const time = list.length > 0 ? json[list[0].title].slice(-1)[0].time : "";
        return { status: "ok", data: list, crawledTime: time };
      } catch { return null; }
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
