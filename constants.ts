// API Key들은 백엔드(api/index.py)에서 관리하므로 여기에는 절대 적지 마세요.

export const KOBIS_BASE_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json";
export const KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json";
export const KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json";

export const formatNumber = (num: number | string): string => {
  return Number(num).toLocaleString();
};

export const formatKoreanNumber = (num: number | string): string => {
  const n = Number(num);
  if (isNaN(n)) return String(num);
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`; 
  if (n >= 10000) return `${Math.floor(n / 10000).toLocaleString()}만`; 
  return n.toLocaleString();
};

export const getYesterdayStr = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
};

export const formatDateDisplay = (dateStr: string): string => {
  if (dateStr.length !== 8) return dateStr;
  return `${dateStr.substring(0, 4)}년 ${dateStr.substring(4, 6)}월 ${dateStr.substring(6, 8)}일`;
};
