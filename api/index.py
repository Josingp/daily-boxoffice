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

# [보안 & 안전장치] 환경 변수 로드 및 공백 제거
# 실수로 복사된 공백이 있어도 자동으로 잘라냅니다.
def get_env_var(key):
    val = os.environ.get(key)
    return val.strip() if val else None

KOBIS_API_KEY = get_env_var("KOBIS_API_KEY")
NAVER_CLIENT_ID = get_env_var("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = get_env_var("NAVER_CLIENT_SECRET")

# URL 정의
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# 정규식
MOVIE_CD_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

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
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup_visit = BeautifulSoup(visit.text, 'html.parser')
        token = soup_visit.find('input', {'name': 'CSRFToken'})
        csrf = token.get('value', '') if token else ''
        payload_fixed = {
            'CSRFToken': csrf, 'loadEnd': '0', 'dmlMode': 'search', 'allMovieYn': 'Y', 'sMultiChk': ''
        }
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload_fixed, timeout=20)
        resp.encoding = 'utf-8'
        if len(BeautifulSoup(resp.text, 'html.parser').find_all("tr")) > 2:
            return resp, payload_fixed
    except: pass
    try:
        session = requests.Session()
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

# [API] 네이버 뉴스 (안전장치 적용)
@app.get("/api/news")
def get_movie_news(keyword: str = Query(...)):
    # 키 존재 여부 확인
    if not NAVER_CLIENT_ID or not NAVER_CLIENT_SECRET:
        return {
            "status": "error", 
            "message": "Server Config Error: Naver API Keys missing in Vercel Env."
        }

    try:
        url = "https://openapi.naver.com/v1/search/news.json"
        
        headers = {
            "X-Naver-Client-Id": NAVER_CLIENT_ID,
            "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
        }
        
        # 검색어 보정
        query_str = keyword if "영화" in keyword else f"{keyword} 영화"
        
        params = {
            "query": query_str,
            "display": 5,
            "sort": "sim"
        }
        
        resp = requests.get(url, headers=headers, params=params, timeout=5)
        
        # 401 에러 상세 처리
        if resp.status_code == 401:
            return {
                "status": "error", 
                "message": "Naver API Error: 401 Unauthorized. (Check Client ID/Secret in Vercel Env)"
            }
        
        if resp.status_code != 200:
            return {"status": "error", "message": f"Naver API Error: {resp.status_code}"}
            
        data = resp.json()
        news_list = []
        
        for item in data.get('items', []):
            clean_title = re.sub(r'<[^>]+>', '', item['title']).replace("&quot;", '"').replace("&apos;", "'")
            clean_desc = re.sub(r'<[^>]+>', '', item['description']).replace("&quot;", '"').replace("&apos;", "'")
            
            pub_date_str = ""
            try:
                dt = datetime.strptime(item.get('pubDate', ''), "%a, %d %b %Y %H:%M:%S %z")
                pub_date_str = dt.strftime("%Y-%m-%d %H:%M")
            except:
                pub_date_str = item.get('pubDate', '')[:16]

            news_list.append({
                "title": clean_title,
                "link": item['originallink'] or item['link'],
                "desc": clean_desc,
                "thumb": None, 
                "press": pub_date_str 
            })
            
        return {"status": "ok", "items": news_list}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

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

@app.get("/kobis/daily")
def get_daily(targetDt: str):
    if not KOBIS_API_KEY: return {"error": "API Key Missing"}
    return requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}").json()

@app.get("/kobis/weekly")
def get_weekly(targetDt: str, weekGb="1"):
    if not KOBIS_API_KEY: return {"error": "API Key Missing"}
    return requests.get(f"{KOBIS_WEEKLY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}&weekGb={weekGb}").json()

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
