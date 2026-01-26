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

def load_existing_data():
    """
    기존 데이터 파일에서 '상세정보(detail)'와 '과거 트렌드(trend)'를 모두 로드합니다.
    이를 통해 API 중복 호출을 방지하고 데이터를 누적합니다.
    """
    detail_cache = {}
    trend_cache = {}
    
    if os.path.exists(DAILY_FILE):
        try:
            with open(DAILY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                movies_list = data.get("movies", [])
                
                # movies가 리스트인지 딕셔너리인지 확인 (구버전 호환)
                if isinstance(movies_list, dict): 
                    movies_list = [] # 구조가 다르면 초기화
                
                for movie in movies_list:
                    movie_cd = movie.get("movieCd")
                    if not movie_cd: continue
                    
                    # 상세정보 캐싱
                    if movie.get("detail"):
                        detail_cache[movie_cd] = movie["detail"]
                    
                    # 트렌드 데이터 캐싱
                    if movie.get("trend"):
                        trend_map = {}
                        for t in movie["trend"]:
                            if "date" in t:
                                trend_map[t["date"]] = t
                        trend_cache[movie_cd] = trend_map
                        
        except Exception as e:
            print(f"[Cache] Failed to load existing file: {e}")
            
    manual = load_manual_data()
    return detail_cache, trend_cache, manual

# --- [핵심: API 호출] ---
@lru_cache(maxsize=None)
def fetch_api_list(target_dt):
    """특정 날짜의 박스오피스 목록을 가져옵니다 (중복 호출 시 캐시 사용)."""
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
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
    if movie_nm:
        clean_title = movie_nm.strip().replace(" ", "")
        for m_title, m_info in manual_data.items():
            if m_title.strip().replace(" ", "") == clean_title:
                info.update(m_info)
                break
            
    return info

def main():
    print("Starting Daily Update (Incremental Mode)...")
    
    if not KOBIS_API_KEY: 
        print("🚨 Error: KOBIS API Key is missing.")
        return

    # 1. 날짜 설정 (어제 기준)
    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    print(f"Target Date: {yesterday}")

    # 2. 기존 데이터 로드 (증분 업데이트를 위해 필수)
    detail_cache, trend_cache, manual_data = load_existing_data()
    
    # 3. 어제 자 박스오피스 목록 가져오기
    target_list = fetch_api_list(yesterday)
    
    if not target_list:
        print(f"⚠️ No box office data found for {yesterday}.")
        # 데이터가 없어도 기존 데이터 유지를 위해 빈 리스트로 진행하지 않고 종료하거나
        # 이전 데이터를 그대로 사용할 수도 있지만, 여기서는 안전하게 종료합니다.
        return

    final_movies = []

    # 4. 영화별 데이터 처리
    # API 부하를 고려해 워커 수 조절
    with ThreadPoolExecutor(max_workers=3) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            movie_nm = movie['movieNm']
            
            # 개봉일 처리
            open_dt_raw = movie.get('openDt', '').replace("-", "")
            
            print(f"Processing: {movie_nm} ({movie_cd})...")
            
            # --- 트렌드(과거 순위) 분석 ---
            date_list = []
            start_date = None
            
            # A. 수집 시작일 결정 (개봉일 vs 30일 전)
            if open_dt_raw:
                try: 
                    start_date = datetime.datetime.strptime(open_dt_raw, "%Y%m%d")
                    # 미래 개봉작이거나 데이터 오류인 경우, 최근 7일로 안전장치
                    limit_date = datetime.datetime.strptime(yesterday, "%Y%m%d")
                    if start_date > limit_date:
                         start_date = limit_date - datetime.timedelta(days=7)
                except: pass
            
            if not start_date:
                start_date = today - datetime.timedelta(days=30)
            
            # B. 개봉일 ~ 어제까지 날짜 리스트 생성
            curr = start_date
            end_date_obj = datetime.datetime.strptime(yesterday, "%Y%m%d")
            
            # 무한루프 방지 안전장치 (최대 3년치만)
            safety_count = 0
            while curr <= end_date_obj and safety_count < 1100:
                date_list.append(curr.strftime("%Y%m%d"))
                curr += datetime.timedelta(days=1)
                safety_count += 1
            
            # C. 이미 가지고 있는 데이터 확인 (Incremental Fetch)
            existing_movie_trend = trend_cache.get(movie_cd, {})
            dates_to_fetch = [d for d in date_list if d not in existing_movie_trend]
            
            if dates_to_fetch:
                print(f"   -> Fetching {len(dates_to_fetch)} missing days for {movie_nm}...")
            
            # D. 누락된 날짜만 API 호출 (병렬 처리)
            trend_futures = {executor.submit(fetch_api_list, d): d for d in dates_to_fetch}
            
            for f in trend_futures:
                d_key = trend_futures[f]
                try:
                    d_data = f.result()
                    found = next((m for m in d_data if m['movieCd'] == movie_cd), None)
                    if found:
                        # 새로 가져온 데이터 저장 (dateDisplay 포함)
                        existing_movie_trend[d_key] = {
                            "date": d_key,
                            "dateDisplay": f"{d_key[4:6]}/{d_key[6:8]}",
                            "audiCnt": int(found['audiCnt']),
                            "salesAmt": int(found['salesAmt']),
                            "scrnCnt": int(found['scrnCnt']),
                            "showCnt": int(found['showCnt'])
                        }
                    else:
                        # 해당 날짜에 박스오피스 기록이 없음 (순위 밖) -> 0으로 채우지 않고 스킵 (그래프 연결을 위해)
                        pass
                except Exception as e: 
                    print(f"Error fetching {d_key}: {e}")
            
            # E. 최종 트렌드 리스트 생성 및 정렬
            final_trend_list = list(existing_movie_trend.values())
            final_trend_list.sort(key=lambda x: x['date'])
            movie['trend'] = final_trend_list

            # 전일 대비 증감 계산 (trend 데이터 기준)
            if len(final_trend_list) >= 2:
                last = final_trend_list[-1]
                prev = final_trend_list[-2]
                movie['scrnInten'] = last['scrnCnt'] - prev['scrnCnt']
                movie['showInten'] = last['showCnt'] - prev['showCnt']
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0
            
            # --- 상세정보 병합 ---
            movie['detail'] = fetch_movie_detail(movie_cd, movie_nm, detail_cache, manual_data)
            final_movies.append(movie)

    # 5. 순위 정렬 및 저장
    final_movies.sort(key=lambda x: int(x['rank']))

    if not os.path.exists("public"): os.makedirs("public")
    final_data = {"date": yesterday, "movies": final_movies}
    
    # [저장 1] 메인 파일 (웹사이트용)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)

    # [저장 2] 아카이브 (날짜별 백업)
    year = yesterday[:4]
    month = yesterday[4:6]
    archive_path = os.path.join(ARCHIVE_DIR, year, month)
    os.makedirs(archive_path, exist_ok=True)
    
    archive_file = os.path.join(archive_path, f"{yesterday}.json")
    with open(archive_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)

    print(f"✅ Successfully saved {len(final_movies)} movies with FULL history.")

if __name__ == "__main__":
    main()
