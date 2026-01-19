import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, RealtimeMovie } from '../types';

// ... (기존 코드들 유지) ...

// [NEW] 뉴스 데이터 타입
export interface NewsItem {
  title: string;
  link: string;
  desc: string;
  thumb?: string;
  press: string;
}

// ... (fetchFromBackend 등 기존 함수 유지) ...

// [NEW] 뉴스 검색 함수
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

// ... (나머지 export 함수들: fetchDailyBoxOffice, fetchRealtimeRanking 등 유지) ...
// 기존 파일 내용 전체를 유지하되, 위 fetchMovieNews 와 NewsItem 인터페이스만 추가하면 됩니다.
// 아래는 편의를 위해 전체 코드를 다시 드립니다.

const fetchFromBackend = async <T>(endpoint: string, params: Record<string, string> = {}): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${endpoint}?${query}` : endpoint;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Err');
    return await res.json();
  } catch (e) { throw e; }
};

export const fetchDailyBoxOffice = async (targetDt: string) => fetchFromBackend<KobisResponse>('/kobis/daily', { targetDt });
export const fetchWeeklyBoxOffice = async (targetDt: string, weekGb="1") => fetchFromBackend<KobisResponse>('/kobis/weekly', { targetDt, weekGb });
export const fetchMovieDetail = async (movieCd: string) => {
    try { return (await fetchFromBackend<KobisMovieInfoResponse>('/kobis/detail', { movieCd })).movieInfoResult.movieInfo; }
    catch { return null; }
};
export const fetchMovieTrend = async (movieCd: string, endDateStr: string) => {
    try { return await fetchFromBackend<TrendDataPoint[]>('/kobis/trend', { movieCd, endDate: endDateStr }); }
    catch { return []; }
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
export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  try {
    const res = await fetch('/api/realtime');
    const json = await res.json();
    if (json.status === 'ok') return { data: json.data, crawledTime: json.crawledTime };
    return { data: [], crawledTime: '' };
  } catch { return { data: [], crawledTime: '' }; }
};
