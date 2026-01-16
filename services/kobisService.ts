import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, ReservationData } from '../types';

/**
 * [Vercel 배포용 설정]
 * 도메인(http://localhost 등)을 생략하고 '/kobis/...' 형태로 요청하면
 * Vercel이 vercel.json 설정을 보고 자동으로 Python 백엔드(main.py)로 연결해줍니다.
 */
const fetchFromBackend = async <T>(endpoint: string, params: Record<string, string> = {}): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${endpoint}?${query}` : endpoint;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Backend Error [${endpoint}]:`, errorText);
      throw new Error(`Server Error (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Network Error [${endpoint}]:`, error);
    throw error;
  }
};

// 1. 일일 박스오피스
export const fetchDailyBoxOffice = async (targetDt: string): Promise<KobisResponse> => {
  return fetchFromBackend<KobisResponse>('/kobis/daily', { targetDt });
};

// 2. 주간/주말 박스오피스
export const fetchWeeklyBoxOffice = async (targetDt: string, weekGb = "1"): Promise<KobisResponse> => {
  return fetchFromBackend<KobisResponse>('/kobis/weekly', { targetDt, weekGb });
};

// 3. 영화 상세 정보
export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  try {
    const data = await fetchFromBackend<KobisMovieInfoResponse>('/kobis/detail', { movieCd });
    return data.movieInfoResult.movieInfo;
  } catch {
    return null;
  }
};

// 4. 관객수 추이 (백엔드 고속 병렬 처리)
export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    return await fetchFromBackend<TrendDataPoint[]>('/kobis/trend', { movieCd, endDate: endDateStr });
  } catch {
    return [];
  }
};

// ... (fetchFromBackend 함수 등 기존 코드 상단 유지) ...

// 5. 실시간 예매율 (디버깅용 에러 메시지 포함)
export const fetchRealtimeReservation = async (movieName: string): Promise<{ data: any, error?: string } | null> => {
  try {
    const encodedName = encodeURIComponent(movieName);
    const response = await fetch(`/api/reservation?movieName=${encodedName}`);
    
    // 네트워크 에러 처리
    if (!response.ok) {
       return { data: null, error: `Network Error: ${response.status}` };
    }

    const json = await response.json();
    
    if (json.found) {
      return { data: json.data }; // 성공
    } else {
      // 실패 시 서버가 보낸 구체적인 이유(debug_error) 반환
      return { data: null, error: json.debug_error || "Unknown Error" };
    }
  } catch (error: any) {
    return { data: null, error: `Client Error: ${error.message}` };
  }
};
