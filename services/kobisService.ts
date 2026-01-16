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

// 5. 실시간 예매율 (백엔드 크롤링)
export const fetchRealtimeReservation = async (movieName: string): Promise<ReservationData | null> => {
  try {
    // 특수문자 및 공백 처리를 위해 인코딩
    const encodedName = encodeURIComponent(movieName);
    const response = await fetch(`/api/reservation?movieName=${encodedName}`);
    
    if (!response.ok) return null;

    const json = await response.json();
    
    if (json.found) {
      return json.data; 
    } else {
      return null;
    }
  } catch (error) {
    console.error("Reservation Fetch Error:", error);
    return null;
  }
};
