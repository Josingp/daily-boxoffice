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

# 정규식: mstView('movie','123') 패턴 추출 (공백/따옴표 유연하게)
MOVIE_CD_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

def extract_movie_data(row):
    """HTML 행(tr)에서 데이터 추출"""
    cols = row.find_all("td")
    # [디버깅 강화] 컬럼 수가 부족해도 일단 내용은 확인하고 싶다면 이 체크를 완화할 수 있으나,
    # 데이터 정합성을 위해 유지하되, 호출부에서 row 내용을 로깅하도록 함.
    if len(cols) < 8: return None

    # 1. 영화 코드(movieCd) 추출
    movie_cd = None
    a_tag = cols[1].find("a")
    
    if a_tag and a_tag.has_attr("onclick"):
        match = MOVIE_CD_REGEX.search(a_tag["onclick"])
        if match:
            movie_cd = match.group(1)
    
    # 2. 제목 추출
    if a_tag and a_tag.get("title"):
        title_text = a_tag["title"].strip()
    else:
        title_text = cols[1].get_text(strip=True)

    # 3. 숫자 정제
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
# 1. [상세 화면용] 실시간 예매율 (디버깅 강화 버전)
# -----------------------------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(
    movieName: str = Query(..., description="Movie Name"),
    movieCd: str = Query(None, description="Movie Code")
):
    try:
        # [핵심] Session 사용으로 브라우저 환경 모방 (쿠키 유지)
        session = requests.Session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do',
            'Origin': 'https://www.kobis.or.kr',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        # 타임아웃 넉넉하게 20초
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={'dmlMode': 'search'}, timeout=20)
        resp.encoding = 'utf-8'

        if resp.status_code != 200:
            return {"found": False, "debug_error": f"서버 접속 실패 (HTTP {resp.status_code})"}

        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # [디버깅 정보 수집]
        page_title = soup.title.string.strip() if soup.title else "제목없음"
        all_rows = soup.find_all("tr")
        total_rows = len(all_rows)
        
        # 상위 3개 행의 텍스트만 미리보기 (HTML 구조 확인용)
        preview_rows = []
        for r in all_rows[:3]:
            preview_rows.append(r.get_text(strip=True)[:50]) # 50자까지만
            
        debug_extracted_list = []
        target_name_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()

        for row in all_rows:
            data = extract_movie_data(row)
            if not data: continue
            
            # 디버깅 리스트에 추가 (상위 15개)
            if len(debug_extracted_list) < 15:
                # 영화코드와 제목을 같이 기록
                debug_extracted_list.append(f"{data['title']}({data['movieCd']})")

            # [Logic 1] ID 매칭
            if movieCd and data['movieCd'] == movieCd:
                return {"found": True, "method": "ID_MATCH", "data": data}

            # [Logic 2] 이름 매칭 (백업)
            row_title_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            if target_name_norm in row_title_norm or row_title_norm in target_name_norm:
                 return {"found": True, "method": "NAME_MATCH", "data": data}

        # [최종 실패 시 원인 분석 리포트 리턴]
        error_report = (
            f"검색실패.\n"
            f"- 접속페이지: {page_title}\n"
            f"- 읽은 TR 개수: {total_rows}개\n"
            f"- 상위 행 미리보기: {preview_rows}\n"
            f"- 추출 성공한 목록(상위15): {', '.join(debug_extracted_list)}"
        )
        return {"found": False, "debug_error": error_report}

    except Exception as e:
        return {"found": False, "debug_error": f"Internal Error: {str(e)}"}

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

    # (2) Crawling
    try:
        # 여기도 Session 및 강화된 헤더 적용
        session = requests.Session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={'dmlMode': 'search'}, timeout=15)
        resp.encoding = 'utf-8'
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr")

        for row in rows:
            data = extract_movie_data(row)
            if data:
                if data['movieCd']:
                    realtime_map[data['movieCd']] = data
                
                # 이름 매칭 백업용 맵핑
                norm_title = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
                if norm_title and norm_title not in realtime_map:
                    realtime_map[norm_title] = data

    except Exception as e:
        print(f"Crawling Error: {e}")

    # (3) Merge
    merged_list = []
    for movie in boxoffice_data:
        target_cd = movie['movieCd']
        target_nm_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movie['movieNm']).lower()
        
        match = realtime_map.get(target_cd) # 1순위: ID
        if not match:
            match = realtime_map.get(target_nm_norm) # 2순위: 이름
        
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
