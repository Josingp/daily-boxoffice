import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, ReservationData } from '../types';

// FastAPI 백엔드 호출 헬퍼
const fetchFromBackend = async <T>(endpoint: string, params: Record<string, string> = {}): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${endpoint}?${query}` : endpoint;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Backend Error (${response.status})`);
  }
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
  } catch (e) {
    console.error("Movie Detail Error:", e);
    return null;
  }
};

// [개선됨] 백엔드의 집계 API 사용 (속도 최적화)
export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    return await fetchFromBackend<TrendDataPoint[]>('/kobis/trend', { movieCd, endDate: endDateStr });
  } catch (e) {
    console.error("Trend Fetch Error:", e);
    return [];
  }
};

// [수정됨] 실시간 예매율 (백엔드 크롤러 호출)
export const fetchRealtimeReservation = async (movieName: string): Promise<ReservationData | null> => {
  try {
    // 1. URL 인코딩 적용 (한글 깨짐 방지)
    const encodedName = encodeURIComponent(movieName);
    
    // 2. Vite Proxy -> FastAPI
    const response = await fetch(`/api/reservation?movieName=${encodedName}`);
    
    if (!response.ok) return null;

    const json = await response.json();
    
    if (json.found) {
      return json.data; 
    } else {
      console.warn(`[Reservation] '${movieName}' not found in list (Scanned: ${json.scanned}).`);
      return null;
    }
  } catch (error) {
    console.error("Reservation Fetch Error:", error);
    return null;
  }
};
