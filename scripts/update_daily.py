import os
import json
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup

DAILY_FILE = "public/daily_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# API 호출
def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

# 실시간 데이터 병합용 크롤러
def fetch_realtime_data():
    headers = {'User-Agent': 'Mozilla/5.0 ...'} # (생략, 위와 동일 헤더 사용)
    try:
        # ... (update_realtime.py와 동일한 로직으로 현재 상태 1회 스냅샷)
        # 여기서는 생략했지만 실제 적용시에는 update_realtime.py의 로직을 그대로 함수화해서 씁니다.
        # 간략화를 위해 결과만 리턴한다고 가정.
        return {} 
    except: return {}

def main():
    if not KOBIS_API_KEY: return

    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    
    print(f"Target Date: {yesterday}")

    # 1. 어제자 리스트 확보
    target_list = fetch_api_list(yesterday)
    final_movies = []

    # 2. 영화별 풀 히스토리 수집
    with ThreadPoolExecutor(max_workers=5) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            open_dt = movie['openDt'].replace("-", "")
            
            # 개봉일이 유효하면 개봉일부터, 아니면 최근 30일
            start_date = open_dt if (open_dt and open_dt <= yesterday) else (today - datetime.timedelta(days=30)).strftime("%Y%m%d")
            
            # 날짜 리스트 생성
            date_list = []
            curr = datetime.datetime.strptime(start_date, "%Y%m%d")
            end = datetime.datetime.strptime(yesterday, "%Y%m%d")
            while curr <= end:
                date_list.append(curr.strftime("%Y%m%d"))
                curr += datetime.timedelta(days=1)
            
            # 데이터 양 조절 (최대 90일)
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

            # 전일 대비 증감 계산 (마지막 데이터 기준)
            if len(trend_data) >= 2:
                last = trend_data[-1]
                prev = trend_data[-2]
                movie['scrnInten'] = last['scrnCnt'] - prev['scrnCnt']
                movie['showInten'] = last['showCnt'] - prev['showCnt']
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0
            
            final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))

    os.makedirs("public", exist_ok=True)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {len(final_movies)} movies.")

if __name__ == "__main__":
    main()
