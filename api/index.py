import os
import requests
import re
import unicodedata
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
    [강력한 정규화 함수]
    1. None 체크
    2. 유니코드 정규화 (NFC): 자모 분리 현상 해결 (Mac/Web 호환성)
    3. 특수문자/공백 제거 및 소문자 변환
    """
    if not s: return ""
    # 1. 유니코드 정규화 (글자 깨짐/분리 방지)
    s = unicodedata.normalize('NFC', s)
    # 2. 한글, 영문, 숫자만 남기고 모두 제거
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# -----------------------------------------------------------------------------
# 1. [상세 화면용] 실시간 예매율 개별 검색 (매칭 로직 대폭 강화)
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
        resp.encoding = 'utf-8' # 한글 강제 설정
        
        if resp.status_code != 200:
            return {"found": False, "debug_error": f"HTTP {resp.status_code}"}

        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # [수정] tbody 안의 tr만 정확하게 타겟팅
        rows = soup.select("tbody tr")
        if not rows:
             rows = soup.find_all("tr") # fallback

        target_norm = normalize_string(movieName)
        debug_list = [] # 디버깅용 로그

        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            # 제목 추출
            a_tag = cols[1].find("a")
            if a_tag and a_tag.get("title"):
                title_text = a_tag["title"].strip()
            else:
                title_text = cols[1].get_text(strip=True)
            
            # 비교용 정규화 제목
            row_norm = normalize_string(title_text)
            
            # 디버깅 리스트에 추가 (상위 20개만)
            if len(debug_list) < 20:
                debug_list.append(f"{title_text}({row_norm})")

            # [핵심 수정] 포함 관계 비교 ('만약에우리' in '만약에우리2025' 등 유연하게)
            if target_norm in row_norm or row_norm in target_norm:
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
        
        # 못 찾았을 때 상세 디버그 정보 반환
        log_msg = "\n".join(debug_list)
        return {
            "found": False, 
            "debug_error": f"찾는 제목: '{movieName}' -> 정규화: '{target_norm}'\n[크롤링된 목록(원본/정규화)]:\n{log_msg}"
        }
        
    except Exception as e:
        return {"found": False, "debug_error": f"Server Error: {str(e)}"}

# -----------------------------------------------------------------------------
# 2. [전체 목록용] 박스오피스 + 실시간 예매율 결합
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
        resp.encoding = 'utf-8' # 한글 강제 설정

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
                
                # 유니코드 정규화 적용
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
        # 포함 관계 체크 (정확도 향상을 위해 양방향 체크)
        match = None
        
        # 1차 시도: 정확한 키 매칭
        if norm_title in realtime_map:
            match = realtime_map[norm_title]
        else:
            # 2차 시도: 유사 매칭 (Loop search)
            for k, v in realtime_map.items():
                if norm_title in k or k in norm_title:
                    match = v
                    break
        
        item = movie.copy()
        item["realtime"] = match if match else None
        merged_list.append(item)

    return {"status": "ok", "targetDt": yesterday, "data": merged_list}

# -----------------------------------------------------------------------------
# 3. KOBIS API Proxies
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
