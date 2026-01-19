import os
import json
import requests
import datetime
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

# [설정]
DAILY_FILE = "public/daily.json"
REALTIME_FILE = "public/realtime.json"

# KOBIS API (GitHub Secrets에서 주입됨)
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

def ensure_dir():
    if not os.path.exists("public"):
        os.makedirs("public")

# 1. 실시간 예매율 수집 (매시간 실행)
def update_realtime():
    print("Updating Realtime Data...")
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
    try:
        resp = requests.post(url, data={'dmlMode': 'search', 'allMovieYn': 'Y'}, timeout=15)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        
        # 기존 데이터 로드
        history = {}
        if os.path.exists(REALTIME_FILE):
            with open(REALTIME_FILE, 'r', encoding='utf-8') as f:
                try: history = json.load(f)
                except: pass

        # 파싱 및 누적
        for row in soup.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if int(rank) > 10: break # Top 10만
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            rate = cols[3].get_text(strip=True).replace('%', '')
            
            if title not in history: history[title] = []
            
            # 중복 시간 제외하고 추가
            if not history[title] or history[title][-1]['time'] != timestamp:
                history[title].append({
                    "time": timestamp,
                    "rate": float(rate),
                    "rank": int(rank)
                })
                # 최근 72개(3일치)만 유지
                if len(history[title]) > 72:
                    history[title] = history[title][-72:]

        with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
        print("Realtime Data Saved.")
        
    except Exception as e:
        print(f"Realtime Update Failed: {e}")

# 2. 일별 박스오피스 수집 (특정 시간에만 실행)
def update_daily():
    print("Updating Daily Boxoffice...")
    if not KOBIS_API_KEY:
        print("Skipping Daily: No API Key")
        return

    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    detail_url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    
    yesterday = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime("%Y%m%d")
    
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={yesterday}")
        data = res.json()
        daily_list = data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        final_data = {"date": yesterday, "movies": []}
        
        # 상세정보 병렬 호출
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
        
        # 순위 정렬
        final_data["movies"].sort(key=lambda x: int(x['rank']))

        with open(DAILY_FILE, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, ensure_ascii=False, indent=2)
        print("Daily Data Saved.")

    except Exception as e:
        print(f"Daily Update Failed: {e}")

if __name__ == "__main__":
    ensure_dir()
    
    # 무조건 실시간 데이터 업데이트
    update_realtime()
    
    # 현재 시간이 한국 시간 오전 10시 (UTC 01시) 대라면 일별 데이터도 업데이트
    # 또는 파일이 아예 없으면 생성
    current_utc_hour = datetime.datetime.utcnow().hour
    if current_utc_hour == 1 or not os.path.exists(DAILY_FILE):
        update_daily()
