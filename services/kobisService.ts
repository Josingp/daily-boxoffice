import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, RealtimeMovie } from '../types';

const fetchFromBackend = async <T>(endpoint: string, params: Record<string, string> = {}): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${endpoint}?${query}` : endpoint;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network Err');
    return await res.json();
  } catch (e) { throw e; }
};

export const fetchDailyBoxOffice = async (targetDt: string) => fetchFromBackend<KobisResponse>('/kobis/daily', { targetDt });
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

// [NEW] 실시간 랭킹 전체 호출
export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  try {
    const res = await fetch('/api/realtime');
    const json = await res.json();
    if (json.status === 'ok') return { data: json.data, crawledTime: json.crawledTime };
    return { data: [], crawledTime: '' };
  } catch { return { data: [], crawledTime: '' }; }
};
