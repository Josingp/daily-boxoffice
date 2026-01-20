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

# 영화 코드 추출용 정규식
MSTVIEW_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

def ensure_dir():
    if not os.path.exists("public"):
        os.makedirs("public")

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

# 데이터 변화 감지 (중복 저장 방지)
def is_same_data(last, new):
    if not last: return False
    return (
        last['rank'] == new['rank'] and
        last['rate'] == new['rate'] and
        last['audiCnt'] == new['audiCnt']
    )

def update_realtime():
    print("Updating Realtime Data...")
    
    realtime_data = load_json(REALTIME_FILE)
    daily_data = load_json(DAILY_FILE)
    
    # 1. 일별 데이터에서 상세정보 캐시 구성 (API 호출 최소화)
    detail_cache = {}
    if "movies" in daily_data:
        for m in daily_data["movies"]:
            if "movieCd" in m and "detail" in m:
                detail_cache[m["movieCd"]] = m["detail"]
    
    session = requests.Session()
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        # KOBIS 접속
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf_input = soup.find('input', {'name': 'CSRFToken'})
        
        if not csrf_input:
            print("Error: CSRF Token not found.")
            return

        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf_input['value'], 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=20)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # [시간 파싱 수정] HTML 구조: <em><b>조회일시 : ...</b></em>
        crawled_time = ""
        try:
            # 태그 구조를 무시하고 텍스트 전체에서 패턴 검색 (가장 강력함)
            text_content = soup.get_text()
            # 2026/01/20 18:52 또는 2026-01-20 등 다양한 포맷 대응
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", text_content)
            if match:
                crawled_time = match.group(1).replace("/", "-")
        except: pass
        
        if not crawled_time:
            crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        rows = soup.find_all("tr")
        count = 0
        
        # 메타데이터(상세정보) 저장소 초기화
        if "meta" not in realtime_data: realtime_data["meta"] = {}

        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            # 순위
            rank = cols[0].get_text(strip=True)
            if not rank.isdigit(): continue
            
            # 영화 제목 및 코드
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
            
            # [데이터 추출] 0원 0명 방지를 위해 인덱스 및 값 확인
            # cols[3]: 예매율, cols[4]: 예매매출액, cols[5]: 누적매출액
            # cols[6]: 예매관객수, cols[7]: 누적관객수
            rate = cols[3].get_text(strip=True).replace('%', '')
            audi_cnt_raw = cols[6].get_text(strip=True)
            sales_amt_raw = cols[4].get_text(strip=True)
            audi_acc_raw = cols[7].get_text(strip=True)
            sales_acc_raw = cols[5].get_text(strip=True)

            # 상세정보 확보 (캐시 -> API)
            if movie_cd and title not in realtime_data["meta"]:
                if movie_cd in detail_cache:
                    realtime_data["meta"][title] = detail_cache[movie_cd]
                    print(f"Details cached for {title}")
                elif int(rank) <= 30: # 상위 30위까지만 API 호출
                    print(f"Fetching API details for {title}...")
                    detail = fetch_movie_detail(movie_cd)
                    if detail: 
                        realtime_data["meta"][title] = detail
                        time.sleep(0.1) # API 부하 방지

            # 히스토리 데이터 구성
            new_entry = {
                "time": crawled_time,
                "rank": int(rank),
                "rate": float(rate) if rate else 0,
                "audiCnt": audi_cnt_raw,
                "salesAmt": sales_amt_raw,
                "audiAcc": audi_acc_raw,
                "salesAcc": sales_acc_raw,
                # 그래프용 숫자 (콤마 제거)
                "val_audi": int(audi_cnt_raw.replace(',', '')) if audi_cnt_raw.replace(',', '').isdigit() else 0,
                "val_rate": float(rate) if rate else 0
            }

            if title not in realtime_data: realtime_data[title] = []
            last_entry = realtime_data[title][-1] if realtime_data[title] else None

            # 스마트 업데이트: 변동 없으면 시간만 갱신
            if is_same_data(last_entry, new_entry):
                realtime_data[title][-1]['time'] = crawled_time
            else:
                realtime_data[title].append(new_entry)
            
            # 데이터 길이 제한
            if len(realtime_data[title]) > 288:
                realtime_data[title] = realtime_data[title][-288:]
            
            count += 1

        if count > 0:
            os.makedirs("public", exist_ok=True)
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(realtime_data, f, ensure_ascii=False, indent=2)
            print(f"Successfully updated {count} movies at {crawled_time}")

    except Exception as e:
        print(f"Realtime Update Failed: {e}")

if __name__ == "__main__":
    ensure_dir()
    update_realtime()
