import os
import requests
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
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

KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# ---------------------------------------------------------
# [1] 일별 박스오피스 (안전장치 포함)
# ---------------------------------------------------------
@app.get("/kobis/daily")
def get_daily_boxoffice(targetDt: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"error": "API Key Missing", "movies": []}

    try:
        # 타임아웃 3초 설정 (Vercel 10초 제한 방어)
        res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}", timeout=3)
        data = res.json()
        daily_list = data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        if not daily_list: return {"movies": []}

        final_movies = []

        def fetch_detail(movie):
            try:
                # 상세정보도 2초 안에 안오면 포기 (전체 응답 속도 우선)
                r = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie['movieCd']}", timeout=2)
                movie['detail'] = r.json().get("movieInfoResult", {}).get("movieInfo", {})
            except:
                movie['detail'] = {}
            return movie

        # 병렬 처리로 속도 향상
        with ThreadPoolExecutor(max_workers=10) as ex:
            final_movies = list(ex.map(fetch_detail, daily_list))
        
        final_movies.sort(key=lambda x: int(x['rank']))
        return {"movies": final_movies}

    except Exception as e:
        return {"error": str(e), "movies": []}

# ---------------------------------------------------------
# [2] 트렌드 데이터 (최적화: 60일 -> 30일)
# ---------------------------------------------------------
@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    
    today = datetime.now()
    yesterday = (today - timedelta(days=1))
    
    # [중요] Vercel 타임아웃 방지를 위해 조회 기간을 30일로 단축
    start_date = today - timedelta(days=30)
        
    date_list = []
    curr = start_date
    while curr <= yesterday:
        date_list.append(curr.strftime("%Y%m%d"))
        curr += timedelta(days=1)
        
    results = []
    def fetch_daily_for_trend(d):
        try:
            # 타임아웃 1초로 매우 짧게 설정 (하나라도 늦으면 건너뜀)
            url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={d}"
            r = requests.get(url, timeout=1).json()
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

    # 병렬 처리
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch_daily_for_trend, date_list))
        
    clean = [r for r in results if r]
    clean.sort(key=lambda x: x['date'])
    return clean

# ---------------------------------------------------------
# [3] 기타 API (상세, 실시간, 뉴스 등)
# ---------------------------------------------------------
@app.get("/kobis/detail")
def get_movie_detail(movieCd: str = Query(...)):
    try:
        res = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}", timeout=3)
        return res.json()
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/realtime")
def get_realtime_ranking():
    # 실시간 크롤링 로직 (타임아웃 5초)
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = requests.get(KOBIS_REALTIME_URL, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        # ... (간소화된 파싱 로직)
        # 실제 데이터가 필요하면 크롤링 코드를 여기에 넣되, 
        # 타임아웃에 걸릴 확률이 높으므로 빈 배열 반환 후 JSON 파일 유도 추천
        return {"status": "ok", "data": [], "crawledTime": ""}
    except:
        return {"status": "error", "data": []}

@app.get("/api/reservation")
def get_reservation(movieName: str = Query(...)):
    return {"found": False}

@app.get("/api/news")
def get_news(keyword: str = ""):
    return {"items": []}

@app.get("/api/poster")
def get_poster(movieName: str = ""):
    return {"url": ""}
