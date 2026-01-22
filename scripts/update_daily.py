import os
import json
import requests
import datetime
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

# --- [설정] ---
DAILY_FILE = "public/daily_data.json"
ARCHIVE_DIR = "public/archive"
MANUAL_FILE = "manual_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

# --- [유틸: 데이터 로드] ---
def load_manual_data():
    """수동 데이터(포스터/제작비 등)를 로드합니다."""
    if os.path.exists(MANUAL_FILE):
        try:
            with open(MANUAL_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: pass
    return {}

def load_existing_details():
    """기존 데이터에서 상세정보(detail)만 캐싱하여 API 호출을 줄입니다."""
    cache = {}
    if os.path.exists(DAILY_FILE):
        try:
            with open(DAILY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for movie in data.get("movies", []):
                    if movie.get("detail") and movie.get("movieCd"):
                        cache[movie["movieCd"]] = movie["detail"]
        except Exception as e:
            print(f"[Cache] Failed to load existing file: {e}")
            
    manual = load_manual_data()
    return cache, manual

# --- [핵심: API 호출 최적화] ---
@lru_cache(maxsize=None)
def fetch_api_list(target_dt):
    """특정 날짜의 박스오피스 목록을 가져옵니다 (중복 호출 시 캐시 사용)."""
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        # print(f"API Call for {target_dt}") # 디버깅 필요 시 주석 해제
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}&itemPerPage=10", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

def fetch_movie_detail(movie_cd, movie_nm, cache, manual_data):
    """영화 상세정보를 가져옵니다 (캐시 -> API -> 수동데이터 병합)."""
    info = {}
    
    # 1. 캐시(기존 파일) 확인
    if movie_cd in cache and cache[movie_cd]:
        info = cache[movie_cd]
    else:
        # 2. API 호출 (없으면 3회 재시도)
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
    clean_title = movie_nm.strip().replace(" ", "")
    for m_title, m_info in manual_data.items():
        if m_title.strip().replace(" ", "") == clean_title:
            info.update(m_info)
            break
            
    return info

def main():
    print("Starting Daily Update...")
    
    if not KOBIS_API_KEY: 
        print("🚨 Error: KOBIS API Key is missing.")
        return

    # 1. 날짜 설정 (어제 기준)
    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    print(f"Target Date: {yesterday}")

    # 2. 데이터 준비
    detail_cache, manual_data = load_existing_details()
    target_list = fetch_api_list(yesterday)
    
    if not target_list:
        print(f"⚠️ No box office data found for {yesterday}.")
        return

    final_movies = []

    # 3. 병렬 처리로 데이터 수집
    with ThreadPoolExecutor(max_workers=3) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            movie_nm = movie['movieNm']
            open_dt = movie['openDt'].replace("-", "") if movie['openDt'] else ""
            
            print(f"Processing: {movie_nm} ({movie_cd})...")
            
            # --- 트렌드(과거 순위) 분석 ---
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
            
            # API 과부하 방지: 최대 90일치만 조회
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
                            "audiCnt": int(found['audiCnt']),
                            "salesAmt": int(found['salesAmt']),
                            "scrnCnt": int(found['scrnCnt']),
                            "showCnt": int(found['showCnt'])
                        })
                except: pass
            
            trend_data.sort(key=lambda x: x['date'])
            movie['trend'] = trend_data

            # 전일 대비 증감 계산
            if len(trend_data) >= 2:
                movie['scrnInten'] = trend_data[-1]['scrnCnt'] - trend_data[-2]['scrnCnt']
                movie['showInten'] = trend_data[-1]['showCnt'] - trend_data[-2]['showCnt']
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0
            
            # --- 상세정보 병합 ---
            movie['detail'] = fetch_movie_detail(movie_cd, movie_nm, detail_cache, manual_data)
            final_movies.append(movie)

    # 4. 순위 정렬 및 저장
    final_movies.sort(key=lambda x: int(x['rank']))

    if not os.path.exists("public"): os.makedirs("public")
    final_data = {"date": yesterday, "movies": final_movies}
    
    # [저장 1] 메인 파일 (웹사이트용)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)

    # [저장 2] 아카이브 (데이터 보존용: public/archive/2026/01/20260123.json)
    year = yesterday[:4]
    month = yesterday[4:6]
    archive_path = os.path.join(ARCHIVE_DIR, year, month)
    os.makedirs(archive_path, exist_ok=True)
    
    archive_file = os.path.join(archive_path, f"{yesterday}.json")
    with open(archive_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)

    print(f"✅ Successfully saved {len(final_movies)} movies.")
    print(f"📂 Archived at: {archive_file}")

if __name__ == "__main__":
    main()
