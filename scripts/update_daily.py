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

# KOBIS API Fetcher
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

# [Realtime Crawler]
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
        
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=10)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        result = {}
        for row in soup.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            # KOBIS 테이블 구조 (변동 가능성 있음, 일반적 구조)
            # 0:순위, 1:제목, 2:개봉일, 3:예매율, 4:예매관객, 5:예매매출
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            
            result[title] = {
                "rank": cols[0].get_text(strip=True),
                "rate": cols[3].get_text(strip=True),
                "audiCnt": cols[4].get_text(strip=True), # 예매관객수
                "salesAmt": cols[5].get_text(strip=True), # 예매매출액
                # KOBIS 실시간 표에는 누적관객/누적매출이 잘 안나옴. 있는 열만 가져옴
                "audiAcc": cols[7].get_text(strip=True) if len(cols) > 7 else "0",
                "salesAcc": "0" 
            }
        return result
    except: return {}

def main():
    if not KOBIS_API_KEY: return

    # 1. 날짜 설정 (어제 기준)
    today = datetime.datetime.now()
    yesterday_dt = today - datetime.timedelta(days=1)
    yesterday_str = yesterday_dt.strftime("%Y%m%d")
    
    print(f"Target Date: {yesterday_str}")

    # 2. 과거 14일 데이터 한 번에 수집 (트렌드용)
    # daily_cache = { "20231001": [영화목록...], "20231002": [...] }
    daily_cache = {}
    
    # 병렬로 14일치 API 쏘기
    dates_to_fetch = [(yesterday_dt - datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(14)]
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_api_list, d): d for d in dates_to_fetch}
        for f in futures:
            date_key = futures[f]
            daily_cache[date_key] = f.result()

    # 기준일(어제) 데이터
    target_list = daily_cache.get(yesterday_str, [])
    
    # 실시간 데이터
    realtime_map = fetch_realtime_data()

    final_movies = []

    # 3. 영화별 데이터 병합
    for movie in target_list:
        movie_cd = movie['movieCd']
        
        # (1) 트렌드 데이터 생성 (cache에서 검색)
        trend = []
        for d in reversed(dates_to_fetch): # 과거 -> 현재 순
            day_list = daily_cache.get(d, [])
            # 해당 날짜 리스트에서 이 영화 찾기
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

        # (2) 실시간 데이터 병합 (제목 매칭)
        clean_title = movie['movieNm'].replace(" ", "")
        for rt_title, rt_data in realtime_map.items():
            if clean_title in rt_title.replace(" ", ""):
                movie['realtime'] = rt_data
                break
        
        # (3) 상세정보 (감독 등) - 필요시 병렬처리 가능하나 여기선 생략하거나 간단히
        # 상세정보는 변하지 않으므로, 기존 파일이 있다면 거기서 읽어오는게 좋음
        # 이번엔 단순화를 위해 생략 (프론트에서 로딩하거나, 필요시 추가)
        
        final_movies.append(movie)

    # 순위순 정렬
    final_movies.sort(key=lambda x: int(x['rank']))

    # 저장
    os.makedirs("public", exist_ok=True)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday_str, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Updated {len(final_movies)} movies with trend data.")

if __name__ == "__main__":
    main()
