import os
import requests
import re
from concurrent.futures import ThreadPoolExecutor
# [필수] requirements.txt에 beautifulsoup4 확인
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
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def normalize_string(s: str) -> str:
    # 띄어쓰기, 특수문자 다 빼고 소문자로 비교 (가장 강력한 비교)
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# --- [최종 수정] 실시간 예매율 크롤러 ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = KOBIS_REALTIME_URL
    try:
        # [차단 방지] 완벽한 브라우저 헤더 위장
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do',
            'Origin': 'https://www.kobis.or.kr',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
        data = {'dmlMode': 'search'} 
        
        # 1. 접속
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"HTTP {resp.status_code} Error"}

        # 2. 파싱
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 3. 데이터 행 찾기 (tbody 밑의 tr 뿐만 아니라, 모든 tr을 검색 후 필터링)
        # KOBIS HTML 구조상 <tr class="even"> 또는 <tr class=""> 형태임
        rows = soup.find_all("tr")
        
        target_norm = normalize_string(movieName)
        crawled_log = [] 

        for row in rows:
            cols = row.find_all("td")
            
            # 사용자 제공 HTML 기준: 칸이 8개여야 유효한 데이터
            if len(cols) < 8: continue
            
            # [제목 추출] 2번째 칸(index 1)
            # <a title="제목"> 형태가 있으면 그걸 쓰고, 없으면 텍스트만 씀
            a_tag = cols[1].find("a")
            if a_tag and a_tag.get("title"):
                title_text = a_tag["title"].strip()
            else:
                title_text = cols[1].get_text(strip=True)
            
            # 순위 추출
            rank_text = cols[0].get_text(strip=True)
            
            # 로그에 추가 (에러 시 확인용)
            if rank_text.isdigit(): # 순위가 숫자인 경우만 로그에 담음 (헤더 제외)
                crawled_log.append(f"[{rank_text}위] {title_text}")

            # 4. 비교
            if normalize_string(title_text) == target_norm:
                return {
                    "found": True,
                    "data": {
                        "rank": rank_text,                          
                        "title": title_text,                        
                        "rate": cols[3].get_text(strip=True),       # 예매율
                        "salesAmt": cols[4].get_text(strip=True),   # 예매매출
                        "salesAcc": cols[5].get_text(strip=True),   # 누적매출
                        "audiCnt": cols[6].get_text(strip=True),    # 예매관객
                        "audiAcc": cols[7].get_text(strip=True)     # 누적관객
                    }
                }
        
        # 5. 실패 시 로그 반환
        log_msg = ", ".join(crawled_log[:20]) 
        return {
            "found": False, 
            "debug_error": f"'{movieName}' 미발견.\n[검색된 영화]: {log_msg}..."
        }
        
    except Exception as e:
        return {"found": False, "debug_error": f"Server Error: {str(e)}"}

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
