// KOBIS API Key provided by the user
export const KOBIS_API_KEY = "7b6e13eaf7ec8194db097e7ea0bba626";

// Direct URL for KOBIS API.
// NOTE: KOBIS API might trigger CORS errors in browsers.
// If you see CORS errors, you need a proxy server or a browser extension.
export const KOBIS_BASE_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json";
export const KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json";
export const KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json";

// Helper to format numbers with commas
export const formatNumber = (num: number | string): string => {
  return Number(num).toLocaleString();
};

// Helper for Korean style huge numbers (e.g. 250만, 1.2억)
export const formatKoreanNumber = (num: number | string): string => {
  const n = Number(num);
  if (isNaN(n)) return String(num);

  if (n >= 100000000) {
    // 1억 이상
    return `${(n / 100000000).toFixed(1)}억`; 
  }
  if (n >= 10000) {
    // 1만 이상 (소수점 없이 정수로 깔끔하게)
    return `${Math.floor(n / 10000).toLocaleString()}만`; 
  }
  return n.toLocaleString();
};

// Helper to get today's date in YYYYMMDD format for initial load (usually yesterday for Box Office)
export const getYesterdayStr = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
};

export const formatDateDisplay = (dateStr: string): string => {
  if (dateStr.length !== 8) return dateStr;
  const y = dateStr.substring(0, 4);
  const m = dateStr.substring(4, 6);
  const d = dateStr.substring(6, 8);
  return `${y}년 ${m}월 ${d}일`;
};