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

# 차단 방지 헤더
COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

@app.get("/")
def root(): return {"status": "ok"}

@app.get("/api/news")
def news(keyword: str = Query(...)):
    if not NAVER_ID or not NAVER_SECRET: return {"status":"error", "message":"Keys Missing"}
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
    except Exception as e: return {"status":"error", "message":str(e)}

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
    except: return {"status":"error", "url": ""}

@app.get("/api/realtime")
def realtime():
    try:
        url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
        # 헤더 추가 필수
        headers = {
            **COMMON_HEADERS,
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        res = requests.post(url, headers=headers, data={'dmlMode':'search','allMovieYn':'Y'}, timeout=10)
        soup = BeautifulSoup(res.text, 'html.parser')
        data = []
        for r in soup.find_all("tr"):
            c = r.find_all("td")
            if len(c)<8: continue
            t = c[1].find("a")["title"].strip() if c[1].find("a") else c[1].get_text(strip=True)
            data.append({
                "rank": c[0].get_text(strip=True), "title": t, "rate": c[3].get_text(strip=True),
                "audiCnt": c[6].get_text(strip=True).replace(',',''), "audiAcc": c[7].get_text(strip=True).replace(',','')
            })
        return {"status":"ok", "data":data, "crawledTime": datetime.now().strftime("%Y-%m-%d %H:%M")}
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
