import { KOBIS_API_KEY, KOBIS_BASE_URL, KOBIS_WEEKLY_URL, KOBIS_MOVIE_INFO_URL } from '../constants';
import { KobisResponse, TrendDataPoint, KobisMovieInfoResponse, MovieInfo } from '../types';

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