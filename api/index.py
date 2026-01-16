import os
import requests
import re
import html
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
# [필수] requirements.txt에 beautifulsoup4 추가 필요
from bs4 import BeautifulSoup 

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")

# URL 상수
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

def normalize_string(s: str) -> str:
    # 비교를 위해 특수문자/공백 제거 및 소문자화
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# --- [로그 강화] 실시간 예매율 크롤러 ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
    try:
        # 1. 요청 헤더 (브라우저인 척 속이기)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        data = {'dmlMode': 'search'} 
        
        # 2. 사이트 접속
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"KOBIS 접속 실패 (HTTP {resp.status_code})"}

        # 3. HTML 파싱
        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.select("tbody tr")
        
        if not rows:
             return {"found": False, "debug_error": "테이블 데이터(tbody tr)를 찾지 못했습니다. HTML 구조가 변경되었을 수 있습니다."}

        target_norm = normalize_string(movieName)
        
        # [디버깅] 서버가 읽은 영화 제목들을 저장할 리스트
        crawled_log = [] 

        for row in rows:
            cols = row.find_all("td")
            
            # 데이터 행이 아니면(컬럼 부족) 스킵
            if len(cols) < 8: continue
            
            # 데이터 추출
            rank = cols[0].get_text(strip=True)
            title = cols[1].get_text(strip=True)
            
            # 로그에 추가 (화면에 보여줄 데이터)
            crawled_log.append(f"[{rank}위] {title}")
            
            # 제목 비교
            if normalize_string(title) == target_norm:
                return {
                    "found": True,
                    "data": {
                        "rank": rank,
                        "title": title,
                        "rate": cols[3].get_text(strip=True),       # 예매율
                        "salesAmt": cols[4].get_text(strip=True),   # 예매매출액
                        "salesAcc": cols[5].get_text(strip=True),   # 누적매출액
                        "audiCnt": cols[6].get_text(strip=True),    # 예매관객수
                        "audiAcc": cols[7].get_text(strip=True)     # 누적관객수
                    }
                }
        
        # 4. 못 찾았을 때: 읽어온 리스트를 보여줌
        log_msg = ", ".join(crawled_log[:15]) # 상위 15개만 보여줌
        return {
            "found": False, 
            "debug_error": f"'{movieName}' 못 찾음.\n\n[서버가 읽은 목록]\n{log_msg}..."
        }
        
    except Exception as e:
        return {"found": False, "debug_error": f"서버 내부 오류: {str(e)}"}

# --- KOBIS API 프록시 ---
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
                box_res = res.get('boxOfficeResult', {})
                daily_list = box_res.get('dailyBoxOfficeList', [])
                if not daily_list: return None
                
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
