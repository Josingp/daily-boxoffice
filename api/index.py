import os
import requests
import re
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup 

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

KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")

# URL 정의
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# 정규식: onclick="mstView('movie','12345678')"
MOVIE_CD_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

def extract_crawl_time(soup):
    """전체 텍스트에서 조회일시(YYYY/MM/DD HH:MM) 추출"""
    try:
        full_text = soup.get_text()
        match = re.search(r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})", full_text)
        return match.group(1) if match else ""
    except:
        return ""

def extract_movie_data(row):
    cols = row.find_all("td")
    if len(cols) < 8: return None

    # 1. 영화 코드
    movie_cd = None
    a_tag = cols[1].find("a")
    if a_tag and a_tag.has_attr("onclick"):
        match = MOVIE_CD_REGEX.search(a_tag["onclick"])
        if match:
            movie_cd = match.group(1)
    
    # 2. 제목
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

def get_base_headers():
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do',
        'Origin': 'https://www.kobis.or.kr',
        'Content-Type': 'application/x-www-form-urlencoded'
    }

def fetch_kobis_smartly():
    session = requests.Session()
    headers = get_base_headers()

    # 1차 시도 (고정값)
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup_visit = BeautifulSoup(visit.text, 'html.parser')
        token = soup_visit.find('input', {'name': 'CSRFToken'})
        csrf = token.get('value', '') if token else ''

        payload = {
            'CSRFToken': csrf, 'loadEnd': '0', 'dmlMode': 'search', 'allMovieYn': 'Y', 'sMultiChk': ''
        }
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=20)
        resp.encoding = 'utf-8'
        
        if len(BeautifulSoup(resp.text, 'html.parser').find_all("tr")) > 2:
            return resp, payload
    except: pass

    # 2차 시도 (동적값)
    try:
        session = requests.Session() # 새 세션
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        payload = {}
        for inp in soup.find_all('input'):
            if inp.get('name'): payload[inp.get('name')] = inp.get('value', '')
        for sel in soup.find_all('select'):
            if sel.get('name'):
                opt = sel.find('option', selected=True) or sel.find('option')
                payload[sel.get('name')] = opt.get('value', '') if opt else ''
        
        payload.update({'dmlMode': 'search', 'allMovieYn': 'Y'})
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=20)
        resp.encoding = 'utf-8'
        return resp, payload
    except: return None, None

# [API] 실시간 랭킹 (전체 목록)
@app.get("/api/realtime")
def get_realtime_ranking():
    try:
        resp, _ = fetch_kobis_smartly()
        if not resp or resp.status_code != 200:
            return {"status": "error", "message": "Connection Failed"}
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        crawled_time = extract_crawl_time(soup)
        data_list = []
        for row in soup.find_all("tr"):
            d = extract_movie_data(row)
            if d: data_list.append(d)
            
        return {"status": "ok", "crawledTime": crawled_time, "data": data_list}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# [API] 상세정보용 예매율 조회
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
            
            # ID 매칭 or 이름 매칭
            row_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            if (movieCd and data['movieCd'] == movieCd) or (target_norm in row_norm):
                return {"found": True, "crawledTime": crawled_time, "data": data}
        
        return {"found": False}
    except: return {"found": False}

# [API] 기존 프록시들 (필수)
@app.get("/kobis/daily")
def get_daily(targetDt: str):
    return requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}").json()

@app.get("/kobis/weekly")
def get_weekly(targetDt: str, weekGb="1"):
    return requests.get(f"{KOBIS_WEEKLY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}&weekGb={weekGb}").json()

@app.get("/kobis/detail")
def get_detail(movieCd: str):
    return requests.get(f"{KOBIS_MOVIE_INFO_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}").json()

@app.get("/kobis/trend")
def get_trend(movieCd: str, endDate: str):
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
