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

# URL 정의
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# 정규식: onclick="mstView('movie','12345678')" 에서 숫자 추출
MOVIE_CD_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

def extract_movie_data(row):
    """HTML 행(tr)에서 데이터 추출"""
    cols = row.find_all("td")
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

def get_base_headers():
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do',
        'Origin': 'https://www.kobis.or.kr',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Upgrade-Insecure-Requests': '1',
        'Content-Type': 'application/x-www-form-urlencoded'
    }

def fetch_kobis_smartly():
    """
    [하이브리드 크롤링 전략]
    1. 고정 페이로드(Pattern A) 시도 -> 성공 시 반환
    2. 실패(데이터 없음) 시 동적 페이로드(Pattern B) 시도 -> 결과 반환
    """
    session = requests.Session()
    headers = get_base_headers()

    # ---------------------------------------------------------
    # [1차 시도] Pattern A: 고정 페이로드 (Fixed)
    # ---------------------------------------------------------
    try:
        # GET으로 토큰 확보
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup_visit = BeautifulSoup(visit.text, 'html.parser')
        token_input = soup_visit.find('input', {'name': 'CSRFToken'})
        csrf_token = token_input.get('value', '') if token_input else ''

        payload_fixed = {
            'CSRFToken': csrf_token,
            'loadEnd': '0',
            'repNationCd': '', 'areaCd': '', 'repNationSelected': '',
            'totIssuAmtRatioOrder': '', 'totIssuAmtOrder': '', 'addTotIssuAmtOrder': '',
            'totIssuCntOrder': '', 'totIssuCntRatioOrder': '', 'addTotIssuCntOrder': '',
            'dmlMode': 'search', 
            'allMovieYn': 'Y',  # 전체 조회
            'sMultiChk': ''
        }

        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload_fixed, timeout=20)
        resp.encoding = 'utf-8'

        # 검증: 데이터가 들어있는지 확인 (행 개수 > 2)
        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr")
        
        if len(rows) > 2:
            print("[KOBIS] Pattern A (Fixed) Success")
            return resp, payload_fixed
        else:
            print("[KOBIS] Pattern A Failed (No Data), Switching to Pattern B...")

    except Exception as e:
        print(f"[KOBIS] Pattern A Error: {e}")

    # ---------------------------------------------------------
    # [2차 시도] Pattern B: 동적 페이로드 (Dynamic / Fallback)
    # ---------------------------------------------------------
    try:
        # 새 세션으로 시작 (깨끗한 상태)
        session = requests.Session()
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup_visit = BeautifulSoup(visit.text, 'html.parser')
        
        payload_dynamic = {}
        
        # 모든 Input 긁어오기
        for inp in soup_visit.find_all('input'):
            if inp.get('name'):
                payload_dynamic[inp.get('name')] = inp.get('value', '')
        
        # 모든 Select 긁어오기
        for sel in soup_visit.find_all('select'):
            name = sel.get('name')
            if not name: continue
            selected_opt = sel.find('option', selected=True)
            if selected_opt:
                payload_dynamic[name] = selected_opt.get('value', '')
            else:
                first_opt = sel.find('option')
                payload_dynamic[name] = first_opt.get('value', '') if first_opt else ''

        # 필수값 강제 덮어쓰기
        payload_dynamic.update({
            'dmlMode': 'search',
            'allMovieYn': 'Y',
            'sMultiChk': ''
        })

        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload_dynamic, timeout=20)
        resp.encoding = 'utf-8'
        
        print("[KOBIS] Pattern B (Dynamic) Executed")
        return resp, payload_dynamic

    except Exception as e:
        print(f"[KOBIS] Pattern B Error: {e}")
        return None, None


# -----------------------------------------------------------------------------
# 1. [상세 화면용] 실시간 예매율 조회
# -----------------------------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(
    movieName: str = Query(..., description="Movie Name"),
    movieCd: str = Query(None, description="Movie Code")
):
    try:
        resp, sent_payload = fetch_kobis_smartly()

        if not resp or resp.status_code != 200:
            return {"found": False, "debug_error": "KOBIS 서버 접속 실패 (All Patterns Failed)"}

        soup = BeautifulSoup(resp.text, 'html.parser')
        all_rows = soup.find_all("tr")
        
        # 데이터 없음 체크
        if len(all_rows) <= 2:
             msg = all_rows[1].get_text(strip=True) if len(all_rows) > 1 else "내용 없음"
             return {
                 "found": False, 
                 "debug_error": f"데이터 로드 실패.\n서버메시지: {msg}\n(시도된 Payload: {'Dynamic' if 'allMovieYn' in sent_payload else 'Fixed'})"
             }

        debug_list = []
        target_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()

        for row in all_rows:
            data = extract_movie_data(row)
            if not data: continue
            
            if len(debug_list) < 10:
                debug_list.append(f"{data['title']}({data['movieCd']})")

            # 1순위: ID 매칭
            if movieCd and data['movieCd'] == movieCd:
                return {"found": True, "method": "ID_MATCH", "data": data}

            # 2순위: 이름 매칭
            row_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
            if target_norm in row_norm or row_norm in target_norm:
                 return {"found": True, "method": "NAME_MATCH", "data": data}

        return {
            "found": False, 
            "debug_error": f"매칭 실패 (ID:{movieCd}).\n목록(상위10): {', '.join(debug_list)}..."
        }

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

    # (1) KOBIS API
    try:
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}"
        res = requests.get(url, timeout=5).json()
        boxoffice_data = res.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except Exception as e:
        print(f"API Error: {e}")

    # (2) KOBIS 크롤링 (Hybrid)
    try:
        resp, _ = fetch_kobis_smartly()
        
        if resp and resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            rows = soup.find_all("tr")

            for row in rows:
                data = extract_movie_data(row)
                if data:
                    if data['movieCd']:
                        realtime_map[data['movieCd']] = data
                    
                    norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', data['title']).lower()
                    if norm and norm not in realtime_map:
                        realtime_map[norm] = data
    except Exception as e:
        print(f"Crawling Error: {e}")

    # (3) 데이터 병합
    merged_list = []
    for movie in boxoffice_data:
        target_cd = movie['movieCd']
        target_nm_norm = re.sub(r'[^0-9a-zA-Z가-힣]', '', movie['movieNm']).lower()
        
        match = realtime_map.get(target_cd)
        if not match:
            match = realtime_map.get(target_nm_norm)
        
        item = movie.copy()
        item["realtime"] = match
        merged_list.append(item)

    return {"status": "ok", "targetDt": yesterday, "data": merged_list}

# -----------------------------------------------------------------------------
# 3. Proxy Functions
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
