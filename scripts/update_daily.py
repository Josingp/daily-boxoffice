import os
import json
import requests
import datetime
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache  # [추가] 중복 호출 방지 도구

DAILY_FILE = "public/daily_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

# [핵심 1] 기존 파일에서 상세정보만 쏙 빼서 메모리에 저장 (API 절약 & 데이터 보존)
def load_existing_details():
    cache = {}
    if os.path.exists(DAILY_FILE):
        try:
            with open(DAILY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for movie in data.get("movies", []):
                    # detail 정보가 비어있지 않은 경우에만 저장
                    if movie.get("detail") and movie.get("movieCd"):
                        cache[movie["movieCd"]] = movie["detail"]
            print(f"[Cache] Loaded details for {len(cache)} movies from existing file.")
        except Exception as e:
            print(f"[Cache] Failed to load existing file: {e}")
    return cache

# [핵심 2] 캐시 적용: 같은 날짜 데이터는 한 번만 요청 (API 호출 획기적 감소)
# maxsize=None: 용량 제한 없이 기억 (하루치 데이터라 메모리 문제 없음)
@lru_cache(maxsize=None) 
def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        # print(f"API Call for {target_dt}") # 디버깅용: 실제 호출될 때만 찍힘
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}&itemPerPage=10", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

# [핵심 3] 상세정보 가져오기 (캐시 확인 -> 없으면 3회 재시도)
def fetch_movie_detail(movie_cd, cache):
    # 1. 캐시에 있으면 그거 씀 (API 호출 X -> 중복 방지 & 속도 UP)
    if movie_cd in cache and cache[movie_cd]:
        return cache[movie_cd]

    # 2. 없으면 API 호출 (최대 3회 재시도)
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    
    for attempt in range(3):
        try:
            res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movie_cd}", timeout=5)
            data = res.json()
            info = data.get("movieInfoResult", {}).get("movieInfo", {})
            
            # 정보가 제대로 왔는지 확인 (영화명이 있어야 성공)
            if info and "movieNm" in info:
                return info
            
            # 정보가 비어있으면 에러로 간주하고 재시도
            raise Exception("Empty data received")

        except Exception as e:
            wait_time = (attempt + 1) * 2 # 2초, 4초, 6초 대기 (점점 길게)
            print(f"  [Retry] {movie_cd} failed (Attempt {attempt+1}/3): {e}. Waiting {wait_time}s...")
            time.sleep(wait_time)
    
    print(f"  [Fail] Could not fetch detail for {movie_cd} after 3 attempts.")
    return {} # 끝내 실패하면 빈 객체 반환

def main():
    if not KOBIS_API_KEY: 
        print("API Key is missing.")
        return

    # 1. 날짜 설정 (어제 기준)
    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    print(f"Target Date: {yesterday}")

    # 2. 기존 데이터 로드 (중복 방지용 캐시 구축)
    detail_cache = load_existing_details()

    # 3. 박스오피스 목록 가져오기 (어제자 Top 10)
    target_list = fetch_api_list(yesterday)
    if not target_list:
        print("No box office data found from API.")
        return

    final_movies = []

    # 4. 병렬 처리 시작 (안정성을 위해 워커 수 3으로 제한)
    with ThreadPoolExecutor(max_workers=3) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            movie_nm = movie['movieNm']
            open_dt = movie['openDt'].replace("-", "") if movie['openDt'] else ""
            
            print(f"Processing: {movie_nm} ({movie_cd})...")
            
            # --- 트렌드 데이터 수집 ---
            date_list = []
            
            # 개봉일이 유효하면 개봉일부터, 아니면 30일 전부터 조회
            if open_dt and open_dt <= yesterday:
                try:
                    curr = datetime.datetime.strptime(open_dt, "%Y%m%d")
                except:
                    curr = datetime.datetime.strptime((today - datetime.timedelta(days=30)).strftime("%Y%m%d"), "%Y%m%d")
            else:
                curr = datetime.datetime.strptime((today - datetime.timedelta(days=30)).strftime("%Y%m%d"), "%Y%m%d")
            
            end_date = datetime.datetime.strptime(yesterday, "%Y%m%d")
            while curr <= end_date:
                date_list.append(curr.strftime("%Y%m%d"))
                curr += datetime.timedelta(days=1)
            
            # API 과부하 방지: 최근 90일까지만 조회 (필요시 이 숫자 조절)
            if len(date_list) > 90: date_list = date_list[-90:]
            
            trend_data = []
            # 여기서 fetch_api_list를 호출할 때 @lru_cache 덕분에 중복 호출은 자동으로 무시됨
            trend_futures = {executor.submit(fetch_api_list, d): d for d in date_list}
            
            for f in trend_futures:
                d_key = trend_futures[f]
                try:
                    # 해당 날짜의 전체 박스오피스 리스트를 가져옴 (캐시된 데이터일 확률 높음)
                    d_data = f.result()
                    # 그 리스트에서 현재 처리 중인 영화(movie_cd)만 찾아서 저장
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

            # 전일 대비 스크린/상영 횟수 증감 계산
            if len(trend_data) >= 2:
                last = trend_data[-1]
                prev = trend_data[-2]
                movie['scrnInten'] = last['scrnCnt'] - prev['scrnCnt']
                movie['showInten'] = last['showCnt'] - prev['showCnt']
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0
            
            # --- 상세정보 병합 ---
            detail = fetch_movie_detail(movie_cd, detail_cache)
            movie['detail'] = detail

            final_movies.append(movie)

    # 5. 저장
    final_movies.sort(key=lambda x: int(x['rank']))

    if not os.path.exists("public"):
        os.makedirs("public")

    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Successfully saved {len(final_movies)} movies to {DAILY_FILE}.")

if __name__ == "__main__":
    main()
