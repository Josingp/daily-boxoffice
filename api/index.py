import os
import requests
import re
from datetime import datetime, timedelta
from bs4 import BeautifulSoup 
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def get_env(k): return os.environ.get(k, "").strip()

KOBIS_API_KEY = get_env("KOBIS_API_KEY")
NAVER_ID = get_env("NAVER_CLIENT_ID")
NAVER_SECRET = get_env("NAVER_CLIENT_SECRET")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# [헬퍼] 데이터 추출 (문자열 그대로 반환)
def extract_movie_data(row):
    cols = row.find_all("td")
    if len(cols) < 8: return None
    
    movie_cd = None
    a_tag = cols[1].find("a")
    if a_tag and a_tag.has_attr("onclick"):
        match = re.search(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)", a_tag["onclick"])
        if match: movie_cd = match.group(1)
        
    title = a_tag["title"].strip() if (a_tag and a_tag.get("title")) else cols[1].get_text(strip=True)
    
    # 쉼표, % 그대로 유지 (사용자 요청)
    return {
        "movieCd": movie_cd,
        "rank": cols[0].get_text(strip=True),
        "title": title,
        "rate": cols[3].get_text(strip=True),     # 예매율
        "salesAmt": cols[4].get_text(strip=True), # 예매매출
        "salesAcc": cols[5].get_text(strip=True), # 누적매출
        "audiCnt": cols[6].get_text(strip=True),  # 예매관객
        "audiAcc": cols[7].get_text(strip=True)   # 누적관객
    }

def fetch_kobis_fixed():
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': KOBIS_REALTIME_URL,
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=5)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        payload = {'CSRFToken': csrf, 'loadEnd': '0', 'dmlMode': 'search', 'allMovieYn': 'Y', 'sMultiChk': ''}
        return session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=10)
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
            tag = soup.find(string=re.compile("조회일시"))
            if tag:
                match = re.search(r"(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", tag)
                if match: time_text = match.group(1).replace("/", "-")
        except: pass
        if not time_text:
             time_text = (datetime.utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")
            
        return {"status": "ok", "data": data, "crawledTime": time_text}
    except: return {"status": "error"}

@app.get("/api/reservation")
def reservation(movieName: str = Query(...), movieCd: str = Query(None)):
    try:
        resp = fetch_kobis_fixed()
        if not resp: return {"found": False}
        soup = BeautifulSoup(resp.text, 'html.parser')
        target_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
        
        time_text = ""
        try:
            tag = soup.find(string=re.compile("조회일시"))
            if tag:
                match = re.search(r"(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", tag)
                if match: time_text = match.group(1).replace("/", "-")
        except: pass

        for row in soup.find_all("tr"):
            data = extract_movie_data(row)
            if not data: continue
            row_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            if (movieCd and data['movieCd'] == movieCd) or (target_norm in row_norm):
                return {"found": True, "data": data, "crawledTime": time_text}
        return {"found": False}
    except: return {"found": False}

# ... (기존 API 유지)
@app.get("/api/news")
def news(keyword: str = Query(...)):
    if not NAVER_ID or not NAVER_SECRET: return {"status":"error"}
    try:
        url = "https://openapi.naver.com/v1/search/news.json"
        h = {"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET}
        res = requests.get(url, headers=h, params={"query":keyword+" 영화", "display":5, "sort":"sim"}, timeout=5)
        return {"status":"ok", "items":[{"title":i['title'].replace("<b>","").replace("</b>",""), "link":i['link'], "desc":i['description'], "press":i['pubDate'][:16]} for i in res.json().get('items',[])]}
    except: return {"status":"error"}

@app.get("/api/poster")
def poster(movieName: str = Query(...)):
    if not NAVER_ID or not NAVER_SECRET: return {"status":"error"}
    try:
        url = "https://openapi.naver.com/v1/search/image"
        h = {"X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET}
        res = requests.get(url, headers=h, params={"query":movieName+" 영화 포스터", "display":1, "sort":"sim", "filter":"medium"}, timeout=5)
        return {"status":"ok", "url": res.json().get('items',[])[0]['link']} if res.status_code==200 and res.json().get('items') else {"status":"ok", "url":""}
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
    # 트렌드 API는 이제 스크립트에서 통합 수집하므로 빈 리스트 반환
    return []
