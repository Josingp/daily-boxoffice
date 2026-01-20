import os
import json
import requests
import re
import datetime
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

DAILY_FILE = "public/daily_data.json"
REALTIME_FILE = "public/realtime_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
MSTVIEW_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

def ensure_dir():
    if not os.path.exists("public"):
        os.makedirs("public")

def fetch_robust():
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': KOBIS_REALTIME_URL
    }
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        return session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=20)
    except: return None

def update_realtime():
    print("Updating Realtime Data...")
    try:
        resp = fetch_robust()
        if not resp: return

        soup = BeautifulSoup(resp.text, 'html.parser')
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        history = {}

        if os.path.exists(REALTIME_FILE):
            with open(REALTIME_FILE, 'r', encoding='utf-8') as f:
                try: history = json.load(f)
                except: pass

        rows = soup.find_all("tr")
        count = 0
        for row in rows:
            # 정밀 파싱
            target_link = row.find("a", onclick=MSTVIEW_REGEX.search)
            if not target_link: continue
            
            title = target_link.get("title", "").strip() or target_link.get_text(strip=True)
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            rate = cols[3].get_text(strip=True).replace('%', '')
            
            if title not in history: history[title] = []
            
            if not history[title] or history[title][-1]['time'] != timestamp:
                history[title].append({
                    "time": timestamp,
                    "rate": float(rate) if rate else 0,
                    "rank": int(rank)
                })
                if len(history[title]) > 144: history[title] = history[title][-144:]
            count += 1

        if count > 0:
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            print(f"Realtime Data Saved ({count} movies).")
        
    except Exception as e:
        print(f"Realtime Update Failed: {e}")

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
