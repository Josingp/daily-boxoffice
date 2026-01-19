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

KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# 정규식: onclick="mstView('movie','12345678')" 패턴 추출
MOVIE_CD_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

def extract_movie_data(row):
    cols = row.find_all("td")
    if len(cols) < 8: return None

    # 1. 영화 코드 추출
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

def fetch_kobis_smartly():
    """
    [스마트 크롤링 v2]
    - input 태그뿐만 아니라 select(드롭다운) 값까지 모두 수집하여 전송
    - 브라우저 동작을 완벽하게 모방
    """
    try:
        session = requests.Session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do',
            'Origin': 'https://www.kobis.or.kr',
            'Content-Type': 'application/x-www-form-urlencoded'
        }

        # [Step 1] 페이지 방문 (GET)
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        
        # [Step 2] 폼 데이터 정밀 수집 (input + select)
        soup_visit = BeautifulSoup(visit.text, 'html.parser')
        payload = {}
        
        # 1) Input 태그 수집
        for inp in soup_visit.find_all('input'):
            if inp.get('name'):
                payload[inp.get('name')] = inp.get('value', '')
        
        # 2) Select 태그 수집 (누락되었던 부분!)
        for sel in soup_visit.find_all('select'):
            name = sel.get('name')
            if not name: continue
            
            # 선택된 옵션 찾기
            selected_opt = sel.find('option', selected=True)
            if selected_opt:
                payload[name] = selected_opt.get('value', '')
            else:
                # 선택된 게 없으면 첫 번째 옵션 값 사용
                first_opt = sel.find('option')
                if first_opt:
                    payload[name] = first_opt.get('value', '')
                else:
                    payload[name] = ''
        
        # 3) 검색 모드로 강제 설정
        payload['dmlMode'] = 'search' 

        # [Step 3] 데이터 요청 (POST)
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=20)
        resp.encoding = 'utf-8'
        
        return resp, payload  # 디버깅을 위해 payload도 반환
    except Exception as e:
        print(f"Smart Fetch Error: {e}")
        return None, None

# -----------------------------------------------------------------------------
# 1. [상세 화면용] 실시간 예매율
# -----------------------------------------------------------------------------
@app.get("/api/reservation")
def get_realtime_reservation(
    movieName: str = Query(..., description="Movie Name"),
    movieCd: str = Query(None, description="Movie Code")
):
    try:
        resp, sent_payload = fetch_kobis_smartly()

        if not resp or resp.status_code != 200:
            return {"found": False, "debug_error": "서버 접속 실패"}

        soup = BeautifulSoup(resp.text, 'html.parser')
        
        all_rows = soup.find_all("tr")
        
        # 데이터 없음 체크
        if len(all_rows) <= 2:
             msg = all_rows[1].get_text(strip=True) if len(all_rows) > 1 else "내용 없음"
             # 어떤 데이터를 보냈는지 Payload 정보를 에러 메시지에 포함 (디버깅용)
             keys = list(sent_payload.keys()) if sent_payload else "None"
             return {
                 "found": False, 
                 "debug_error": f"데이터 없음 (서버응답: {msg}).\n보낸파라미터: {keys}"
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
        return {"found": False, "debug_error": f"Error: {str(e)}"}

# -----------------------------------------------------------------------------
# 2. [전체 목록용] 박스오피스 + 실시간 예매율 결합
# -----------------------------------------------------------------------------
@app.get("/api/composite")
def get_composite_boxoffice():
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
    
    boxoffice_data = []
    realtime_map = {} 

    try:
        # API 호출
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}"
        res = requests.get(url, timeout=5).json()
        boxoffice_data = res.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except Exception as e:
        print(f"API Error: {e}")

    try:
        # 스마트 크롤링 호출
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

    # 데이터 병합
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
