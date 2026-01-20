import os
import json
import requests
import re
import datetime
import time
from bs4 import BeautifulSoup

REALTIME_FILE = "public/realtime_data.json"
DAILY_FILE = "public/daily_data.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

MSTVIEW_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

def load_json(filepath):
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            try: return json.load(f)
            except: pass
    return {}

def fetch_movie_detail(movie_cd):
    if not KOBIS_API_KEY or not movie_cd: return None
    try:
        url = f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie_cd}"
        res = requests.get(url, timeout=3)
        return res.json().get("movieInfoResult", {}).get("movieInfo")
    except: return None

def update_realtime():
    print("Updating Realtime Data...")
    
    # 1. 기존 데이터 로드
    realtime_data = load_json(REALTIME_FILE)
    daily_data = load_json(DAILY_FILE)
    
    # 2. 일별 데이터에서 상세정보 캐싱 (API 절약)
    detail_cache = {}
    if "movies" in daily_data:
        for m in daily_data["movies"]:
            if "movieCd" in m and "detail" in m:
                detail_cache[m["movieCd"]] = m["detail"]
    
    # "meta" 키가 있으면 기존 상세정보 로드
    if "meta" in realtime_data:
        for m_title, m_detail in realtime_data["meta"].items():
             # 제목을 키로 쓰거나 movieCd를 키로 쓸 수 있음. 여기선 단순화를 위해 제목 사용 고려했지만
             # 정확성을 위해 movieCd가 낫지만, 구조상 제목으로 매칭하는게 편함
             pass

    session = requests.Session()
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=20)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 날짜 파싱
        crawled_time = ""
        try:
            txt = soup.get_text()
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", txt)
            if match: crawled_time = match.group(1).replace("/", "-")
        except: pass
        
        if not crawled_time:
            crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        rows = soup.find_all("tr")
        count = 0
        
        # 메타데이터 저장소 (영화 제목 -> 상세정보)
        if "meta" not in realtime_data: realtime_data["meta"] = {}

        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if not rank.isdigit(): continue
            
            # 영화 정보 추출
            target_link = row.find("a", onclick=MSTVIEW_REGEX.search)
            title = ""
            movie_cd = ""
            
            if target_link:
                title = target_link.get("title", "").strip() or target_link.get_text(strip=True)
                match = MSTVIEW_REGEX.search(target_link['onclick'])
                if match: movie_cd = match.group(1)
            else:
                title = cols[1].get_text(strip=True)
            
            if not title: continue
            
            # [중요] 0원 0명 오류 수정: 인덱스 확인
            # KOBIS 실시간 예매율 표: 순위(0), 영화명(1), 개봉일(2), 예매율(3), 예매매출액(4), 예매매출누적(5), 예매관객수(6), 예매관객누적(7)
            # 따라서 cols[6]이 예매관객수, cols[4]가 예매매출액 맞음.
            # 데이터가 비어있거나 이상한 경우 0 처리
            
            rate = cols[3].get_text(strip=True).replace('%', '')
            audi_cnt_str = cols[6].get_text(strip=True).replace(',', '')
            sales_amt_str = cols[4].get_text(strip=True).replace(',', '')
            audi_acc_str = cols[7].get_text(strip=True).replace(',', '')
            sales_acc_str = cols[5].get_text(strip=True).replace(',', '')

            # 상세정보 확보 (캐시 -> API)
            if movie_cd and title not in realtime_data["meta"]:
                if movie_cd in detail_cache:
                    realtime_data["meta"][title] = detail_cache[movie_cd]
                else:
                    # 상위 20위까지만 API 호출 (속도 조절)
                    if int(rank) <= 20:
                        print(f"Fetching detail for {title}...")
                        detail = fetch_movie_detail(movie_cd)
                        if detail: 
                            realtime_data["meta"][title] = detail
                            time.sleep(0.1) # API 보호

            # 히스토리 데이터 저장
            if title not in realtime_data: realtime_data[title] = []
            
            # 중복 방지: 마지막 데이터 시간과 다를 때만 추가
            if not realtime_data[title] or realtime_data[title][-1]['time'] != crawled_time:
                realtime_data[title].append({
                    "time": crawled_time,
                    "rank": int(rank),
                    "rate": float(rate) if rate else 0,
                    "audiCnt": cols[6].get_text(strip=True), # 원본 문자열 (콤마 포함)
                    "salesAmt": cols[4].get_text(strip=True),
                    "audiAcc": cols[7].get_text(strip=True),
                    "salesAcc": cols[5].get_text(strip=True),
                    # 그래프용 숫자값
                    "val_audi": int(audi_cnt_str) if audi_cnt_str.isdigit() else 0,
                    "val_rate": float(rate) if rate else 0
                })
                if len(realtime_data[title]) > 288: # 하루치 유지
                    realtime_data[title] = realtime_data[title][-288:]
            
            count += 1

        if count > 0:
            os.makedirs("public", exist_ok=True)
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(realtime_data, f, ensure_ascii=False, indent=2)
            print(f"Updated {count} movies. Details cached: {len(realtime_data['meta'])}")

    except Exception as e:
        print(f"Realtime Update Failed: {e}")

if __name__ == "__main__":
    update_realtime()
