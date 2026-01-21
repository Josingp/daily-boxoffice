import { TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';
import manualData from '../manual_data.json'; // [NEW] JSON 파일 임포트

const MANUAL_DATA = manualData as Record<string, { posterUrl?: string, productionCost?: number }>;

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

          return {
            movieCd: String(idx),
            rank: String(latest.rank),
            title: title,
            rate: formattedRate,
            // 콤마 제거 및 안전한 문자열 변환
            salesAmt: String(latest.salesAmt || "0").replace(/,/g, ''),
            salesAcc: String(latest.salesAcc || "0").replace(/,/g, ''),
            audiCnt: String(latest.audiCnt || "0").replace(/,/g, ''),
            audiAcc: String(latest.audiAcc || "0").replace(/,/g, ''),
            // 저장된 상세정보가 있으면 사용
            detail: meta[title] || null
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

export const fetchMoviePoster = async (movieName: string): Promise<string> => {
  // 1. 수동 설정 확인 (띄어쓰기 무시하고 비교)
  const key = Object.keys(MANUAL_DATA).find(k => k.replace(/\s+/g, '') === movieName.replace(/\s+/g, ''));
  if (key && MANUAL_DATA[key].posterUrl) {
    return MANUAL_DATA[key].posterUrl!;
  }

  // 2. API 호출
  try {
    const res = await fetch(`/api/poster?movieName=${encodeURIComponent(movieName)}`);
    return res.ok ? (await res.json()).url : "";
  } catch { return ""; }
};

// ... (나머지 news, detail, trend, reservation 함수는 기존 유지)
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
    return json.found ? { data: { ...json.data, crawledTime: json.crawledTime } } : { data: null };
  } catch { return { data: null }; }
};
