import os
import json
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor

# [설정]
DATA_FILE = "public/daily_data.json"
# KOBIS API 키는 GitHub Secrets에서 가져옵니다
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY") 
DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

def get_daily_list():
    yesterday = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime("%Y%m%d")
    try:
        res = requests.get(f"{DAILY_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}")
        data = res.json()
        return data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", []), yesterday
    except:
        return [], yesterday

def get_movie_detail(movie_cd):
    try:
        res = requests.get(f"{DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie_cd}")
        data = res.json()
        return data.get("movieInfoResult", {}).get("movieInfo", {})
    except:
        return {}

def get_trend_data(movie_cd, end_date):
    # 최근 30일 추이 데이터 생성
    trend = []
    date_list = [(datetime.datetime.strptime(end_date, "%Y%m%d") - datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(29, -1, -1)]
    
    # API 호출 최적화를 위해 여기서는 간단히 처리하거나, 
    # 실제로는 KOBIS 통계 API를 써야하지만 호출량 문제로 생략 또는 필요시 구현
    # 이번 버전에서는 '상세정보'까지만 미리 긁어둡니다.
    return []

def main():
    if not KOBIS_API_KEY:
        print("Error: KOBIS_API_KEY is missing")
        return

    print("Fetching Daily Box Office...")
    daily_list, target_date = get_daily_list()
    
    final_data = {
        "date": target_date,
        "movies": []
    }

    # Top 10 영화에 대해 상세정보 병렬 호출 (속도 향상)
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(get_movie_detail, m['movieCd']): m for m in daily_list}
        
        for future in futures:
            movie_basic = futures[future]
            try:
                detail = future.result()
                # 필요한 정보만 합체
                merged = {
                    **movie_basic,
                    "detail": detail
                }
                final_data["movies"].append(merged)
            except Exception as e:
                print(f"Error fetching detail: {e}")
                final_data["movies"].append(movie_basic)

    # 순위대로 다시 정렬
    final_data["movies"].sort(key=lambda x: int(x['rank']))

    # 파일 저장
    os.makedirs("public", exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {len(final_data['movies'])} movies to {DATA_FILE}")

if __name__ == "__main__":
    main()
