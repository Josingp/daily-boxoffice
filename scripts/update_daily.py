import os
import json
import requests
import datetime
import time
from concurrent.futures import ThreadPoolExecutor

DAILY_FILE = "public/daily_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

def fetch_movie_detail(movie_cd):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    # [수정] 실패 시 최대 3번 재시도하는 로직 추가
    for attempt in range(3):
        try:
            res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movie_cd}", timeout=5)
            data = res.json()
            info = data.get("movieInfoResult", {}).get("movieInfo", {})
            if info: 
                return info
        except Exception as e:
            print(f"  [Detail Fail] {movie_cd} (Attempt {attempt+1}/3): {e}")
            time.sleep(1) # 1초 대기 후 재시도
    
    print(f"  [Error] Failed to fetch details for {movie_cd} after 3 attempts.")
    return {}

def main():
    if not KOBIS_API_KEY: 
        print("API Key is missing.")
        return

    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    
    print(f"Target Date: {yesterday}")

    # 1. 어제 기준 박스오피스 리스트 가져오기
    target_list = fetch_api_list(yesterday)
    final_movies = []

    if not target_list:
        print("No box office data found.")
        return

    # 2. 각 영화별 과거 데이터 풀 스캔 (스레드 수 5 -> 3으로 낮춰 안정성 확보)
    with ThreadPoolExecutor(max_workers=3) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            movie_nm = movie['movieNm']
            open_dt = movie['openDt'].replace("-", "")
            
            print(f"Processing: {movie_nm} ({movie_cd})...")
            
            # 개봉일 ~ 어제까지 날짜 리스트 생성
            date_list = []
            if open_dt and open_dt <= yesterday:
                try:
                    curr = datetime.datetime.strptime(open_dt, "%Y%m%d")
                except:
                    # 개봉일 형식이 이상할 경우 30일 전부터 조회
                    curr = datetime.datetime.strptime((today - datetime.timedelta(days=30)).strftime("%Y%m%d"), "%Y%m%d")
            else:
                curr = datetime.datetime.strptime((today - datetime.timedelta(days=30)).strftime("%Y%m%d"), "%Y%m%d")
            
            end_date = datetime.datetime.strptime(yesterday, "%Y%m%d")
            
            while curr <= end_date:
                date_list.append(curr.strftime("%Y%m%d"))
                curr += datetime.timedelta(days=1)
            
            # API 보호를 위해 최근 90일로 제한
            if len(date_list) > 90: date_list = date_list[-90:]
            
            # 병렬 API 호출 (트렌드 데이터)
            trend_data = []
            futures = {executor.submit(fetch_api_list, d): d for d in date_list}
            
            for f in futures:
                d_key = futures[f]
                try:
                    d_data = f.result()
                    # 해당 날짜 리스트에서 내 영화 찾기
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

            # 전일 대비 증감 계산
            if len(trend_data) >= 2:
                last = trend_data[-1]
                prev = trend_data[-2]
                movie['scrnInten'] = last['scrnCnt'] - prev['scrnCnt']
                movie['showInten'] = last['showCnt'] - prev['showCnt']
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0
            
            # [중요] 상세정보 병합 (재시도 로직 적용)
            detail = fetch_movie_detail(movie_cd)
            movie['detail'] = detail

            final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))

    if not os.path.exists("public"):
        os.makedirs("public")

    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Successfully saved {len(final_movies)} movies to {DAILY_FILE}.")

if __name__ == "__main__":
    main()
