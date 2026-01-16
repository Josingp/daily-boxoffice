import os
import requests
import re
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any, Optional
# [변경] PDF에 나온 방식대로 BeautifulSoup 사용
from bs4 import BeautifulSoup 

from fastapi import FastAPI, HTTPException, Query
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

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# --- [BeautifulSoup 적용] 실시간 예매율 크롤러 ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
    try:
        # 1. 사이트 접속 (요청)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        data = {'dmlMode': 'search'} 
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"KOBIS 접속 실패 ({resp.status_code})"}

        # 2. PDF 방식: HTML 파싱 (BeautifulSoup 사용)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 3. 데이터 찾기 (테이블의 각 행 'tr'을 모두 찾음)
        # KOBIS 테이블 구조: <tbody id="tbody_0"> 안에 <tr>들이 있음
        rows = soup.select("tbody tr")
        
        if not rows:
             return {"found": False, "debug_error": "테이블 데이터를 찾을 수 없습니다."}

        # 검색어 정규화 (공백/특수문자 제거 후 소문자)
        target_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
        seen_titles = []

        for row in rows:
            # 각 행의 칸(td)들을 다 가져옴
            cols = row.find_all("td")
            
            # 유효한 데이터 행인지 확인 (컬럼이 8개여야 함)
            if len(cols) < 8: continue
            
            # [1]번째 칸: 영화 제목 (a 태그 안의 텍스트 또는 그냥 텍스트)
            title_text = cols[1].get_text(strip=True)
            seen_titles.append(title_text)
            
            # 제목 비교
            current_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', title_text).lower()
            
            if current_norm == target_norm:
                # 찾았다! 데이터 추출
                return {
                    "found": True,
                    "data": {
                        "rank": cols[0].get_text(strip=True),       # 순위
                        "title": title_text,                        # 제목
                        "rate": cols[3].get_text(strip=True),       # 예매율
                        "salesAmt": cols[4].get_text(strip=True),   # 예매매출액
                        "salesAcc": cols[5].get_text(strip=True),   # 누적매출액
                        "audiCnt": cols[6].get_text(strip=True),    # 예매관객수
                        "audiAcc": cols[7].get_text(strip=True)     # 누적관객수
                    }
                }
        
        # 못 찾았을 때
        return {
            "found": False, 
            "debug_error": f"'{movieName}' 없음. (검색된 목록: {', '.join(seen_titles[:5])}...)"
        }
        
    except Exception as e:
        return {"found": False, "debug_error": f"서버 오류: {str(e)}"}

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
