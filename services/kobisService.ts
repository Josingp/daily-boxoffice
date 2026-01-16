import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, ReservationData } from '../types';

// FastAPI 백엔드 호출 헬퍼
const fetchFromBackend = async <T>(endpoint: string, params: Record<string, string>): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  // vite.config.ts의 proxy 설정(/kobis -> localhost:8000/kobis)에 따라 요청
  const response = await fetch(`${endpoint}?${query}`);
  if (!response.ok) throw new Error(`Backend Error: ${response.status}`);
  return await response.json();
};

export const fetchDailyBoxOffice = async (targetDt: string): Promise<KobisResponse> => {
  return fetchFromBackend<KobisResponse>('/kobis/daily', { targetDt });
};

export const fetchWeeklyBoxOffice = async (targetDt: string, weekGb = "1"): Promise<KobisResponse> => {
  return fetchFromBackend<KobisResponse>('/kobis/weekly', { targetDt, weekGb });
};

export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  try {
    const data = await fetchFromBackend<KobisMovieInfoResponse>('/kobis/detail', { movieCd });
    return data.movieInfoResult.movieInfo;
  } catch {
    return null;
  }
};

export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    return await fetchFromBackend<TrendDataPoint[]>('/kobis/trend', { movieCd, endDate: endDateStr });
  } catch {
    return [];
  }
};

// [수정됨] 실시간 예매율 (백엔드 /api/reservation 호출)
export const fetchRealtimeReservation = async (movieName: string): Promise<ReservationData | null> => {
  try {
    // 1. URL 인코딩 적용 (한글 깨짐 방지)
    const encodedName = encodeURIComponent(movieName);
    
    // 2. Vite Proxy를 통해 FastAPI 백엔드로 요청
    const response = await fetch(`/api/reservation?movieName=${encodedName}`);
    
    if (!response.ok) return null;

    const json = await response.json();
    
    if (json.found) {
      return json.data; 
    } else {
      console.warn(`[Reservation] '${movieName}' not found in Top list.`);
      return null;
    }
  } catch (error) {
    console.error("Reservation Fetch Error:", error);
    return null;
  }
};
