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
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def get_env(k): return os.environ.get(k, "").strip()

KOBIS_API_KEY = get_env("KOBIS_API_KEY")
NAVER_ID = get_env("NAVER_CLIENT_ID")
NAVER_SECRET = get_env("NAVER_CLIENT_SECRET")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# [헬퍼] 데이터 추출
def extract_movie_data(row):
    cols = row.find_all("td")
    if len(cols) < 8: return None
    
    movie_cd = None
    a_tag = cols[1].find("a")
    if a_tag and a_tag.has_attr("onclick"):
        match = re.search(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)", a_tag["onclick"])
        if match: movie_cd = match.group(1)
        
    title = a_tag["title"].strip() if (a_tag and a_tag.get("title")) else cols[1].get_text(strip=True)
    def clean(s): return s.replace(',', '').strip()
    
    return {
        "movieCd": movie_cd,
        "rank": cols[0].get_text(strip=True),
        "title": title,
        "rate": cols[3].get_text(strip=True),
        "salesAmt": clean(cols[4].get_text(strip=True)),
        "salesAcc": clean(cols[5].get_text(strip=True)),
        "audiCnt": clean(cols[6].get_text(strip=True)),
        "audiAcc": clean(cols[7].get_text(strip=True))
    }

# [핵심] 고정 Payload 방식 (가장 확실한 방법)
def fetch_kobis_fixed():
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do',
        'Origin': 'https://www.kobis.or.kr',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    try:
        # 1. GET으로 토큰 획득
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=5)
        soup = BeautifulSoup(visit.text, 'html.parser')
        token_input = soup.find('input', {'name': 'CSRFToken'})
        csrf_token = token_input.get('value', '') if token_input else ''

        # 2. 필수값만 채운 고정 Payload 전송
        payload = {
            'CSRFToken': csrf_token,
            'loadEnd': '0',
            'dmlMode': 'search',
            'allMovieYn': 'Y', 
            'sMultiChk': ''
        }
        
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=10)
        return resp
    except: return None

@app.get("/")
def root(): return {"status": "ok"}

@app.get("/api/realtime")
def realtime():
    try:
        resp = fetch_kobis_fixed()
        if not resp or resp.status_code != 200: return {"status": "error"}
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        data = []
        for row in soup.find_all("tr"):
            d = extract_movie_data(row)
            if d: data.append(d)
            
        # 시간 추출
        time_text = ""
        try:
            match = re.search(r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})", soup.get_text())
            if match: time_text = match.group(1)
        except: pass
            
        return {"status": "ok", "data": data, "crawledTime": time_text}
    except: return {"status": "error"}

@app.get("/api/reservation")
def reservation(movieName: str = Query(...), movieCd: str = Query(None)):
    try:
        resp = fetch_kobis_fixed()
        if not resp: return {"found": False}
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        target_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
        
        for row in soup.find_all("tr"):
            data = extract_movie_data(row)
            if not data: continue
            
            row_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            if (movieCd and data['movieCd'] == movieCd) or (target_norm in row_norm):
                # 시간 정보 추출
                time_text = ""
                try:
                    match = re.search(r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})", soup.get_text())
                    if match: time_text = match.group(1)
                except: pass
                
                return {"found": True, "data": data, "crawledTime": time_text}
                
        return {"found": False}
    except: return {"found": False}

@app.get("/api/news")
def news(keyword: str = Query(...)):
    if not NAVER_ID or not NAVER_SECRET: return {"status":"error"}
    try:
        url = "https://openapi.naver.com/v1/search/news.json"
        h = {"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET}
        q = keyword if "영화" in keyword else f"{keyword} 영화"
        res = requests.get(url, headers=h, params={"query":q, "display":5, "sort":"sim"}, timeout=5)
        items = []
        if res.status_code == 200:
            for i in res.json().get('items', []):
                t = re.sub(r'<[^>]+>', '', i['title']).replace("&quot;",'"').replace("&apos;","'")
                d = re.sub(r'<[^>]+>', '', i['description']).replace("&quot;",'"').replace("&apos;","'")
                items.append({"title":t, "link":i['originallink'] or i['link'], "desc":d, "press":i.get('pubDate','')[:16]})
        return {"status":"ok", "items":items}
    except: return {"status":"error"}

@app.get("/api/poster")
def poster(movieName: str = Query(...)):
    if not NAVER_ID or not NAVER_SECRET: return {"status":"error"}
    try:
        url = "https://openapi.naver.com/v1/search/image"
        h = {"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET}
        res = requests.get(url, headers=h, params={"query":f"{movieName} 영화 포스터", "display":1, "sort":"sim", "filter":"medium"}, timeout=5)
        if res.status_code == 200:
            items = res.json().get('items', [])
            if items: return {"status":"ok", "url": items[0]['link']}
        return {"status":"ok", "url": ""}
    except: return {"status":"error"}

@app.get("/kobis/daily")
def daily(targetDt: str):
    if not KOBIS_API_KEY: return {}
    return requests.get(f"https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?key={KOBIS_API_KEY}&targetDt={targetDt}").json()

@app.get("/kobis/detail")
def detail(movieCd: str):
    if not KOBIS_API_KEY: return {}
    return requests.get(f"https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json?key={KOBIS_API_KEY}&movieCd={movieCd}").json()

@app.get("/kobis/trend")
def trend(movieCd: str, endDate: str):
    if not KOBIS_API_KEY: return []
    try:
        dates = [(datetime.strptime(endDate,"%Y%m%d")-timedelta(days=i)).strftime("%Y%m%d") for i in range(27,-1,-1)]
        def fetch(d):
            try:
                r = requests.get(f"https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?key={KOBIS_API_KEY}&targetDt={d}", timeout=3).json()
                m = next((x for x in r.get('boxOfficeResult',{}).get('dailyBoxOfficeList',[]) if x['movieCd']==movieCd), None)
                if m: return {"date":d, "dateDisplay":f"{d[4:6]}/{d[6:8]}", "audiCnt":int(m['audiCnt']), "scrnCnt":int(m['scrnCnt'])}
            except: pass
            return {"date":d, "dateDisplay":f"{d[4:6]}/{d[6:8]}", "audiCnt":0, "scrnCnt":0}
        with ThreadPoolExecutor(max_workers=10) as ex: return [r for r in list(ex.map(fetch, dates)) if r]
    except: return []
