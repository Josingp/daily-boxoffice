import os
import requests
import re
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
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
    """문자열 정규화 (특수문자 제거, 소문자 변환) - 매칭 정확도 향상용"""
    if not s: return ""
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# -----------------------------------------------------------------------------
# [NEW] 박스오피스 API + 실시간 예매율 크롤링 데이터 결합 엔드포인트
# -----------------------------------------------------------------------------
@app.get("/api/composite")
def get_composite_boxoffice():
    # 1. 어제 날짜 구하기 (일일 박스오피스용, YYYYMMDD)
    yesterday_obj = datetime.now() - timedelta(days=1)
    yesterday = yesterday_obj.strftime("%Y%m%d")
    
    boxoffice_data = []
    realtime_map = {}

    # 2. KOBIS API: 일일 박스오피스 데이터 가져오기 (Top 10)
    try:
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}"
        res = requests.get(url, timeout=5)
        data = res.json()
        if "boxOfficeResult" in data and "dailyBoxOfficeList" in data["boxOfficeResult"]:
            boxoffice_data = data["boxOfficeResult"]["dailyBoxOfficeList"]
    except Exception as e:
        print(f"KOBIS API Error: {str(e)}")
        return {"error": "Failed to fetch box office data"}

    # 3. KOBIS 웹사이트 크롤링: 실시간 예매율 전체 리스트 가져오기
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        # 전체 리스트 검색 파라미터
        data = {'dmlMode': 'search'}
        
        resp = requests.post(KOBIS_REALTIME_URL, headers=headers, data=data, timeout=10)
        
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            rows = soup.find_all("tr")

            for row in rows:
                cols = row.find_all("td")
                if len(cols) < 8: continue # 유효한 데이터 행인지 확인

                # 영화 제목 추출 (a태그의 title 속성이 가장 정확함)
                a_tag = cols[1].find("a")
                if a_tag and a_tag.get("title"):
                    title_text = a_tag["title"].strip()
                else:
                    title_text = cols[1].get_text(strip=True)
                
                # 매칭을 위해 제목 정규화
                norm_title = normalize_string(title_text)

                # 딕셔너리에 저장 (Key: 정규화된 제목)
                realtime_map[norm_title] = {
                    "rank": cols[0].get_text(strip=True),       # 실시간 예매 순위
                    "title": title_text,                        # 원본 제목
                    "rate": cols[3].get_text(strip=True),       # 예매율
                    "salesAmt": cols[4].get_text(strip=True),   # 예매매출액
                    "salesAcc": cols[5].get_text(strip=True),   # 누적매출액
                    "audiCnt": cols[6].get_text(strip=True),    # 예매관객수
                    "audiAcc": cols[7].get_text(strip=True)     # 누적관객수
                }
    except Exception as e:
        print(f"Crawling Error: {e}")
        # 크롤링 실패 시, API 데이터만이라도 반환하기 위해 여기서 중단하지 않음

    # 4. 데이터 병합 (Matching)
    merged_list = []
    
    # 박스오피스 리스트를 기준으로 순회
    for movie in boxoffice_data:
        norm_title = normalize_string(movie['movieNm'])
        
        # 크롤링된 데이터에서 찾기
        match = realtime_map.get(norm_title)
        
        item = {
            # API 제공 기본 데이터
            "rank": movie['rank'],
            "rankOldAndNew": movie['rankOldAndNew'],
            "movieNm": movie['movieNm'],
            "movieCd": movie['movieCd'],
            "openDt": movie['openDt'],
            "audiCnt": movie['audiCnt'],    # 일일 관객수
            "audiAcc": movie['audiAcc'],    # 누적 관객수 (API 기준)
            "salesAmt": movie['salesAmt'],
            "salesShare": movie['salesShare'],
            "salesInten": movie['salesInten'],
            "audiInten": movie['audiInten'],

            # 실시간 예매 데이터 (매칭 성공 시 포함, 실패 시 null)
            "realtime": match if match else None
        }
        merged_list.append(item)

    return {
        "status": "ok", 
        "targetDt": yesterday, 
        "source": "KOBIS API + Crawling",
        "data": merged_list
    }

# -----------------------------------------------------------------------------
# [EXISTING] 개별 영화 실시간 예매율 검색 (기존 유지)
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
            
            a_tag = cols[1].find("a")
            if a_tag and a_tag.get("title"):
                title_text = a_tag["title"].strip()
            else:
                title_text = cols[1].get_text(strip=True)
                
            rank_text = cols[0].get_text(strip=True)
            if rank_text.isdigit():
                crawled_list.append(f"[{rank_text}위] {title_text}")
            
            if normalize_string(title_text) == target_norm:
                return {
                    "found": True,
                    "data": {
                        "rank": rank_text,
                        "title": title_text,
                        "rate": cols[3].get_text(strip=True),
                        "salesAmt": cols[4].get_text(strip=True),
                        "salesAcc": cols[5].get_text(strip=True),
                        "audiCnt": cols[6].get_text(strip=True),
                        "audiAcc": cols[7].get_text(strip=True)
                    }
                }
        
        log_msg = ", ".join(crawled_list[:15]) 
        return {
            "found": False, 
            "debug_error": f"'{movieName}' 미발견.\n[읽은 목록]: {log_msg}..."
        }
        
    except Exception as e:
        return {"found": False, "debug_error": f"Error: {str(e)}"}

# -----------------------------------------------------------------------------
# [EXISTING] KOBIS API Proxies
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
        # datetime 모듈 사용 (상단 import 추가됨)
        end_dt = datetime.strptime(endDate, "%Y%m%d")
        for i in range(27, -1, -1):
            dates.append((end_dt - timedelta(days=i)).strftime("%Y%m%d"))
            
        def fetch(dt):
            try:
                res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={dt}", timeout=3).json()
                # 해당 날짜의 박스오피스 리스트에서 내 영화 찾기
                if 'boxOfficeResult' in res and 'dailyBoxOfficeList' in res['boxOfficeResult']:
                    movie = next((m for m in res['boxOfficeResult']['dailyBoxOfficeList'] if m['movieCd'] == movieCd), None)
                    if movie:
                        return {
                            "date": dt, 
                            "dateDisplay": f"{dt[4:6]}/{dt[6:8]}",
                            "audiCnt": int(movie['audiCnt']), 
                            "scrnCnt": int(movie['scrnCnt'])
                        }
            except: pass
            # 데이터 없으면 0으로 채움
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0, "scrnCnt": 0}

        with ThreadPoolExecutor(max_workers=10) as ex:
            results = list(ex.map(fetch, dates))
            return [r for r in results if r is not None]
    except Exception as e:
        print(f"Trend Error: {e}")
        return []
