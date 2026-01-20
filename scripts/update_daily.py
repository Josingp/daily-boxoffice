import os
import json
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup

# [설정]
DAILY_FILE = "public/daily_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

# [실시간 데이터 정밀 수집]
def fetch_realtime_data():
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/'
    }
    try:
        session = requests.Session()
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        # 현재 시간 (KST 기준)
        now_str = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")

        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=15)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        result = {}
        
        for row in soup.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            
            # KOBIS 컬럼 매핑 (정확히 확인된 인덱스)
            # 3:예매율, 4:예매관객, 5:예매매출, 6:누적관객, 7:누적매출
            result[title] = {
                "rank": cols[0].get_text(strip=True),
                "rate": cols[3].get_text(strip=True),
                "audiCnt": cols[4].get_text(strip=True), # 예매관객
                "salesAmt": cols[5].get_text(strip=True), # 예매매출
                "audiAcc": cols[6].get_text(strip=True),  # 누적관객
                "salesAcc": cols[7].get_text(strip=True), # 누적매출
                "crawledTime": now_str
            }
        return result
    except: return {}

def main():
    if not KOBIS_API_KEY: return

    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    day_before = (today - datetime.timedelta(days=2)).strftime("%Y%m%d")

    print(f"Target: {yesterday}")

    daily_cache = {}
    dates_to_fetch = [(today - datetime.timedelta(days=i+1)).strftime("%Y%m%d") for i in range(14)]
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_api_list, d): d for d in dates_to_fetch}
        for f in futures:
            date_key = futures[f]
            daily_cache[date_key] = f.result()

    target_list = daily_cache.get(yesterday, [])
    prev_list = daily_cache.get(day_before, [])
    prev_map = {m['movieCd']: m for m in prev_list}
    realtime_map = fetch_realtime_data()

    final_movies = []

    for movie in target_list:
        # 1. Trend
        trend = []
        for d in reversed(dates_to_fetch):
            day_data = daily_cache.get(d, [])
            found = next((m for m in day_data if m['movieCd'] == movie['movieCd']), None)
            trend.append({
                "date": d,
                "dateDisplay": f"{d[4:6]}/{d[6:8]}",
                "audiCnt": int(found['audiCnt']) if found else 0,
                "salesAmt": int(found['salesAmt']) if found else 0,
                "scrnCnt": int(found['scrnCnt']) if found else 0,
                "showCnt": int(found['showCnt']) if found else 0
            })
        movie['trend'] = trend

        # 2. 증감 데이터
        prev = prev_map.get(movie['movieCd'])
        movie['scrnInten'] = int(movie['scrnCnt']) - int(prev['scrnCnt']) if prev else 0
        movie['showInten'] = int(movie['showCnt']) - int(prev['showCnt']) if prev else 0

        # 3. 실시간 데이터 병합
        clean_name = movie['movieNm'].replace(" ", "").strip()
        for rt_title, rt_data in realtime_map.items():
            if clean_name in rt_title.replace(" ", ""):
                movie['realtime'] = rt_data
                break
        
        final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))

    os.makedirs("public", exist_ok=True)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Daily Data Saved: {len(final_movies)} movies.")

if __name__ == "__main__":
    main()
