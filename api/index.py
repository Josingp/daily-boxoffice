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

# API 키 및 URL 설정
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")

KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def normalize_string(s: str) -> str:
    """
    문자열 정규화: 공백 제거 및 소문자 변환
    예: '만약에 우리' -> '만약에우리'
    """
    if not s: return ""
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# -----------------------------------------------------------------------------
# 1. [상세 화면용] 실시간 예매율 개별 검색 (수정됨: 인코딩 문제 해결)
# -----------------------------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = KOBIS_REALTIME_URL
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        data = {'dmlMode': 'search'} 
        
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        
        # [핵심 수정] 한글 깨짐 방지를 위해 인코딩 강제 설정
        resp.encoding = 'utf-8'
        
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"HTTP {resp.status_code}"}

        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr")
        
        if not rows:
             return {"found": False, "debug_error": "HTML 테이블(tr)을 찾을 수 없습니다."}

        target_norm = normalize_string(movieName)
        crawled_list = [] 

        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            # 제목 추출
            a_tag = cols[1].find("a")
            if a_tag and a_tag.get("title"):
                title_text = a_tag["title"].strip()
            else:
                title_text = cols[1].get_text(strip=True)
            
            # 디버깅용 리스트에 추가 (상위 15개)
            if len(crawled_list) < 15:
                crawled_list.append(title_text)
            
            # 비교 로직 (정규화 후 비교)
            if normalize_string(title_text) == target_norm:
                return {
                    "found": True,
                    "data": {
                        "rank": cols[0].get_text(strip=True),
                        "title": title_text,
                        "rate": cols[3].get_text(strip=True),
                        "salesAmt": cols[4].get_text(strip=True),
                        "salesAcc": cols[5].get_text(strip=True),
                        "audiCnt": cols[6].get_text(strip=True),
                        "audiAcc": cols[7].get_text(strip=True)
                    }
                }
        
        # 못 찾았을 경우 읽은 목록 반환 (디버깅용)
        log_msg = ", ".join(crawled_list) 
        return {
            "found": False, 
            "debug_error": f"'{movieName}' 미발견.\n[읽은 목록(상위15)]: {log_msg}..."
        }
        
    except Exception as e:
        return {"found": False, "debug_error": f"Server Error: {str(e)}"}

# -----------------------------------------------------------------------------
# 2. [전체 목록용] 박스오피스 + 실시간 예매율 결합 (수정됨: 인코딩 문제 해결)
# -----------------------------------------------------------------------------
@app.get("/api/composite")
def get_composite_boxoffice():
    yesterday_obj = datetime.now() - timedelta(days=1)
    yesterday = yesterday_obj.strftime("%Y%m%d")
    
    boxoffice_data = []
    realtime_map = {}

    # (1) KOBIS API
    try:
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}"
        res = requests.get(url, timeout=5)
        data = res.json()
        if "boxOfficeResult" in data and "dailyBoxOfficeList" in data["boxOfficeResult"]:
            boxoffice_data = data["boxOfficeResult"]["dailyBoxOfficeList"]
    except Exception as e:
        print(f"KOBIS API Error: {str(e)}")

    # (2) 크롤링
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        data = {'dmlMode': 'search'}
        resp = requests.post(KOBIS_REALTIME_URL, headers=headers, data=data, timeout=10)
        
        # [핵심 수정] 인코딩 강제 설정
        resp.encoding = 'utf-8'

        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            rows = soup.find_all("tr")
            for row in rows:
                cols = row.find_all("td")
                if len(cols) < 8: continue
                
                a_tag = cols[1].find("a")
                if a_tag and a_tag.get("title"):
                    title_text = a_tag["title"].strip()
                else:
                    title_text = cols[1].get_text(strip=True)
                
                norm_title = normalize_string(title_text)
                
                realtime_map[norm_title] = {
                    "rank": cols[0].get_text(strip=True),
                    "rate": cols[3].get_text(strip=True),
                    "salesAmt": cols[4].get_text(strip=True),
                    "audiCnt": cols[6].get_text(strip=True)
                }
    except Exception:
        pass 

    # (3) 데이터 병합
    merged_list = []
    for movie in boxoffice_data:
        norm_title = normalize_string(movie['movieNm'])
        match = realtime_map.get(norm_title)
        
        item = movie.copy()
        item["realtime"] = match if match else None
        merged_list.append(item)

    return {"status": "ok", "targetDt": yesterday, "data": merged_list}

# -----------------------------------------------------------------------------
# 3. KOBIS API Proxies (유지)
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
                if 'boxOfficeResult' in res and 'dailyBoxOfficeList' in res['boxOfficeResult']:
                    daily_list = res['boxOfficeResult']['dailyBoxOfficeList']
                    movie = next((m for m in daily_list if m['movieCd'] == movieCd), None)
                    if movie:
                        return {
                            "date": dt, 
                            "dateDisplay": f"{dt[4:6]}/{dt[6:8]}",
                            "audiCnt": int(movie['audiCnt']), 
                            "scrnCnt": int(movie['scrnCnt'])
                        }
            except Exception:
                pass
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0, "scrnCnt": 0}

        with ThreadPoolExecutor(max_workers=10) as ex:
            results = list(ex.map(fetch, dates))
            return [r for r in results if r is not None]
    except Exception as e:
        print(f"Trend Error: {e}")
        return []
