import os
import requests
import re
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"]
)

KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")

KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

@app.get("/api/news")
def get_news(keyword: str = ""):
    if not keyword: return {"items": []}
    
    # 1. 네이버 API 사용
    if NAVER_CLIENT_ID and NAVER_CLIENT_SECRET:
        try:
            url = "https://openapi.naver.com/v1/search/news.json"
            headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
            res = requests.get(url, headers=headers, params={"query": keyword, "display": 5, "sort": "sim"}, timeout=5)
            if res.status_code == 200:
                return {"items": [{
                    "title": re.sub('<[^<]+?>', '', i['title']),
                    "link": i['originallink'] or i['link'],
                    "desc": re.sub('<[^<]+?>', '', i['description']),
                    "press": i.get('pubDate', '')[:16]
                } for i in res.json().get('items', [])]}
        except: pass

    # 2. 크롤링 Fallback
    try:
        url = f"https://search.naver.com/search.naver?where=news&query={quote(keyword)}"
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        items = []
        for news in soup.select("div.news_wrap")[:5]:
            t = news.select_one("a.news_tit")
            d = news.select_one("div.news_dsc")
            if t: items.append({"title": t.get_text(), "link": t['href'], "desc": d.get_text() if d else "", "press": "네이버뉴스"})
        return {"items": items}
    except: return {"items": []}

@app.get("/api/poster")
def get_poster(movieName: str = ""):
    if not movieName: return {"url": ""}
    
    # 1. 네이버 이미지 검색 API (정확도 높음)
    if NAVER_CLIENT_ID and NAVER_CLIENT_SECRET:
        try:
            url = "https://openapi.naver.com/v1/search/image.json"
            headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
            # '영화 포스터' 키워드 추가
            res = requests.get(url, headers=headers, params={"query": movieName + " 영화 포스터", "display": 1, "sort": "sim"}, timeout=5)
            if res.status_code == 200:
                items = res.json().get('items', [])
                if items: return {"url": items[0]['link']}
        except: pass

    # 2. 다음 검색 크롤링 (Fallback)
    try:
        url = f"https://search.daum.net/search?w=img&q={quote(movieName + ' 포스터')}"
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        match = re.search(r'data-original-src="(http[^"]+)"', res.text)
        if match: return {"url": match.group(1).replace("&amp;", "&")}
    except: pass
    
    return {"url": ""}

@app.get("/kobis/daily")
def get_daily_boxoffice(targetDt: str = Query(...)):
    if not KOBIS_API_KEY: return {"error": "Key Missing", "movies": []}
    try:
        res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}", timeout=5)
        data = res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        final = []
        def fetch(m):
            try:
                r = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={m['movieCd']}", timeout=2)
                m['detail'] = r.json().get("movieInfoResult", {}).get("movieInfo", {})
            except: m['detail'] = {}
            return m
        
        with ThreadPoolExecutor(max_workers=5) as ex:
            final = list(ex.map(fetch, data))
        return {"movies": sorted(final, key=lambda x: int(x['rank']))}
    except Exception as e: return {"error": str(e), "movies": []}

@app.get("/kobis/detail")
def get_movie_detail(movieCd: str = Query(...)):
    try:
        r = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}", timeout=5)
        return r.json()
    except: return {}

@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    today = datetime.now()
    yesterday = today - timedelta(days=1)
    start = today - timedelta(days=30)
    
    dates = []
    curr = start
    while curr <= yesterday:
        dates.append(curr.strftime("%Y%m%d"))
        curr += timedelta(days=1)
        
    results = []
    def fetch(d):
        try:
            r = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={d}", timeout=3).json()
            found = next((m for m in r.get('boxOfficeResult',{}).get('dailyBoxOfficeList',[]) if m['movieCd'] == movieCd), None)
            if found:
                return {
                    "date": d, "dateDisplay": f"{d[4:6]}/{d[6:8]}",
                    "audiCnt": int(found['audiCnt']), "salesAmt": int(found['salesAmt']),
                    "scrnCnt": int(found['scrnCnt']), "showCnt": int(found['showCnt'])
                }
        except: pass
    
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch, dates))
    return sorted([r for r in results if r], key=lambda x: x['date'])

@app.get("/api/realtime")
def get_realtime(): return {"status": "ok", "data": []}

@app.get("/api/reservation")
def get_reservation(movieName: str = Query(...)):
    try:
        res = requests.get(KOBIS_REALTIME_URL, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        crawled_time = ""
        try:
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", soup.get_text())
            if match: crawled_time = match.group(1).replace("/", "-")
        except: pass
        if not crawled_time: crawled_time = datetime.now().strftime("%Y-%m-%d %H:%M")

        q = re.sub(r'\s+', '', movieName).lower()
        rows = soup.find_all("tr")
        
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            title = cols[1].get_text(strip=True)
            norm_title = re.sub(r'\s+', '', title).lower()
            
            if q in norm_title or norm_title in q:
                return {
                    "found": True, 
                    "data": {
                        "rank": cols[0].get_text(strip=True),
                        "rate": cols[3].get_text(strip=True),
                        "audiCnt": cols[6].get_text(strip=True),
                        "salesAmt": cols[4].get_text(strip=True),
                        "audiAcc": cols[7].get_text(strip=True),
                        "salesAcc": cols[5].get_text(strip=True),
                        "crawledTime": crawled_time
                    },
                    "crawledTime": crawled_time
                }
        return {"found": False}
    except: return {"found": False}
