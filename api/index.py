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

# [핵심 수정 1] 정규식 유연화 (띄어쓰기, 따옴표 유연하게 대응)
# 예: mstView('movie','123') / mstView( 'movie' , "123" ) 모두 통과
MOVIE_CD_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

def extract_movie_data(row):
    """HTML 행(tr)에서 데이터 추출"""
    cols = row.find_all("td")
    if len(cols) < 8: return None

    # 1. 영화 코드(movieCd) 추출 시도
    movie_cd = None
    a_tag = cols[1].find("a")
    
    # onclick 속성이 있는지 확인
    if a_tag and a_tag.has_attr("onclick"):
        onclick_val = a_tag["onclick"]
        match = MOVIE_CD_REGEX.search(onclick_val)
        if match:
            movie_cd = match.group(1)
    
    # 2. 제목 추출
    if a_tag and a_tag.get("title"):
        title_text = a_tag["title"].strip()
    else:
        title_text = cols[1].get_text(strip=True)

    # 3. 데이터 정제
    def clean_num(s):
        return s.replace(',', '').strip()

    return {
        "movieCd": movie_cd,
        "rank": cols[0].get_text(strip=True),
        "title": title_text,
        "rate": cols[3].get_text(strip=True),
        "salesAmt": clean_num(cols[4].get_text(strip=True)),
        "salesAcc": clean_num(cols[5].get_text(strip=True)),
        "audiCnt": clean_num(cols[6].get_text(strip=True)),
        "audiAcc": clean_num(cols[7].get_text(strip=True))
    }

# -----------------------------------------------------------------------------
# 1. [상세 화면용] 실시간 예매율 (ID 우선 -> 실패시 이름 백업)
# -----------------------------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(
    movieName: str = Query(..., description="Movie Name"),
    movieCd: str = Query(None, description="Movie Code")
):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        resp = requests.post(KOBIS_REALTIME_URL, headers=headers, data={'dmlMode': 'search'}, timeout=10)
        resp.encoding = 'utf-8' # 한글 깨짐 방지

        if resp.status_code != 200:
            return {"found": False, "debug_error": f"HTTP {resp.status_code}"}

        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr")
        
        debug_list = []

        # 검색 대상 이름 정규화 (공백/특수문자 제거, 소문자)
        target_name_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()

        for row in rows:
            data = extract_movie_data(row)
            if not data: continue
            
            # 디버깅용 로그 (상위 15개만)
            if len(debug_list) < 15:
                debug_list.append(f"{data['title']}(ID:{data['movieCd'] or '?'})")

            # [Logic 1] ID로 매칭 (가장 확실)
            if movieCd and data['movieCd'] and data['movieCd'] == movieCd:
                return {"found": True, "method": "ID_MATCH", "data": data}

            # [Logic 2] 이름으로 매칭 (ID 매칭 실패 시 백업)
            # 여기서는 movieCd가 있어도, 위에서 리턴 안 됐으면 실행됨
            row_title_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            
            if target_name_norm in row_title_norm or row_title_norm in target_name_norm:
                 return {"found": True, "method": "NAME_MATCH_BACKUP", "data": data}

        return {
            "found": False, 
            "debug_error": f"ID({movieCd}) 또는 이름({movieName}) 미발견.\n[상위 목록 ID확인]: {', '.join(debug_list)}..."
        }

    except Exception as e:
        return {"found": False, "debug_error": f"Server Error: {str(e)}"}

# -----------------------------------------------------------------------------
# 2. [전체 목록용] 박스오피스 + 실시간 예매율 결합
# -----------------------------------------------------------------------------
@app.get("/api/composite")
def get_composite_boxoffice():
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
    
    boxoffice_data = []
    realtime_map = {} 

    # (1) API Fetch
    try:
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}"
        res = requests.get(url, timeout=5).json()
        boxoffice_data = res.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except Exception as e:
        print(f"API Error: {e}")

    # (2) Crawling & Parsing
    try:
        headers = {'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded'}
        resp = requests.post(KOBIS_REALTIME_URL, headers=headers, data={'dmlMode': 'search'}, timeout=10)
        resp.encoding = 'utf-8'
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr")

        for row in rows:
            data = extract_movie_data(row)
            if data:
                # ID가 있으면 ID로 맵핑
                if data['movieCd']:
                    realtime_map[data['movieCd']] = data
                # ID 추출 실패 시 이름(정규화)으로도 맵핑 (백업)
                norm_title = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
                if norm_title:
                    # Key 충돌 방지를 위해 접두어 사용하거나 별도 맵 사용 가능하나, 
                    # 여기선 단순화를 위해 ID 맵에 우선 저장
                    if norm_title not in realtime_map: 
                        realtime_map[norm_title] = data

    except Exception as e:
        print(f"Crawling Error: {e}")

    # (3) Merge
    merged_list = []
    for movie in boxoffice_data:
        target_cd = movie['movieCd']
        target_nm_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movie['movieNm']).lower()
        
        # 1순위: ID 매칭
        match = realtime_map.get(target_cd)
        
        # 2순위: 이름 매칭 (ID 매칭 실패 시)
        if not match:
            match = realtime_map.get(target_nm_norm)
        
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
