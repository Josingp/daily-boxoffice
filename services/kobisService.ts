import { KOBIS_API_KEY, KOBIS_BASE_URL, KOBIS_WEEKLY_URL, KOBIS_MOVIE_INFO_URL } from '../constants';
import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo, ReservationData } from '../types';

export const fetchDailyBoxOffice = async (targetDt: string): Promise<KobisResponse> => {
  const url = `${KOBIS_BASE_URL}?key=${KOBIS_API_KEY}&targetDt=${targetDt}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const data: KobisResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch daily box office data", error);
    throw error;
  }
};

export const fetchWeeklyBoxOffice = async (targetDt: string, weekGb = "1"): Promise<KobisResponse> => {
  // weekGb: "0" (Mon-Sun), "1" (Fri-Sun), "2" (Mon-Thu)
  const url = `${KOBIS_WEEKLY_URL}?key=${KOBIS_API_KEY}&targetDt=${targetDt}&weekGb=${weekGb}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const data: KobisResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch weekly box office data", error);
    throw error;
  }
};

export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  const url = `${KOBIS_MOVIE_INFO_URL}?key=${KOBIS_API_KEY}&movieCd=${movieCd}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const data: KobisMovieInfoResponse = await response.json();
    return data.movieInfoResult.movieInfo;
  } catch (error) {
    console.error("Failed to fetch movie detail", error);
    return null;
  }
};

/**
 * Fetches box office data for the last 7 days including the target date.
 * Now includes screen counts for AI analysis.
 */
export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  const dates: string[] = [];
  
  const end = new Date(
    parseInt(endDateStr.substring(0, 4)),
    parseInt(endDateStr.substring(4, 6)) - 1,
    parseInt(endDateStr.substring(6, 8))
  );

  // Use Proxy to fetch trend data properly from backend if needed, 
  // but for now keeping direct logic or switching to backend logic if you migrated trend fetching too.
  // Assuming frontend fetching for KOBIS API is still okay via KOBIS_BASE_URL (json).
  // If you want backend trend fetching:
  try {
      const response = await fetch(`/kobis/trend?movieCd=${movieCd}&endDate=${endDateStr}`);
      if(response.ok) return await response.json();
  } catch (e) {
      // Fallback to existing logic if backend trend fails or not implemented
  }

  for (let i = 6; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }

  const promises = dates.map(dt => fetchDailyBoxOffice(dt));
  
  try {
    const results = await Promise.all(promises);
    
    return results.map((res, index) => {
      const dateStr = dates[index];
      const list = res.boxOfficeResult?.dailyBoxOfficeList || [];
      const movie = list.find(m => m.movieCd === movieCd);
      
      return {
        date: dateStr,
        dateDisplay: `${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}`,
        audiCnt: movie ? parseInt(movie.audiCnt) : 0,
        scrnCnt: movie ? parseInt(movie.scrnCnt) : 0 // Added screen count
      };
    });
  } catch (error) {
    console.error("Failed to fetch trend data", error);
    return [];
  }
};

// [추가] 실시간 예매율 (Backend API 호출)
export const fetchRealtimeReservation = async (movieName: string): Promise<ReservationData | null> => {
  try {
    // Vite Proxy 설정에 따라 /api 요청은 백엔드(8000)로 전달됨
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
