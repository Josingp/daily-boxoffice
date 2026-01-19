import { KobisResponse, TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

// [핵심] 안전한 데이터 패칭 (JSON -> API Failover)
const fetchWithFallback = async <T>(
  jsonUrl: string, 
  apiUrl: string, 
  transformFn?: (json: any) => T
): Promise<T | null> => {
  // 1. JSON 파일 시도
  try {
    const jsonRes = await fetch(`${jsonUrl}?t=${Date.now()}`);
    // 404가 아니면 파싱 시도
    if (jsonRes.ok) {
      const text = await jsonRes.text();
      try {
        const data = JSON.parse(text); // 여기서 에러나면 catch로 이동
        return transformFn ? transformFn(data) : data;
      } catch (parseError) {
        console.warn(`JSON Parse Failed (${jsonUrl}), skipping...`);
      }
    }
  } catch (e) {
    console.warn(`JSON Fetch Failed (${jsonUrl}), falling back to API...`);
  }

  // 2. 파일 실패 시 API 호출
  try {
    console.log(`Calling API fallback: ${apiUrl}`);
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
      // JSON 구조가 { status: 'ok', data: [...] } 인지, { 영화명: [...] } 인지 확인
      if (json.status === 'ok' && Array.isArray(json.data)) return json; // API 응답 구조

      // History 파일 구조일 경우 변환
      if (!json || Object.keys(json).length === 0) return null;
      
      const list: RealtimeMovie[] = Object.keys(json).map((title, idx) => {
        const history = json[title];
        if (!history || history.length === 0) return null;
        const latest = history[history.length - 1];
        return {
          movieCd: String(idx),
          rank: latest.rank,
          title: title,
          rate: String(latest.rate) + "%",
          salesAmt: "0", salesAcc: "0", audiCnt: "0", audiAcc: "0"
        };
      }).filter(item => item !== null) as RealtimeMovie[];

      list.sort((a, b) => Number(a.rank) - Number(b.rank));
      const time = list.length > 0 ? json[list[0].title].slice(-1)[0].time : "";
      return { status: "ok", data: list, crawledTime: time };
    }
  );

  if (result && result.status === 'ok') {
    return { data: result.data, crawledTime: result.crawledTime };
  }
  // 완전 실패 시 빈 배열 반환 (에러 화면 방지)
  return { data: [], crawledTime: "" };
};

export const fetchMovieNews = async (keyword: string): Promise<NewsItem[]> => {
  try {
    const res = await fetch(`/api/news?keyword=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.status === 'ok' ? json.items : [];
  } catch { return []; }
};

export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  try {
    const res = await fetch(`/kobis/detail?movieCd=${movieCd}`);
    const data = await res.json();
    return data.movieInfoResult.movieInfo;
  } catch { return null; }
};

export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    const res = await fetch(`/kobis/trend?movieCd=${movieCd}&endDate=${endDateStr}`);
    if (!res.ok) return [];
    return await res.json();
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
