import { TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

// [핵심] JSON 파일 우선 -> 실패하거나 비어있으면 실시간 API 호출
const fetchWithFallback = async <T>(
  jsonUrl: string, 
  apiUrl: string, 
  transformFn?: (json: any) => T | null
): Promise<T | null> => {
  // 1. JSON 파일 시도
  try {
    const jsonRes = await fetch(`${jsonUrl}?t=${Date.now()}`);
    if (jsonRes.ok) {
      const data = await jsonRes.json();
      // 변환 함수 실행
      const result = transformFn ? transformFn(data) : data;
      
      // [중요] 결과가 유효하면 반환, 아니면(null) API로 넘어감
      if (result) return result; 
      console.warn(`Data in ${jsonUrl} is invalid or empty. Switching to API...`);
    } else {
      console.warn(`File not found: ${jsonUrl} (${jsonRes.status}). Switching to API...`);
    }
  } catch (e) {
    console.warn(`JSON Fetch Error: ${e}. Switching to API...`);
  }

  // 2. API 시도 (파일 실패/비어있음/404일 때 실행)
  try {
    console.log(`Fetching from API fallback: ${apiUrl}`);
    const apiRes = await fetch(apiUrl);
    if (!apiRes.ok) throw new Error(`API Error ${apiRes.status}`);
    return await apiRes.json();
  } catch (e) {
    console.error(`All fetch methods failed for ${apiUrl}`, e);
    return null;
  }
};

export const fetchDailyBoxOffice = async (targetDt: string): Promise<any> => {
  const data = await fetchWithFallback(
    '/daily_data.json',
    `/kobis/daily?targetDt=${targetDt}`,
    (json) => {
      // 데이터 유효성 검사
      if (json && json.movies && json.movies.length > 0) {
        return { boxOfficeResult: { dailyBoxOfficeList: json.movies } };
      }
      return null; // 비어있으면 API 호출 유도
    }
  );
  return data || { boxOfficeResult: { dailyBoxOfficeList: [] } };
};

export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  const result = await fetchWithFallback(
    '/realtime_data.json',
    '/api/realtime',
    (json) => {
      // 1. API 응답 형식 ({ status: "ok", data: [...] })
      if (json.status === 'ok' && Array.isArray(json.data) && json.data.length > 0) return json;

      // 2. History 파일 형식 ({ "영화제목": [...] })
      if (!json || Object.keys(json).length === 0) return null; // 빈 객체면 null 반환 -> API 호출
      
      try {
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

        if (list.length === 0) return null;

        list.sort((a, b) => Number(a.rank) - Number(b.rank));
        
        // 시간 정보 추출 (안전하게)
        let time = "";
        const firstKey = Object.keys(json)[0];
        if (firstKey && json[firstKey].length > 0) {
            time = json[firstKey].slice(-1)[0].time;
        }
        
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
