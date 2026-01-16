import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, ReservationData } from '../types';

/**
 * [핵심] 백엔드 API 호출 헬퍼
 * 프론트엔드는 KOBIS 주소를 알 필요가 없습니다.
 * 오직 우리 서버(FastAPI)의 엔드포인트(/kobis/...)만 호출하면 됩니다.
 * * vite.config.ts의 proxy 설정에 의해:
 * /kobis -> http://localhost:8000/kobis (로컬)
 * /kobis -> https://your-vercel-url/kobis (배포 시)
 */
const fetchFromBackend = async <T>(endpoint: string, params: Record<string, string> = {}): Promise<T> => {
  // 쿼리 스트링 생성 (예: ?targetDt=20240101)
  const query = new URLSearchParams(params).toString();
  const url = query ? `${endpoint}?${query}` : endpoint;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      // 에러 발생 시 상세 내용 확인
      const errorText = await response.text();
      console.error(`Backend Error [${endpoint}]:`, errorText);
      throw new Error(`API Error (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Fetch Failed [${endpoint}]:`, error);
    throw error;
  }
};

// 1. 일일 박스오피스 (백엔드 호출)
export const fetchDailyBoxOffice = async (targetDt: string): Promise<KobisResponse> => {
  // 백엔드: /kobis/daily?targetDt=...
  // KOBIS 키는 백엔드에서 알아서 처리하므로 여기선 안 보냄
  return fetchFromBackend<KobisResponse>('/kobis/daily', { targetDt });
};

// 2. 주간 박스오피스 (백엔드 호출)
export const fetchWeeklyBoxOffice = async (targetDt: string, weekGb = "1"): Promise<KobisResponse> => {
  return fetchFromBackend<KobisResponse>('/kobis/weekly', { targetDt, weekGb });
};

// 3. 영화 상세 정보 (백엔드 호출)
export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  try {
    const data = await fetchFromBackend<KobisMovieInfoResponse>('/kobis/detail', { movieCd });
    return data.movieInfoResult.movieInfo;
  } catch {
    return null;
  }
};

// 4. 관객수 추이 데이터 (백엔드 호출 - 병렬 처리된 고속 API 사용)
export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    return await fetchFromBackend<TrendDataPoint[]>('/kobis/trend', { movieCd, endDate: endDateStr });
  } catch {
    return [];
  }
};

// 5. 실시간 예매율 (백엔드 크롤러 호출)
export const fetchRealtimeReservation = async (movieName: string): Promise<ReservationData | null> => {
  try {
    // 백엔드: /api/reservation?movieName=...
    const response = await fetch(`/api/reservation?movieName=${encodeURIComponent(movieName)}`);
    
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
