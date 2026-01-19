import os
import requests
import re
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
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
    allow_headers=["*"],
)

# API 키 및 URL
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")

KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# [핵심] HTML의 onclick="mstView('movie','20249255');" 에서 코드를 추출하는 정규식
MOVIE_CD_REGEX = re.compile(r"mstView\('movie','([0-9]+)'\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

def extract_movie_data(row):
    """HTML 행(tr)에서 movieCd와 데이터를 안전하게 추출하는 헬퍼 함수"""
    cols = row.find_all("td")
    if len(cols) < 8: return None

    # 1. 영화 코드(movieCd) 추출 (가장 중요)
    movie_cd = None
    a_tag = cols[1].find("a")
    if a_tag and a_tag.has_attr("onclick"):
        match = MOVIE_CD_REGEX.search(a_tag["onclick"])
        if match:
            movie_cd = match.group(1)
    
    # 2. 제목 추출
    title_text = a_tag["title"].strip() if (a_tag and a_tag.get("title")) else cols[1].get_text(strip=True)

    # 3. 데이터 정제 (쉼표 제거 및 숫자 변환)
    def clean_num(s):
        return s.replace(',', '').strip()

    return {
        "movieCd": movie_cd,  # 매칭의 핵심 키
        "rank": cols[0].get_text(strip=True),
        "title": title_text,
        "rate": cols[3].get_text(strip=True),
        "salesAmt": clean_num(cols[4].get_text(strip=True)),
        "salesAcc": clean_num(cols[5].get_text(strip=True)),
        "audiCnt": clean_num(cols[6].get_text(strip=True)),
        "audiAcc": clean_num(cols[7].get_text(strip=True))
    }

# -----------------------------------------------------------------------------
# 1. [상세 화면용] 실시간 예매율 (ID 기반 정확한 매칭)
# -----------------------------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(
    movieName: str = Query(..., description="Movie Name (backup)"),
    movieCd: str = Query(None, description="Movie Code (primary key)")
):
    """
    movieCd가 있으면 그것으로 매칭(100% 정확),
    없으면 movieName으로 백업 매칭 시도
    """
    try:
        # 크롤링 요청
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        resp = requests.post(KOBIS_REALTIME_URL, headers=headers, data={'dmlMode': 'search'}, timeout=10)
        resp.encoding = 'utf-8' # 안전장치

        if resp.status_code != 200:
            return {"found": False, "debug_error": f"HTTP {resp.status_code}"}

        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr")
        
        debug_list = []

        for row in rows:
            data = extract_movie_data(row)
            if not data: continue

            # 디버깅용 로그 저장
            if len(debug_list) < 10:
                debug_list.append(f"{data['title']}({data['movieCd']})")

            # [Case 1] movieCd로 정확히 매칭 (권장)
            if movieCd and data['movieCd'] == movieCd:
                return {"found": True, "method": "ID_MATCH", "data": data}
            
            # [Case 2] 이름으로 백업 매칭 (movieCd가 없을 때만)
            # 이름 정규화: 공백/특수문자 제거 후 비교
            norm_target = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
            norm_title = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            
            if not movieCd and (norm_target in norm_title or norm_title in norm_target):
                return {"found": True, "method": "NAME_MATCH", "data": data}

        return {
            "found": False, 
            "debug_error": f"ID('{movieCd}') 또는 이름('{movieName}') 미발견.\n[상위 목록]: {', '.join(debug_list)}..."
        }

    except Exception as e:
        return {"found": False, "debug_error": f"Server Error: {str(e)}"}

# -----------------------------------------------------------------------------
# 2. [전체 목록용] 박스오피스 + 실시간 예매율 결합 (ID 매칭 적용)
# -----------------------------------------------------------------------------
@app.get("/api/composite")
def get_composite_boxoffice():
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
    
    boxoffice_data = []
    realtime_map = {} # Key: movieCd, Value: Data

    # (1) API Fetch
    try:
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}"
        res = requests.get(url, timeout=5).json()
        boxoffice_data = res.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except Exception as e:
        print(f"API Error: {e}")

    # (2) Crawling & Parsing (Map 생성)
    try:
        headers = {'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded'}
        resp = requests.post(KOBIS_REALTIME_URL, headers=headers, data={'dmlMode': 'search'}, timeout=10)
        resp.encoding = 'utf-8'
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr")

        for row in rows:
            data = extract_movie_data(row)
            if data and data['movieCd']:
                # movieCd를 Key로 사용하여 맵에 저장 -> O(1) 검색
                realtime_map[data['movieCd']] = data
                
    except Exception as e:
        print(f"Crawling Error: {e}")

    # (3) Merge (ID 기준 조인)
    merged_list = []
    for movie in boxoffice_data:
        target_cd = movie['movieCd']
        
        # 맵에서 ID로 즉시 찾기 (정확도 100%)
        match = realtime_map.get(target_cd)
        
        item = movie.copy()
        item["realtime"] = match
        merged_list.append(item)

    return {"status": "ok", "targetDt": yesterday, "data": merged_list}

# -----------------------------------------------------------------------------
# 3. Proxy Functions (유지)
# -----------------------------------------------------------------------------
@app.get("/kobis/daily")
def get_daily(targetDt: str):
    return requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}").json()

@app.get("/kobis/weekly")
def get_weekly(targetDt: str, weekGb: str = "1"):
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
                daily_list = res.get('boxOfficeResult', {}).get('dailyBoxOfficeList', [])
                movie = next((m for m in daily_list if m['movieCd'] == movieCd), None)
                if movie:
                    return {
                        "date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}",
                        "audiCnt": int(movie['audiCnt']), "scrnCnt": int(movie['scrnCnt'])
                    }
            except: pass
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0, "scrnCnt": 0}

        with ThreadPoolExecutor(max_workers=10) as ex:
            results = list(ex.map(fetch, dates))
            return [r for r in results if r is not None]
    except: return []
