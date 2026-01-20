import os
import requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
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

# ---------------------------------------------------------
# 1. 일별 박스오피스 Fallback API (JSON 파일 없을 때 호출됨)
# ---------------------------------------------------------
@app.get("/kobis/daily")
def get_daily_boxoffice(targetDt: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"error": "API Key Missing", "movies": []}

    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    detail_url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    
    try:
        # 1. 박스오피스 리스트 가져오기
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={targetDt}", timeout=5)
        data = res.json()
        daily_list = data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        if not daily_list:
            return {"movies": []}

        final_movies = []

        # 2. 영화 상세정보 병렬 호출 (포스터, 감독 등 필요)
        def fetch_detail(movie):
            try:
                r = requests.get(f"{detail_url}?key={KOBIS_API_KEY}&movieCd={movie['movieCd']}", timeout=3)
                detail = r.json().get("movieInfoResult", {}).get("movieInfo", {})
                movie['detail'] = detail
            except:
                movie['detail'] = {}
            return movie

        # 속도를 위해 병렬 처리
        with ThreadPoolExecutor(max_workers=5) as ex:
            final_movies = list(ex.map(fetch_detail, daily_list))
        
        # 순위대로 정렬
        final_movies.sort(key=lambda x: int(x['rank']))

        return {"movies": final_movies}

    except Exception as e:
        return {"error": str(e), "movies": []}

# ---------------------------------------------------------
# 2. 영화 상세정보 API
# ---------------------------------------------------------
@app.get("/kobis/detail")
def get_movie_detail(movieCd: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"movieInfoResult": {"movieInfo": {}}}
    
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movieCd}", timeout=5)
        return res.json()
    except Exception as e:
        return {"error": str(e)}

# ---------------------------------------------------------
# 3. [기존 유지] 특정 영화 과거 흥행 추이 (그래프용)
# ---------------------------------------------------------
@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    
    # 오늘 기준
    today = datetime.now()
    yesterday = (today - timedelta(days=1))
    
    # 개봉일이 없으면 30일 전부터, 있으면 개봉일부터
    if openDt:
        try:
            start_date = datetime.strptime(openDt.replace("-",""), "%Y%m%d")
        except:
            start_date = today - timedelta(days=30)
    else:
        start_date = today - timedelta(days=30)
        
    # 최대 60일치만 가져오도록 제한 (API 속도 문제)
    if (yesterday - start_date).days > 60:
        start_date = yesterday - timedelta(days=60)
        
    date_list = []
    curr = start_date
    while curr <= yesterday:
        date_list.append(curr.strftime("%Y%m%d"))
        curr += timedelta(days=1)
        
    # 병렬 호출
    results = []
    def fetch_daily_for_trend(d):
        try:
            url = f"https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?key={KOBIS_API_KEY}&targetDt={d}"
            r = requests.get(url, timeout=3).json()
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

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch_daily_for_trend, date_list))
        
    return [r for r in results if r]

# ---------------------------------------------------------
# 4. 기타 API (Realtime, News, Poster 등)
# Vercel 환경에서 404가 뜨지 않도록 기본 응답 처리
# ---------------------------------------------------------
@app.get("/api/realtime")
def realtime_fallback():
    return {"status": "ok", "data": [], "crawledTime": ""}

@app.get("/api/news")
def news_fallback(keyword: str = ""):
    return {"items": []}

@app.get("/api/poster")
def poster_fallback(movieName: str = ""):
    return {"url": ""}

@app.get("/api/reservation")
def reservation_fallback(movieName: str = ""):
    return {"found": False}
