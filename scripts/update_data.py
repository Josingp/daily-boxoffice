import os
import json
import requests
import datetime
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

# [설정]
DAILY_FILE = "public/daily_data.json"
REALTIME_FILE = "public/realtime_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def ensure_dir():
    if not os.path.exists("public"):
        os.makedirs("public")

# [핵심] 사용자님이 제공한 강력한 크롤링 로직 이식
def get_base_headers():
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Referer': KOBIS_REALTIME_URL,
        'Origin': 'https://www.kobis.or.kr',
        'Content-Type': 'application/x-www-form-urlencoded'
    }

def fetch_kobis_smartly():
    session = requests.Session()
    headers = get_base_headers()
    
    # [1차 시도] 토큰 획득 후 고정 페이로드
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        token = soup.find('input', {'name': 'CSRFToken'})
        csrf = token.get('value', '') if token else ''
        
        payload = {
            'CSRFToken': csrf, 'loadEnd': '0', 'dmlMode': 'search', 'allMovieYn': 'Y', 'sMultiChk': ''
        }
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=20)
        
        if len(BeautifulSoup(resp.text, 'html.parser').find_all("tr")) > 2:
            return resp
    except: pass

    # [2차 시도] 동적 폼 파싱 (Fallback)
    try:
        session = requests.Session() # 세션 초기화
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        payload = {}
        for inp in soup.find_all('input'):
            if inp.get('name'): payload[inp.get('name')] = inp.get('value', '')
        for sel in soup.find_all('select'):
            if sel.get('name'):
                opt = sel.find('option', selected=True) or sel.find('option')
                payload[sel.get('name')] = opt.get('value', '') if opt else ''
        payload.update({'dmlMode': 'search', 'allMovieYn': 'Y'})
        
        return session.post(KOBIS_REALTIME_URL, headers=headers, data=payload, timeout=20)
    except: return None

# 1. 실시간 예매율 수집
def update_realtime():
    print("Updating Realtime Data...")
    try:
        resp = fetch_kobis_smartly() # [수정] 단순 post 대신 스마트 로직 사용
        if not resp:
            print("Failed to fetch data.")
            return

        soup = BeautifulSoup(resp.text, 'html.parser')
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        history = {}

        # 기존 데이터 로드
        if os.path.exists(REALTIME_FILE):
            with open(REALTIME_FILE, 'r', encoding='utf-8') as f:
                try: history = json.load(f)
                except: pass

        rows = soup.find_all("tr")
        count = 0
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if not rank.isdigit() or int(rank) > 10: continue # Top 10
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            rate = cols[3].get_text(strip=True).replace('%', '')
            
            if title not in history: history[title] = []
            
            # 중복 시간 제외 저장
            if not history[title] or history[title][-1]['time'] != timestamp:
                history[title].append({
                    "time": timestamp,
                    "rate": float(rate) if rate else 0,
                    "rank": int(rank)
                })
                if len(history[title]) > 144: # 24시간분 유지
                    history[title] = history[title][-144:]
            count += 1

        if count > 0:
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            print(f"Realtime Data Saved ({count} movies).")
        else:
            print("No valid movie data found.")
        
    except Exception as e:
        print(f"Realtime Update Failed: {e}")

# 2. 일별 박스오피스 수집
def update_daily():
    print("Updating Daily Boxoffice...")
    if not KOBIS_API_KEY: return

    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    detail_url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    yesterday = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime("%Y%m%d")
    
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={yesterday}")
        data = res.json()
        daily_list = data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        final_data = {"date": yesterday, "movies": []}
        
        def get_detail(code):
            try:
                r = requests.get(f"{detail_url}?key={KOBIS_API_KEY}&movieCd={code}")
                return r.json().get("movieInfoResult", {}).get("movieInfo", {})
            except: return {}

        with ThreadPoolExecutor(max_workers=5) as ex:
            futures = {ex.submit(get_detail, m['movieCd']): m for m in daily_list}
            for f in futures:
                m = futures[f]
                m['detail'] = f.result()
                final_data["movies"].append(m)
        
        final_data["movies"].sort(key=lambda x: int(x['rank']))

        with open(DAILY_FILE, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, ensure_ascii=False, indent=2)
        print("Daily Data Saved.")

    except Exception as e:
        print(f"Daily Update Failed: {e}")

if __name__ == "__main__":
    ensure_dir()
    update_realtime()
    if not os.path.exists(DAILY_FILE) or datetime.datetime.utcnow().hour == 1:
        update_daily()
