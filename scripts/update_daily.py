import os
import json
import requests
import datetime
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

# 파일 경로 설정
DAILY_FILE = "public/daily_data.json"
MANUAL_FILE = "manual_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

# [보조 함수] 수동 데이터 로드
def load_manual_data():
    if os.path.exists(MANUAL_FILE):
        try:
            with open(MANUAL_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: pass
    return {}

# [핵심 1] 기존 상세정보 캐싱 (API 절약)
def load_existing_details():
    cache = {}
    if os.path.exists(DAILY_FILE):
        try:
            with open(DAILY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for movie in data.get("movies", []):
                    if movie.get("detail") and movie.get("movieCd"):
                        cache[movie["movieCd"]] = movie["detail"]
    # 수동 데이터도 캐시처럼 활용하기 위해 로드
    manual = load_manual_data()
    return cache, manual

# [핵심 2] 날짜별 박스오피스 API 캐싱 (중복 호출 방지)
@lru_cache(maxsize=None)
def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}&itemPerPage=10", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

# [핵심 3] 상세정보 가져오기 (캐시 -> API -> 수동데이터 보정)
def fetch_movie_detail(movie_cd, movie_nm, cache, manual_data):
    info = {}
    
    # 1. 기존 캐시 확인
    if movie_cd in cache and cache[movie_cd]:
        info = cache[movie_cd]
    else:
        # 2. API 호출
        url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
        for attempt in range(3):
            try:
                res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movie_cd}", timeout=5)
                data = res.json().get("movieInfoResult", {}).get("movieInfo", {})
                if data and "movieNm" in data:
                    info = data
                    break
                raise Exception("Empty data")
            except:
                time.sleep((attempt + 1) * 2)

    # 3. 수동 데이터(포스터, 제작비) 병합
    # API 데이터에는 포스터/제작비가 없으므로 수동 데이터에서 가져와 덮어씌움
    clean_title = movie_nm.strip().replace(" ", "")
    for m_title, m_info in manual_data.items():
        if m_title.strip().replace(" ", "") == clean_title:
            if "posterUrl" in m_info: info["posterUrl"] = m_info["posterUrl"]
            if "productionCost" in m_info: info["productionCost"] = m_info["productionCost"]
            break
            
    return info

def main():
    if not KOBIS_API_KEY: 
        print("API Key is missing.")
        return

    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    print(f"Target Date: {yesterday}")

    # 데이터 로드
    detail_cache, manual_data = load_existing_details()
    target_list = fetch_api_list(yesterday)
    
    if not target_list:
        print("No box office data found.")
        return

    final_movies = []

    with ThreadPoolExecutor(max_workers=3) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            movie_nm = movie['movieNm']
            open_dt = movie['openDt'].replace("-", "") if movie['openDt'] else ""
            
            print(f"Processing: {movie_nm}...")
            
            # --- 트렌드 분석 ---
            date_list = []
            if open_dt and open_dt <= yesterday:
                try: curr = datetime.datetime.strptime(open_dt, "%Y%m%d")
                except: curr = datetime.datetime.strptime((today - datetime.timedelta(days=30)).strftime("%Y%m%d"), "%Y%m%d")
            else:
                curr = datetime.datetime.strptime((today - datetime.timedelta(days=30)).strftime("%Y%m%d"), "%Y%m%d")
            
            end_date = datetime.datetime.strptime(yesterday, "%Y%m%d")
            while curr <= end_date:
                date_list.append(curr.strftime("%Y%m%d"))
                curr += datetime.timedelta(days=1)
            
            if len(date_list) > 90: date_list = date_list[-90:]
            
            trend_data = []
            trend_futures = {executor.submit(fetch_api_list, d): d for d in date_list}
            
            for f in trend_futures:
                d_key = trend_futures[f]
                try:
                    d_data = f.result()
                    found = next((m for m in d_data if m['movieCd'] == movie_cd), None)
                    if found:
                        trend_data.append({
                            "date": d_key,
                            "dateDisplay": f"{d_key[4:6]}/{d_key[6:8]}",
                            "audiCnt": int(found['audiCnt']),
                            "salesAmt": int(found['salesAmt']),
                            "scrnCnt": int(found['scrnCnt']),
                            "showCnt": int(found['showCnt'])
                        })
                except: pass
            
            trend_data.sort(key=lambda x: x['date'])
            movie['trend'] = trend_data

            if len(trend_data) >= 2:
                movie['scrnInten'] = trend_data[-1]['scrnCnt'] - trend_data[-2]['scrnCnt']
                movie['showInten'] = trend_data[-1]['showCnt'] - trend_data[-2]['showCnt']
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0
            
            # --- 상세정보 병합 (수동 데이터 포함) ---
            detail = fetch_movie_detail(movie_cd, movie_nm, detail_cache, manual_data)
            movie['detail'] = detail

            final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))

    if not os.path.exists("public"): os.makedirs("public")
    
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {len(final_movies)} movies.")

if __name__ == "__main__":
    main()
