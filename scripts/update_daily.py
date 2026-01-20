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

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': KOBIS_REALTIME_URL
}

# 1. KOBIS API 호출 함수
def fetch_api_data(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}", timeout=10)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

# 2. 실시간 예매율 크롤링 (고정 Payload)
def fetch_realtime_data():
    try:
        session = requests.Session()
        visit = session.get(KOBIS_REALTIME_URL, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        resp = session.post(KOBIS_REALTIME_URL, headers=HEADERS, data={
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
                "audiCnt": cols[6].get_text(strip=True),
                "audiAcc": cols[7].get_text(strip=True),
                "salesAmt": cols[4].get_text(strip=True),
                "salesAcc": cols[5].get_text(strip=True)
            }
        return result
    except: return {}

# 3. 영화 상세정보 (감독/배우 등)
def fetch_movie_detail(movie_cd):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movie_cd}")
        return res.json().get("movieInfoResult", {}).get("movieInfo", {})
    except: return {}

def main():
    if not KOBIS_API_KEY:
        print("Skipping: No API Key")
        return

    # 날짜 계산
    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    day_before = (today - datetime.timedelta(days=2)).strftime("%Y%m%d")

    print(f"Fetching Data: {yesterday} vs {day_before}...")

    # 데이터 수집 (병렬 처리 아님 - 순서 중요)
    daily_list = fetch_api_data(yesterday)
    prev_list = fetch_api_data(day_before)
    realtime_map = fetch_realtime_data()

    # 전일 대비 데이터 매핑용 딕셔너리
    prev_map = {m['movieCd']: m for m in prev_list}

    final_movies = []

    # 상세정보 병렬 호출을 위한 Executor
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fetch_movie_detail, m['movieCd']): m for m in daily_list}
        
        for future in futures:
            movie = futures[future]
            try:
                detail = future.result()
                movie['detail'] = detail # 상세정보 병합
            except: pass
            
            # [통계 1] 전일 대비 스크린/상영횟수 증감 계산
            prev = prev_map.get(movie['movieCd'])
            if prev:
                movie['scrnInten'] = int(movie['scrnCnt']) - int(prev['scrnCnt'])
                movie['showInten'] = int(movie['showCnt']) - int(prev['showCnt'])
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0

            # [통계 2] 실시간 예매 데이터 병합 (이름 매칭)
            # API 영화명과 크롤링 영화명이 100% 일치하지 않을 수 있어 정규화
            clean_title = movie['movieNm'].replace(" ", "")
            for rt_title, rt_data in realtime_map.items():
                if clean_title in rt_title.replace(" ", "") or rt_title.replace(" ", "") in clean_title:
                    movie['realtime'] = rt_data
                    break
            
            final_movies.append(movie)

    # 순위 정렬
    final_movies.sort(key=lambda x: int(x['rank']))

    # 저장
    data = {
        "date": yesterday,
        "movies": final_movies
    }
    
    os.makedirs("public", exist_ok=True)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {len(final_movies)} movies.")

if __name__ == "__main__":
    main()
