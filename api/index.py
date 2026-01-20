import os
import requests
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from urllib.parse import quote
from bs4 import BeautifulSoup
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS 설정
app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"]
)

# 환경변수 및 상수 설정
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# ---------------------------------------------------------
# [기능 1] 일별 박스오피스 Fallback API (JSON 파일 없을 때 호출)
# ---------------------------------------------------------
@app.get("/kobis/daily")
def get_daily_boxoffice(targetDt: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"error": "API Key Missing", "movies": []}

    try:
        # 1. KOBIS API로 리스트 가져오기
        res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}", timeout=5)
        data = res.json()
        daily_list = data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        if not daily_list:
            return {"movies": []}

        final_movies = []

        # 2. 영화 상세정보 병렬 호출
        def fetch_detail(movie):
            try:
                r = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie['movieCd']}", timeout=3)
                detail = r.json().get("movieInfoResult", {}).get("movieInfo", {})
                movie['detail'] = detail
            except:
                movie['detail'] = {}
            return movie

        with ThreadPoolExecutor(max_workers=5) as ex:
            final_movies = list(ex.map(fetch_detail, daily_list))
        
        final_movies.sort(key=lambda x: int(x['rank']))

        return {"movies": final_movies}

    except Exception as e:
        return {"error": str(e), "movies": []}

# ---------------------------------------------------------
# [기능 2] 영화 상세정보 API
# ---------------------------------------------------------
@app.get("/kobis/detail")
def get_movie_detail(movieCd: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"movieInfoResult": {"movieInfo": {}}}
    
    try:
        res = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}", timeout=5)
        return res.json()
    except Exception as e:
        return {"error": str(e)}

# ---------------------------------------------------------
# [기능 3] 특정 영화 과거 흥행 추이 (그래프용)
# ---------------------------------------------------------
@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    
    today = datetime.now()
    yesterday = (today - timedelta(days=1))
    
    if openDt:
        try:
            start_date = datetime.strptime(openDt.replace("-",""), "%Y%m%d")
        except:
            start_date = today - timedelta(days=30)
    else:
        start_date = today - timedelta(days=30)
        
    if (yesterday - start_date).days > 60:
        start_date = yesterday - timedelta(days=60)
        
    date_list = []
    curr = start_date
    while curr <= yesterday:
        date_list.append(curr.strftime("%Y%m%d"))
        curr += timedelta(days=1)
        
    results = []
    def fetch_daily_for_trend(d):
        try:
            url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={d}"
            r = requests.get(url, timeout=3).json()
            box_list = r.get('boxOfficeResult',{}).get('dailyBoxOfficeList',[])
            found = next((x for x in box_list if x['movieCd'] == movieCd), None)
            if found:
                return {
                    "date": d,
                    "dateDisplay": f"{d[4:6]}/{d[6:8]}",
                    "audiCnt": int(found['audiCnt']),
                    "salesAmt": int(found['salesAmt']),
                    "scrnCnt": int(found['scrnCnt']),
                    "showCnt": int(found['showCnt'])
                }
        except: pass
        return None

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch_daily_for_trend, date_list))
        
    clean = [r for r in results if r]
    clean.sort(key=lambda x: x['date'])
    return clean

# ---------------------------------------------------------
# [기능 4] 실시간 예매율 크롤링 API (JSON 없을 때 백업용)
# ---------------------------------------------------------
def scrape_kobis_realtime():
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': KOBIS_REALTIME_URL
    }
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=5)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf_element = soup.find('input', {'name': 'CSRFToken'})
        if not csrf_element: return []
        
        csrf = csrf_element['value']
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=10)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 조회 시간 파싱
        crawled_time = ""
        try:
            text_content = soup.get_text()
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", text_content)
            if match:
                crawled_time = match.group(1).replace("/", "-")
        except: pass
        
        if not crawled_time:
            crawled_time = datetime.now().strftime("%Y-%m-%d %H:%M")

        results = []
        rows = soup.find_all("tr")
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if not rank.isdigit(): continue
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            rate = cols[3].get_text(strip=True)
            
            results.append({
                "movieCd": str(hash(title)), # 임시 ID
                "rank": rank,
                "title": title,
                "rate": rate,
                "audiCnt": cols[6].get_text(strip=True),
                "salesAmt": cols[4].get_text(strip=True),
                "audiAcc": cols[7].get_text(strip=True),
                "salesAcc": cols[5].get_text(strip=True),
                "crawledTime": crawled_time
            })
        return results
    except:
        return []

@app.get("/api/realtime")
def get_realtime_ranking():
    data = scrape_kobis_realtime()
    time = data[0]['crawledTime'] if data else ""
    return {"status": "ok", "data": data, "crawledTime": time}

# ---------------------------------------------------------
# [기능 5] 특정 영화 실시간 정보 조회 (상세보기용)
# ---------------------------------------------------------
@app.get("/api/reservation")
def get_reservation(movieName: str = Query(...)):
    data = scrape_kobis_realtime()
    # 정규화하여 매칭 (특수문자 제거, 공백 제거 후 비교)
    norm_query = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
    
    found_data = None
    for item in data:
        norm_title = re.sub(r'[^0-9a-zA-Z가-힣]', '', item['title']).lower()
        if norm_query in norm_title or norm_title in norm_query:
            found_data = item
            break
            
    if found_data:
        return {"found": True, "data": found_data, "crawledTime": found_data['crawledTime']}
    return {"found": False}

# ---------------------------------------------------------
# [기능 6] 뉴스/포스터 (Fallback)
# ---------------------------------------------------------
# 주의: 뉴스/포스터 크롤링은 타임아웃 위험이 커서 기본적으로 빈 값을 반환합니다.
# 만약 별도의 크롤링 로직이 있다면 이 함수 내부에 구현하시면 됩니다.
@app.get("/api/news")
def get_news(keyword: str = ""):
    return {"items": []}

@app.get("/api/poster")
def get_poster(movieName: str = ""):
    return {"url": ""}
