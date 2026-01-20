import os
import json
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup

DAILY_FILE = "public/daily_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# KOBIS API Fetcher
def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

# [Realtime Crawler] - 보라색 카드용 데이터
def fetch_realtime_data():
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    try:
        session = requests.Session()
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=20)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        result = {}
        for row in soup.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            result[title] = {
                "rank": cols[0].get_text(strip=True),
                "rate": cols[3].get_text(strip=True),
                "audiCnt": cols[4].get_text(strip=True), # 예매관객
                "salesAmt": cols[5].get_text(strip=True), # 예매매출
                "audiAcc": cols[7].get_text(strip=True),  # 누적관객
                "salesAcc": "0" 
            }
        return result
    except: return {}

def main():
    if not KOBIS_API_KEY: return

    today = datetime.datetime.now()
    yesterday_dt = today - datetime.timedelta(days=1)
    yesterday_str = yesterday_dt.strftime("%Y%m%d")
    
    print(f"Target Date: {yesterday_str}")

    daily_cache = {}
    dates_to_fetch = [(yesterday_dt - datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(14)]
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_api_list, d): d for d in dates_to_fetch}
        for f in futures:
            date_key = futures[f]
            daily_cache[date_key] = f.result()

    target_list = daily_cache.get(yesterday_str, [])
    realtime_map = fetch_realtime_data() # 실시간 데이터 확보

    final_movies = []

    for movie in target_list:
        movie_cd = movie['movieCd']
        
        # 트렌드 데이터 생성
        trend = []
        for d in reversed(dates_to_fetch):
            day_list = daily_cache.get(d, [])
            found = next((m for m in day_list if m['movieCd'] == movie_cd), None)
            trend.append({
                "date": d,
                "dateDisplay": f"{d[4:6]}/{d[6:8]}",
                "audiCnt": int(found['audiCnt']) if found else 0,
                "salesAmt": int(found['salesAmt']) if found else 0,
                "scrnCnt": int(found['scrnCnt']) if found else 0,
                "showCnt": int(found['showCnt']) if found else 0
            })
        
        movie['trend'] = trend

        # [중요] 실시간 데이터 병합 (Daily 영화에도 보라색 카드 표시용)
        clean_title = movie['movieNm'].replace(" ", "")
        for rt_title, rt_data in realtime_map.items():
            if clean_title in rt_title.replace(" ", "") or rt_title.replace(" ", "") in clean_title:
                movie['realtime'] = rt_data
                break
        
        final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))

    os.makedirs("public", exist_ok=True)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday_str, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Updated {len(final_movies)} movies.")

if __name__ == "__main__":
    main()
