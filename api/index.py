import os
import json
import requests
import re
import html
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
# [필수] HTML 파싱 라이브러리
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

# --- https://herba.kr/boncho/?m=view&t=dict&id=2948 ---
# 1. 공식 OpenAPI (JSON 반환)
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

# 2. 실시간 크롤링 타겟 (HTML 반환)
# 사용자님이 말씀하신 바로 그 주소입니다.
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"


def normalize_string(s: str) -> str:
    # 비교 정확도를 위해: 특수문자/공백 제거 + 소문자 변환
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# --- [핵심] 실시간 예매율 크롤러 (BeautifulSoup Ver.) ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    # 상단에 정의한 상수 사용
    url = KOBIS_REALTIME_URL
    
    try:
        # 1. 요청 보내기 (브라우저처럼 속이기)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        # [중요] 검색 모드로 요청해야 데이터가 나옵니다.
        data = {'dmlMode': 'search'} 
        
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"KOBIS 접속 실패 (HTTP {resp.status_code})"}

        # 2. HTML 파싱
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 3. 데이터 위치 찾기: <tbody> 안의 <tr>들
        rows = soup.select("tbody tr")
        
        if not rows:
             return {"found": False, "debug_error": "데이터 테이블(tbody)을 찾지 못했습니다. 구조가 변경되었을 수 있습니다."}

        target_norm = normalize_string(movieName)
        
        # [디버깅] 서버가 읽은 영화 제목들 기록
        crawled_log = [] 

        for row in rows:
            cols = row.find_all("td")
            
            # 칸 개수가 부족하면 데이터 행이 아님
            if len(cols) < 8: continue
            
            # [1]번 칸: 영화 제목
            title_text = cols[1].get_text(strip=True)
            rank_text = cols[0].get_text(strip=True)
            
            crawled_log.append(f"[{rank_text}위] {title_text}")
            
            # 4. 제목 비교
            if normalize_string(title_text) == target_norm:
                return {
                    "found": True,
                    "data": {
                        "rank": rank_text,                          # 순위
                        "title": title_text,                        # 제목
                        "rate": cols[3].get_text(strip=True),       # 예매율
                        "salesAmt": cols[4].get_text(strip=True),   # 예매매출액
                        "salesAcc": cols[5].get_text(strip=True),   # 누적매출액
                        "audiCnt": cols[6].get_text(strip=True),    # 예매관객수
                        "audiAcc": cols[7].get_text(strip=True)     # 누적관객수
                    }
                }
        
        # 5. 못 찾았을 때 디버깅 정보 반환
        log_msg = ", ".join(crawled_log[:10]) 
        return {
            "found": False, 
            "debug_error": f"'{movieName}' 미발견.\n[서버가 읽은 목록]: {log_msg}..."
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
                movie = next((m for m in res['boxOfficeResult']['dailyBoxOfficeList'] if m['movieCd'] == movieCd), None)
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
