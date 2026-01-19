import os
import requests
import re
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup 
from urllib.parse import quote

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# [환경변수 로드]
def get_env_var(key):
    val = os.environ.get(key)
    return val.strip() if val else None

KOBIS_API_KEY = get_env_var("KOBIS_API_KEY")
NAVER_CLIENT_ID = get_env_var("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = get_env_var("NAVER_CLIENT_SECRET")

# URL 상수
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# 정규식
MOVIE_CD_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# [헬퍼 함수]
def extract_crawl_time(soup):
    try:
        full_text = soup.get_text()
        match = re.search(r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})", full_text)
        return match.group(1) if match else ""
    except: return ""

def extract_movie_data(row):
    cols = row.find_all("td")
    if len(cols) < 8: return None
    movie_cd = None
    a_tag = cols[1].find("a")
    if a_tag and a_tag.has_attr("onclick"):
        match = MOVIE_CD_REGEX.search(a_tag["onclick"])
        if match: movie_cd = match.group(1)
    title_text = a_tag["title"].strip() if (a_tag and a_tag.get("title")) else cols[1].get_text(strip=True)
    def clean_num(s): return s.replace(',', '').strip()
    return {
        "movieCd": movie_cd,
        "rank": cols[0].get_text(strip=True),
        "title": title_text,
        "rate": cols[3].get_text(strip=True),     
        "salesAmt": clean_num(cols[4].get_text(strip=True)),
        "salesAcc": clean_num(cols[5].get_text(strip=True)),
        "audiCnt": clean_num(cols[6].get_text(strip=True)), 
        "audiAcc": clean_num(cols[7].get_text(strip=True))
    }

def fetch_kobis_smartly():
    # 간단 크롤링 (세션/헤더 설정)
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    try:
        data = {'dmlMode': 'search', 'allMovieYn': 'Y'}
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=data, timeout=10)
        return resp, data
    except: return None, None

# [API 1] 네이버 뉴스
@app.get("/api/news")
def get_movie_news(keyword: str = Query(...)):
    if not NAVER_CLIENT_ID or not NAVER_CLIENT_SECRET:
        return {"status": "error", "message": "API Key Config Missing"}
    try:
        url = "https://openapi.naver.com/v1/search/news.json"
        headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
        # 검색어 보정
        query_str = keyword if "영화" in keyword else f"{keyword} 영화"
        resp = requests.get(url, headers=headers, params={"query": query_str, "display": 5, "sort": "sim"}, timeout=5)
        
        if resp.status_code != 200: return {"status": "error", "message": f"Naver Error: {resp.status_code}"}
        
        items = []
        for item in resp.json().get('items', []):
            clean_title = re.sub(r'<[^>]+>', '', item['title']).replace("&quot;", '"').replace("&apos;", "'")
            clean_desc = re.sub(r'<[^>]+>', '', item['description']).replace("&quot;", '"').replace("&apos;", "'")
            pub = item.get('pubDate', '')[:16]
            items.append({"title": clean_title, "link": item['originallink'] or item['link'], "desc": clean_desc, "press": pub})
        return {"status": "ok", "items": items}
    except Exception as e: return {"status": "error", "message": str(e)}

# [API 2] 실시간 랭킹 (Fallback용)
@app.get("/api/realtime")
def get_realtime_ranking():
    try:
        resp, _ = fetch_kobis_smartly()
        if not resp or resp.status_code != 200: return {"status": "error", "message": "Connection Failed"}
        soup = BeautifulSoup(resp.text, 'html.parser')
        crawled_time = extract_crawl_time(soup)
        data_list = []
        for row in soup.find_all("tr"):
            d = extract_movie_data(row)
            if d: data_list.append(d)
        return {"status": "ok", "crawledTime": crawled_time, "data": data_list}
    except Exception as e: return {"status": "error", "message": str(e)}

# [API 3] 예약 상세 (Fallback용)
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(...), movieCd: str = Query(None)):
    try:
        resp, _ = fetch_kobis_smartly()
        if not resp: return {"found": False}
        soup = BeautifulSoup(resp.text, 'html.parser')
        crawled_time = extract_crawl_time(soup)
        target_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
        for row in soup.find_all("tr"):
            data = extract_movie_data(row)
            if not data: continue
            row_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            if (movieCd and data['movieCd'] == movieCd) or (target_norm in row_norm):
                return {"found": True, "crawledTime": crawled_time, "data": data}
        return {"found": False}
    except: return {"found": False}

# [API 4] KOBIS Proxy (일별, 상세, 트렌드)
@app.get("/kobis/daily")
def get_daily(targetDt: str):
    if not KOBIS_API_KEY: return {"error": "API Key Missing"}
    return requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}").json()

@app.get("/kobis/detail")
def get_detail(movieCd: str):
    if not KOBIS_API_KEY: return {"error": "API Key Missing"}
    return requests.get(f"{KOBIS_MOVIE_INFO_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}").json()

@app.get("/kobis/trend")
def get_trend(movieCd: str, endDate: str):
    if not KOBIS_API_KEY: return []
    try:
        dates = []
        end_dt = datetime.strptime(endDate, "%Y%m%d")
        for i in range(27, -1, -1):
            dates.append((end_dt - timedelta(days=i)).strftime("%Y%m%d"))
        def fetch(dt):
            try:
                res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={dt}", timeout=3).json()
                daily = res.get('boxOfficeResult', {}).get('dailyBoxOfficeList', [])
                m = next((x for x in daily if x['movieCd'] == movieCd), None)
                if m: return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": int(m['audiCnt']), "scrnCnt": int(m['scrnCnt'])}
            except: pass
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0, "scrnCnt": 0}
        with ThreadPoolExecutor(max_workers=10) as ex:
            return [r for r in list(ex.map(fetch, dates)) if r]
    except: return []
