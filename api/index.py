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
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# [기능 1] 뉴스 검색
@app.get("/api/news")
def get_news(keyword: str = ""):
    if not keyword: return {"items": []}
    try:
        url = f"https://search.naver.com/search.naver?where=news&query={quote(keyword)}"
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        items = []
        for news in soup.select("div.news_wrap")[:5]:
            title = news.select_one("a.news_tit")
            desc = news.select_one("div.news_dsc")
            press = news.select_one("a.info.press")
            if title:
                items.append({
                    "title": title.get_text(),
                    "link": title['href'],
                    "desc": desc.get_text() if desc else "",
                    "press": press.get_text() if press else "언론사"
                })
        return {"items": items}
    except: return {"items": []}

# [기능 2] 포스터 검색
@app.get("/api/poster")
def get_poster(movieName: str = ""):
    if not movieName: return {"url": ""}
    try:
        url = f"https://search.daum.net/search?w=img&q={quote(movieName + ' 포스터')}"
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        match = re.search(r'data-original-src="(http[^"]+)"', res.text)
        if match: return {"url": match.group(1).replace("&amp;", "&")}
        return {"url": ""}
    except: return {"url": ""}

# [기능 3] 일별 박스오피스 Fallback
@app.get("/kobis/daily")
def get_daily_boxoffice(targetDt: str = Query(...)):
    if not KOBIS_API_KEY: return {"error": "API Key Missing", "movies": []}
    try:
        res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}", timeout=5)
        daily_list = res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        final_movies = []
        def fetch_detail(movie):
            try:
                r = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie['movieCd']}", timeout=2)
                movie['detail'] = r.json().get("movieInfoResult", {}).get("movieInfo", {})
            except: movie['detail'] = {}
            return movie

        with ThreadPoolExecutor(max_workers=5) as ex:
            final_movies = list(ex.map(fetch_detail, daily_list))
        
        final_movies.sort(key=lambda x: int(x['rank']))
        return {"movies": final_movies}
    except Exception as e: return {"error": str(e), "movies": []}

# [기능 4] 상세정보 API
@app.get("/kobis/detail")
def get_movie_detail(movieCd: str = Query(...)):
    try:
        res = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}", timeout=5)
        return res.json()
    except: return {}

# [기능 5] 트렌드 API
@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    today = datetime.now()
    yesterday = today - timedelta(days=1)
    
    start_date = today - timedelta(days=30)
    if openDt:
        try: start_date = datetime.strptime(openDt.replace("-",""), "%Y%m%d")
        except: pass
    if (yesterday - start_date).days > 60: start_date = yesterday - timedelta(days=60)
    
    date_list = []
    curr = start_date
    while curr <= yesterday:
        date_list.append(curr.strftime("%Y%m%d"))
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
        results = list(ex.map(fetch, date_list))
    return sorted([r for r in results if r], key=lambda x: x['date'])

# [기능 6] 예매율 API (Fallback)
@app.get("/api/realtime")
def get_realtime(): return {"status": "ok", "data": []}

@app.get("/api/reservation")
def get_reservation(movieName: str = Query(...)):
    # 2단계: 크롤링 (시간 파싱 포함)
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = requests.get(KOBIS_REALTIME_URL, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        crawled_time = ""
        try:
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", soup.get_text())
            if match: crawled_time = match.group(1).replace("/", "-")
        except: pass
        if not crawled_time: crawled_time = datetime.now().strftime("%Y-%m-%d %H:%M")

        norm_query = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
        rows = soup.find_all("tr")
        
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            norm_title = re.sub(r'[^0-9a-zA-Z가-힣]', '', title).lower()
            
            if norm_query in norm_title or norm_title in norm_query:
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
