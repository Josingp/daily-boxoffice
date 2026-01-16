import os
import requests
import re
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
# [필수] HTML 구조 해석 라이브러리
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

# [설정] KOBIS 공식 API 키 (일별 박스오피스용)
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")

# [설정] URL 목록
# 1. 공식 API (일별 데이터용)
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

# 2. 크롤링 타겟 URL (실시간 예매율 HTML 페이지)
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def normalize_string(s: str) -> str:
    # 영화 제목 비교를 위해 특수문자/공백 제거
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# ---------------------------------------------------------
# [핵심] 실시간 예매율 크롤러 (HTML 파싱 방식)
# 사용자님이 주신 HTML 구조(tr > td)를 해석해서 데이터를 가져옵니다.
# ---------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = KOBIS_REALTIME_URL
    try:
        # 1. KOBIS 서버에 HTML 페이지 요청 (브라우저인 척 속임)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        data = {'dmlMode': 'search'} 
        
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"접속 실패 (HTTP {resp.status_code})"}

        # 2. HTML 해석 (BeautifulSoup 사용)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 3. 테이블의 모든 행(tr) 가져오기
        rows = soup.select("tbody tr")
        
        if not rows:
             return {"found": False, "debug_error": "테이블(tbody)을 찾을 수 없습니다."}

        target_norm = normalize_string(movieName)
        crawled_log = [] # 디버깅용 로그

        for row in rows:
            # 한 행(tr) 안에 있는 모든 칸(td)을 리스트로 가져옴
            cols = row.find_all("td")
            
            # 칸이 8개 미만이면 우리가 찾는 데이터 행이 아님 (빈 줄 등)
            if len(cols) < 8: continue
            
            # [1]번 칸: 영화 제목 (HTML 태그 제거하고 글자만 추출)
            title_text = cols[1].get_text(strip=True)
            rank_text = cols[0].get_text(strip=True)
            
            crawled_log.append(f"[{rank_text}위] {title_text}")
            
            # 4. 영화 제목 비교 (우리가 찾는 영화인가?)
            if normalize_string(title_text) == target_norm:
                # 찾았다! HTML 구조에 맞춰 데이터 추출
                return {
                    "found": True,
                    "data": {
                        "rank": rank_text,                          # td[0]: 순위
                        "title": title_text,                        # td[1]: 제목
                        "rate": cols[3].get_text(strip=True),       # td[3]: 예매율 (16.1%)
                        "salesAmt": cols[4].get_text(strip=True),   # td[4]: 예매 매출액
                        "salesAcc": cols[5].get_text(strip=True),   # td[5]: 누적 매출액
                        "audiCnt": cols[6].get_text(strip=True),    # td[6]: 예매 관객수
                        "audiAcc": cols[7].get_text(strip=True)     # td[7]: 누적 관객수
                    }
                }
        
        # 5. 끝까지 뒤져도 없을 때 (디버깅용 로그 반환)
        log_msg = ", ".join(crawled_log[:10]) 
        return {
            "found": False, 
            "debug_error": f"'{movieName}'을 목록에서 찾을 수 없습니다.\n[읽어온 영화들]: {log_msg}..."
        }
        
    except Exception as e:
        return {"found": False, "debug_error": f"서버 오류: {str(e)}"}

# --- KOBIS 공식 API 프록시 (일별/주간 데이터용) ---
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
