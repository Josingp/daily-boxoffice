import os
import requests
import re
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

# KOBIS API Key
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")

# URL 상수
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
# [크롤링 타겟]
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def normalize_string(s: str) -> str:
    # 비교를 위해: 특수문자/공백 제거 + 소문자 변환
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# ---------------------------------------------------------------------------
# [핵심] 실시간 예매율 크롤러
# 설명: KOBIS 웹페이지에 POST 요청을 보내고, HTML 표(Table)를 해석합니다.
# ---------------------------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = KOBIS_REALTIME_URL
    try:
        # 1. 브라우저 위장 헤더 (차단 방지)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        # 검색 모드로 요청해야 표가 나옵니다.
        data = {'dmlMode': 'search'} 
        
        # 2. 요청 전송
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        resp.encoding = 'utf-8' # 한글 깨짐 방지 강제 설정
        
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"서버 접속 실패 (HTTP {resp.status_code})"}

        # 3. HTML 파싱 (BeautifulSoup)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 4. 데이터 행(tr) 찾기
        rows = soup.select("tbody tr")
        
        # 행이 하나도 없으면 HTML 구조가 바뀐 것
        if not rows:
             return {"found": False, "debug_error": "HTML 표를 찾지 못했습니다. (tbody tr 없음)"}

        target_norm = normalize_string(movieName)
        crawled_list = [] # 디버깅용: 읽어온 영화 제목들

        for row in rows:
            # 각 칸(td) 가져오기
            cols = row.find_all("td")
            
            # 칸 개수 확인 (사용자 HTML 기준 8개 이상이어야 함)
            if len(cols) < 8: continue
            
            # [제목 추출 로직 강화]
            # 1순위: a 태그의 title 속성 (전체 제목이 들어있음)
            # 2순위: 텍스트 (길면 잘릴 수 있음)
            a_tag = cols[1].find("a")
            if a_tag and a_tag.get("title"):
                title_text = a_tag["title"].strip()
            else:
                title_text = cols[1].get_text(strip=True)
                
            rank_text = cols[0].get_text(strip=True)
            crawled_list.append(f"[{rank_text}위] {title_text}") # 로그에 저장
            
            # 5. 제목 비교 (정규화 후)
            if normalize_string(title_text) == target_norm:
                # 찾았다! 데이터 매핑 (사용자 HTML 소스 기준)
                return {
                    "found": True,
                    "data": {
                        "rank": rank_text,                          # 순위
                        "title": title_text,                        # 제목
                        "rate": cols[3].get_text(strip=True),       # 예매율 (16.1%)
                        "salesAmt": cols[4].get_text(strip=True),   # 예매 매출액
                        "salesAcc": cols[5].get_text(strip=True),   # 누적 매출액
                        "audiCnt": cols[6].get_text(strip=True),    # 예매 관객수
                        "audiAcc": cols[7].get_text(strip=True)     # 누적 관객수
                    }
                }
        
        # 6. 목록을 다 뒤져도 없을 때 -> 디버깅 로그 반환
        log_msg = ", ".join(crawled_list[:20]) # 상위 20개 제목 보여줌
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
