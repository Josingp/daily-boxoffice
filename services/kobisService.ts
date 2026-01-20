import { TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

const fetchWithFallback = async <T>(
  jsonUrl: string, 
  apiUrl: string, 
  transformFn?: (json: any) => T
): Promise<T | null> => {
  try {
    const jsonRes = await fetch(`${jsonUrl}?t=${Date.now()}`);
    if (jsonRes.ok) {
      const data = await jsonRes.json();
      if (data && Object.keys(data).length > 0) {
          return transformFn ? transformFn(data) : data;
      }
    }
  } catch (e) { console.warn(`Fallback to API for ${jsonUrl}`); }

  try {
    const apiRes = await fetch(apiUrl);
    if (!apiRes.ok) throw new Error('API Error');
    return await apiRes.json();
  } catch (e) { return null; }
};

export const fetchDailyBoxOffice = async (targetDt: string): Promise<any> => {
  const data = await fetchWithFallback(
    '/daily_data.json',
    `/kobis/daily?targetDt=${targetDt}`,
    (json) => {
      if (json.movies) return { boxOfficeResult: { dailyBoxOfficeList: json.movies } };
      return json;
    }
  );
  return data || { boxOfficeResult: { dailyBoxOfficeList: [] } };
};

export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  const result = await fetchWithFallback(
    '/realtime_data.json',
    '/api/realtime',
    (json) => {
      if (json.status === 'ok') return json; // API 응답인 경우
      
      try {
        // [수정] JSON 파일 구조 변경 대응 ("meta" 키 무시)
        const meta = json.meta || {};
        const movieKeys = Object.keys(json).filter(k => k !== 'meta');
        
        const list: RealtimeMovie[] = movieKeys.map((title, idx) => {
          const history = json[title];
          if (!Array.isArray(history) || history.length === 0) return null;
          const latest = history[history.length - 1];
          
          // [수정] 퍼센트 중복 방지
          const rawRate = String(latest.rate);
          const formattedRate = rawRate.includes('%') ? rawRate : `${rawRate}%`;

          return {
            movieCd: String(idx), // 임시 ID
            rank: String(latest.rank),
            title: title,
            rate: formattedRate,
            // 0원 0명 문제 해결: JSON에 있는 문자열 그대로 사용
            salesAmt: String(latest.salesAmt || "0"), 
            salesAcc: String(latest.salesAcc || "0"), 
            audiCnt: String(latest.audiCnt || "0"), 
            audiAcc: String(latest.audiAcc || "0"),
            // [New] 저장된 상세정보가 있으면 같이 넘김 (DetailView에서 사용)
            detail: meta[title] || null 
          };
        }).filter(Boolean) as RealtimeMovie[];

        list.sort((a, b) => Number(a.rank) - Number(b.rank));
        
        // 기준 시간 추출
        const time = list.length > 0 ? json[list[0].title].slice(-1)[0].time : "";
        return { status: "ok", data: list, crawledTime: time };
      } catch { return null; }
    }
  );
  return (result && result.status === 'ok') ? result : { data: [], crawledTime: "" };
};

export const fetchMovieNews = async (keyword: string): Promise<NewsItem[]> => {
  try {
    const res = await fetch(`/api/news?keyword=${encodeURIComponent(keyword)}`);
    return res.ok ? (await res.json()).items : [];
  } catch { return []; }
};

export const fetchMoviePoster = async (movieName: string): Promise<string> => {
  try {
    const res = await fetch(`/api/poster?movieName=${encodeURIComponent(movieName)}`);
    return res.ok ? (await res.json()).url : "";
  } catch { return ""; }
};

export const fetchMovieDetail = async (movieCd: string): Promise<MovieInfo | null> => {
  try {
    const res = await fetch(`/kobis/detail?movieCd=${movieCd}`);
    return (await res.json()).movieInfoResult.movieInfo;
  } catch { return null; }
};

export const fetchRealtimeReservation = async (movieName: string, movieCd?: string) => {
  try {
    const q = movieCd ? `?movieName=${encodeURIComponent(movieName)}&movieCd=${movieCd}` : `?movieName=${encodeURIComponent(movieName)}`;
    const res = await fetch(`/api/reservation${q}`);
    const json = await res.json();
    return json.found ? { data: { ...json.data, crawledTime: json.crawledTime } } : { data: null };
  } catch { return { data: null }; }
};
