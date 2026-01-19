import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo } from '../types';

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

// [수정됨] 시간 정보(crawledTime) 병합 및 movieCd 지원
export const fetchRealtimeReservation = async (movieName: string, movieCd?: string): Promise<{ data: any, error?: string } | null> => {
  try {
    const encodedName = encodeURIComponent(movieName);
    // movieCd가 있으면 URL에 포함
    const query = movieCd 
      ? `?movieName=${encodedName}&movieCd=${movieCd}`
      : `?movieName=${encodedName}`;

    const response = await fetch(`/api/reservation${query}`);
    
    if (!response.ok) {
       return { data: null, error: `Network Error: ${response.status}` };
    }

    const json = await response.json();
    
    if (json.found) {
      // 백엔드에서 받은 crawledTime을 데이터 객체에 병합하여 반환
      return { 
        data: {
          ...json.data,
          crawledTime: json.crawledTime 
        } 
      }; 
    } else {
      return { data: null, error: json.debug_error || "Unknown Error" };
    }
  } catch (error: any) {
    return { data: null, error: `Client Error: ${error.message}` };
  }
};
