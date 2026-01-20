import os
import json
import requests
import datetime
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
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movie_cd}", timeout=5)
        return res.json().get("movieInfoResult", {}).get("movieInfo", {})
    except: return {}

def main():
    if not KOBIS_API_KEY: return

    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    
    print(f"Target: {yesterday}")

    # 1. 어제 기준 박스오피스 리스트
    target_list = fetch_api_list(yesterday)
    final_movies = []

    # 2. 각 영화별 과거 데이터 풀 스캔 (병렬)
    with ThreadPoolExecutor(max_workers=5) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            open_dt = movie['openDt'].replace("-", "")
            
            # 개봉일 ~ 어제까지 날짜 리스트 생성
            date_list = []
            if open_dt and open_dt <= yesterday:
                curr = datetime.datetime.strptime(open_dt, "%Y%m%d")
            else:
                curr = datetime.datetime.strptime((today - datetime.timedelta(days=30)).strftime("%Y%m%d"), "%Y%m%d")
            
            end = datetime.datetime.strptime(yesterday, "%Y%m%d")
            
            while curr <= end:
                date_list.append(curr.strftime("%Y%m%d"))
                curr += datetime.timedelta(days=1)
            
            # API 보호를 위해 최근 90일로 제한
            if len(date_list) > 90: date_list = date_list[-90:]
            
            print(f"Fetching history for {movie['movieNm']} ({len(date_list)} days)")

            # 병렬 API 호출
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
            
            # 상세정보 병합
            detail = fetch_movie_detail(movie_cd)
            movie['detail'] = detail

            final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))

    os.makedirs("public", exist_ok=True)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {len(final_movies)} movies.")

if __name__ == "__main__":
    main()
