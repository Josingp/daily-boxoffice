import os
import json
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

# --- [설정] ---
DAILY_FILE = "public/daily_data.json"
ARCHIVE_DIR = "public/archive"
MANUAL_FILE = "manual_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

# [핵심] 과거 데이터를 얼마나 뒤져볼 것인가? (7일이면 충분)
MAX_LOOKBACK_DAYS = 7 

def load_manual_data():
    if os.path.exists(MANUAL_FILE):
        try:
            with open(MANUAL_FILE, 'r', encoding='utf-8') as f: return json.load(f)
        except: pass
    return {}

def load_existing_data():
    detail_cache = {}
    trend_cache = {}
    if os.path.exists(DAILY_FILE):
        try:
            with open(DAILY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for movie in data.get("movies", []):
                    movie_cd = movie.get("movieCd")
                    if not movie_cd: continue
                    if movie.get("detail"): detail_cache[movie_cd] = movie["detail"]
                    if movie.get("trend"):
                        trend_map = {}
                        for t in movie["trend"]:
                            if "date" in t: trend_map[t["date"]] = t
                        trend_cache[movie_cd] = trend_map
        except: pass
    return detail_cache, trend_cache, load_manual_data()

@lru_cache(maxsize=None)
def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}&itemPerPage=10", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

def fetch_movie_detail(movie_cd, movie_nm, cache, manual_data):
    if movie_cd in cache: return cache[movie_cd]
    # API 호출 로직 (생략 없이 유지)
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movie_cd}", timeout=3)
        data = res.json().get("movieInfoResult", {}).get("movieInfo", {})
        if data:
            if movie_nm:
                clean = movie_nm.strip().replace(" ", "")
                for m_t, m_i in manual_data.items():
                    if m_t.replace(" ","") == clean:
                        data.update(m_i); break
            return data
    except: pass
    return {}

def main():
    if not KOBIS_API_KEY: return

    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    print(f"Target: {yesterday}")

    detail_cache, trend_cache, manual_data = load_existing_data()
    target_list = fetch_api_list(yesterday)
    
    if not target_list: return

    final_movies = []

    with ThreadPoolExecutor(max_workers=5) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            # --- 트렌드 최적화 ---
            existing_trend = trend_cache.get(movie_cd, {})
            
            # [최적화] "개봉일"부터가 아니라, "최근 7일" 혹은 "누락된 부분"만 스캔
            date_list = []
            
            # 최근 MAX_LOOKBACK_DAYS 만큼만 검사
            for i in range(MAX_LOOKBACK_DAYS):
                d = (today - datetime.timedelta(days=i+1)).strftime("%Y%m%d")
                date_list.append(d)
            
            # 누락된 날짜만 필터링
            dates_to_fetch = [d for d in date_list if d not in existing_trend]
            
            if dates_to_fetch:
                print(f"  Backfilling {len(dates_to_fetch)} days for {movie['movieNm']}...")
                futures = {executor.submit(fetch_api_list, d): d for d in dates_to_fetch}
                for f in futures:
                    d_key = futures[f]
                    try:
                        d_data = f.result()
                        found = next((m for m in d_data if m['movieCd'] == movie_cd), None)
                        if found:
                            existing_trend[d_key] = {
                                "date": d_key, "dateDisplay": f"{d_key[4:6]}/{d_key[6:8]}",
                                "audiCnt": int(found['audiCnt']), "salesAmt": int(found['salesAmt']),
                                "scrnCnt": int(found['scrnCnt']), "showCnt": int(found['showCnt'])
                            }
                    except: pass
            
            # 리스트 변환 및 정렬
            final_trend_list = sorted(existing_trend.values(), key=lambda x: x['date'])
            movie['trend'] = final_trend_list
            
            # 증감 계산
            if len(final_trend_list) >= 2:
                movie['scrnInten'] = final_trend_list[-1]['scrnCnt'] - final_trend_list[-2]['scrnCnt']
                movie['showInten'] = final_trend_list[-1]['showCnt'] - final_trend_list[-2]['showCnt']
            else:
                movie['scrnInten'] = 0; movie['showInten'] = 0

            movie['detail'] = fetch_movie_detail(movie_cd, movie['movieNm'], detail_cache, manual_data)
            final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))
    
    if not os.path.exists("public"): os.makedirs("public")
    data = {"date": yesterday, "movies": final_movies}
    
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 아카이브 저장
    d_path = os.path.join(ARCHIVE_DIR, yesterday[:4], yesterday[4:6])
    os.makedirs(d_path, exist_ok=True)
    with open(os.path.join(d_path, f"{yesterday}.json"), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("✅ Done.")

if __name__ == "__main__":
    main()
