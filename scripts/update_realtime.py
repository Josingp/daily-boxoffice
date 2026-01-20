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
    
    realtime_data = load_json(REALTIME_FILE)
    daily_data = load_json(DAILY_FILE)
    
    detail_cache = {}
    if "movies" in daily_data:
        for m in daily_data["movies"]:
            if "movieCd" in m and "detail" in m:
                detail_cache[m["movieCd"]] = m["detail"]

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
        
        # [수정] 조회일시 파싱 (제공해주신 HTML 구조 반영)
        # 예: 조회일시 : 2026/01/20 18:52
        crawled_time = ""
        try:
            # 전체 텍스트에서 날짜 패턴 검색 (가장 안전함)
            txt = soup.get_text()
            # YYYY/MM/DD HH:MM 패턴
            match = re.search(r"조회일시\s*:\s*(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})", txt)
            if match:
                crawled_time = match.group(1).replace("/", "-")
            else:
                # 대안 패턴 (YYYY-MM-DD)
                match = re.search(r"조회일시\s*:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})", txt)
                if match: crawled_time = match.group(1)
        except: pass
        
        # 파싱 실패 시 현재 시간 (Fallback)
        if not crawled_time:
            crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        rows = soup.find_all("tr")
        count = 0
        
        if "meta" not in realtime_data: realtime_data["meta"] = {}

        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if not rank.isdigit(): continue
            
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
            
            # 데이터 추출
            rate = cols[3].get_text(strip=True).replace('%', '')
            audi_cnt_raw = cols[6].get_text(strip=True) # "37,355"
            sales_amt_raw = cols[4].get_text(strip=True)
            audi_acc_raw = cols[7].get_text(strip=True)
            sales_acc_raw = cols[5].get_text(strip=True)

            # 상세정보 확보
            if movie_cd and title not in realtime_data["meta"]:
                if movie_cd in detail_cache:
                    realtime_data["meta"][title] = detail_cache[movie_cd]
                elif int(rank) <= 20:
                    detail = fetch_movie_detail(movie_cd)
                    if detail: 
                        realtime_data["meta"][title] = detail
                        time.sleep(0.1)

            # 히스토리 데이터
            if title not in realtime_data: realtime_data[title] = []
            
            if not realtime_data[title] or realtime_data[title][-1]['time'] != crawled_time:
                realtime_data[title].append({
                    "time": crawled_time,
                    "rank": int(rank),
                    "rate": float(rate) if rate else 0,
                    "audiCnt": audi_cnt_raw, 
                    "salesAmt": sales_amt_raw,
                    "audiAcc": audi_acc_raw,
                    "salesAcc": sales_acc_raw,
                    # 그래프용 숫자값 (콤마 제거)
                    "val_audi": int(audi_cnt_raw.replace(',', '')) if audi_cnt_raw.replace(',', '').isdigit() else 0,
                    "val_rate": float(rate) if rate else 0
                })
                if len(realtime_data[title]) > 288:
                    realtime_data[title] = realtime_data[title][-288:]
            
            count += 1

        if count > 0:
            os.makedirs("public", exist_ok=True)
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(realtime_data, f, ensure_ascii=False, indent=2)
            print(f"Updated {count} movies at {crawled_time}")

    except Exception as e:
        print(f"Realtime Update Failed: {e}")

if __name__ == "__main__":
    update_realtime()
