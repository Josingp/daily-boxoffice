import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, ReservationData } from '../types';

// [중요] 백엔드 API 호출 헬퍼 (상대 경로 사용)
// 로컬에서는 http://localhost:8000으로, 배포 시에는 /api 경로로 자동 연결됩니다.
const fetchFromBackend = async <T>(endpoint: string, params: Record<string, string> = {}): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${endpoint}?${query}` : endpoint;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Backend Error (${response.status}): ${await response.text()}`);
  }
  return await response.json();
};

export const fetchDailyBoxOffice = async (targetDt: string): Promise<KobisResponse> => {
  // 백엔드의 /kobis/daily 엔드포인트 호출
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

export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    // 백엔드의 /kobis/trend 사용 (속도 훨씬 빠름)
    return await fetchFromBackend<TrendDataPoint[]>('/kobis/trend', { movieCd, endDate: endDateStr });
  } catch (e) {
    console.error("Trend Fetch Error:", e);
    return [];
  }
};

// 실시간 예매율 (백엔드 크롤링)
export const fetchRealtimeReservation = async (movieName: string): Promise<ReservationData | null> => {
  try {
    const response = await fetchFromBackend<{found: boolean, data: ReservationData}>(
      '/api/reservation', 
      { movieName } // 자동으로 URL 인코딩 처리됨
    );
    
    if (response.found && response.data) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.warn("[Reservation] Fetch failed:", error);
    return null;
  }
};
