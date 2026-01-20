import os
import requests
import re
from datetime import datetime
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

# [정규식] mstView('movie', '20231234') 형태만 정확히 캐치
MSTVIEW_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

def fetch_kobis_robust():
    """
    [안정화된 크롤링 전략]
    1. 세션 유지 (Cookie/CSRF 관리)
    2. GET으로 CSRF Token 확보
    3. POST로 데이터 요청 (dmlMode=search)
    4. 실패 시 1회 자동 재시도
    """
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': KOBIS_REALTIME_URL,
        'Origin': 'https://www.kobis.or.kr'
    }

    for attempt in range(2): # 2회 시도
        try:
            # 1. GET (토큰 확보)
            visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=5)
            soup = BeautifulSoup(visit.text, 'html.parser')
            token_tag = soup.find('input', {'name': 'CSRFToken'})
            csrf = token_tag['value'] if token_tag else ''

            # 2. POST (데이터 요청)
            payload = {
                'CSRFToken': csrf,
                'dmlMode': 'search', # 필수값
                'allMovieYn': 'Y',   # 전체 영화
                'loadEnd': '0'
            }
            resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=10)
            
            # 성공 여부 체크 (mstView가 포함된 행이 있는지)
            if "mstView" in resp.text:
                return resp
            
            print(f"[KOBIS] Attempt {attempt+1} failed (No data found). Retrying...")
        except Exception as e:
            print(f"[KOBIS] Attempt {attempt+1} Error: {e}")
    
    return None

def parse_movie_row(row):
    cols = row.find_all("td")
    if len(cols) < 8: return None
    
    # mstView가 있는 a태그 찾기 (핵심)
    target_link = row.find("a", onclick=MSTVIEW_REGEX.search)
    if not target_link: return None

    # 영화 코드 추출
    match = MSTVIEW_REGEX.search(target_link['onclick'])
    movie_cd = match.group(1) if match else ""
    
    # 제목 추출
    title = target_link.get("title", "").strip() or target_link.get_text(strip=True)
    
    # 숫자 정제 함수
    def clean(s): return s.replace(',', '').replace('%', '').strip()

    return {
        "movieCd": movie_cd,
        "rank": cols[0].get_text(strip=True),
        "title": title,
        "rate": clean(cols[3].get_text()),
        "salesAmt": clean(cols[4].get_text()),
        "audiCnt": clean(cols[6].get_text()), # 예매 관객수
        "audiAcc": clean(cols[7].get_text())  # 누적 관객수
    }

@app.get("/")
def root(): return {"status": "ok"}

@app.get("/api/realtime")
def realtime():
    start_time = datetime.now()
    resp = fetch_kobis_robust()
    
    meta = {
        "status": "fail",
        "crawledTime": "",
        "processTime": 0,
        "source": "live_crawl"
    }

    if not resp:
        return {"meta": meta, "data": []}

    try:
        soup = BeautifulSoup(resp.text, 'html.parser')
        data = []
        
        # [정밀 파싱] 모든 tr을 뒤지는게 아니라, mstView가 있는 것만 타겟팅
        # 성능 최적화를 위해 find_all 대신 반복문으로 검사
        for row in soup.find_all("tr"):
            item = parse_movie_row(row)
            if item: data.append(item)

        # 시간 추출
        time_match = re.search(r"(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})", soup.get_text())
        crawled_time = time_match.group(1) if time_match else datetime.now().strftime("%Y-%m-%d %H:%M")

        meta.update({
            "status": "ok",
            "crawledTime": crawled_time,
            "processTime": (datetime.now() - start_time).total_seconds()
        })
        
        return {"meta": meta, "data": data}
        
    except Exception as e:
        meta["error"] = str(e)
        return {"meta": meta, "data": []}

@app.get("/api/reservation")
def reservation(movieName: str = Query(...), movieCd: str = Query(None)):
    resp = fetch_kobis_robust()
    if not resp: return {"found": False}
    
    soup = BeautifulSoup(resp.text, 'html.parser')
    target_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
    
    for row in soup.find_all("tr"):
        item = parse_movie_row(row)
        if not item: continue
        
        row_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', item['title']).lower()
        
        # ID 매칭 우선, 그 다음 이름 매칭
        if (movieCd and item['movieCd'] == movieCd) or (target_norm in row_norm):
            return {"found": True, "data": item, "crawledTime": datetime.now().strftime("%H:%M")}
            
    return {"found": False}

# [API] 네이버 뉴스 & 포스터 (기존 유지)
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
