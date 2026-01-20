import { TrendDataPoint, MovieInfo, RealtimeMovie, NewsItem } from '../types';

// JSON 파일 우선 로드, 실패 시 API 호출
const fetchWithFallback = async <T>(
  jsonUrl: string, 
  apiUrl: string, 
  transformFn?: (json: any) => T
): Promise<T | null> => {
  try {
    const jsonRes = await fetch(`${jsonUrl}?t=${Date.now()}`); // 캐시 방지
    if (jsonRes.ok) {
      const data = await jsonRes.json();
      if (data && Object.keys(data).length > 0) {
          return transformFn ? transformFn(data) : data;
      }
    }
  } catch (e) {
    console.warn(`Fallback to API for ${jsonUrl}`);
  }

  try {
    const apiRes = await fetch(apiUrl);
    if (!apiRes.ok) throw new Error('API Error');
    return await apiRes.json();
  } catch (e) { return null; }
};

export const fetchDailyBoxOffice = async (targetDt: string): Promise<any> => {
  return await fetchWithFallback(
    '/daily_data.json',
    `/kobis/daily?targetDt=${targetDt}`,
    (json) => {
      // JSON 파일 구조가 { date:..., movies: [...] } 형태임
      if (json.movies) return { boxOfficeResult: { dailyBoxOfficeList: json.movies } };
      return json;
    }
  ) || { boxOfficeResult: { dailyBoxOfficeList: [] } };
};

export const fetchRealtimeRanking = async (): Promise<{ data: RealtimeMovie[], crawledTime: string }> => {
  const result = await fetchWithFallback(
    '/realtime_data.json',
    '/api/realtime',
    (json) => {
      if (json.status === 'ok') return json;

      try {
        // [수정] 메타데이터(상세정보) 분리
        const meta = json.meta || {};
        const movieKeys = Object.keys(json).filter(k => k !== 'meta');
        
        const list: RealtimeMovie[] = movieKeys.map((title, idx) => {
          const history = json[title];
          if (!Array.isArray(history) || history.length === 0) return null;
          const latest = history[history.length - 1];
          
          // [수정] 퍼센트 중복 처리 로직
          const rawRate = String(latest.rate);
          const formattedRate = rawRate.includes('%') ? rawRate : `${rawRate}%`;

          // [수정] 콤마 제거 후 문자열 저장 (NaN 방지)
          // DB에 "37,355"로 저장되어 있어도 여기서 깔끔하게 처리
          return {
            movieCd: String(idx), // 임시 ID
            rank: String(latest.rank),
            title: title,
            rate: formattedRate,
            salesAmt: String(latest.salesAmt || "0").replace(/,/g, ''),
            salesAcc: String(latest.salesAcc || "0").replace(/,/g, ''),
            audiCnt: String(latest.audiCnt || "0").replace(/,/g, ''),
            audiAcc: String(latest.audiAcc || "0").replace(/,/g, ''),
            // [중요] 상세정보 주입
            detail: meta[title] || null
          };
        }).filter(Boolean) as RealtimeMovie[];

        // 순위 정렬
        list.sort((a, b) => Number(a.rank) - Number(b.rank));
        
        // 기준 시간 (1위 영화의 최신 시간 사용)
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

export const fetchMovieTrend = async (movieCd: string, endDateStr: string): Promise<TrendDataPoint[]> => {
  try {
    const res = await fetch(`/kobis/trend?movieCd=${movieCd}&endDate=${endDateStr}`);
    return res.ok ? await res.json() : [];
  } catch { return []; }
};

export const fetchRealtimeReservation = async (movieName: string, movieCd?: string) => {
  // 상세 화면 등에서 호출됨
  try {
    const q = movieCd ? `?movieName=${encodeURIComponent(movieName)}&movieCd=${movieCd}` : `?movieName=${encodeURIComponent(movieName)}`;
    const res = await fetch(`/api/reservation${q}`);
    const json = await res.json();
    return json.found ? { data: { ...json.data, crawledTime: json.crawledTime } } : { data: null };
  } catch { return { data: null }; }
};
