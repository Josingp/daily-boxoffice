import os
import json
import requests
import datetime
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

# [설정] 프론트엔드가 찾는 파일명과 정확히 일치시킴
DAILY_FILE = "public/daily_data.json"
REALTIME_FILE = "public/realtime_data.json"

# GitHub Secrets에서 가져옴
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

def ensure_dir():
    if not os.path.exists("public"):
        os.makedirs("public")

# [실시간 예매율] 매 10분마다 실행
def update_realtime():
    print("Updating Realtime Data...")
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
    try:
        resp = requests.post(url, data={'dmlMode': 'search', 'allMovieYn': 'Y'}, timeout=15)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        history = {}

        # 기존 데이터 로드 (누적용)
        if os.path.exists(REALTIME_FILE):
            with open(REALTIME_FILE, 'r', encoding='utf-8') as f:
                try: history = json.load(f)
                except: pass

        for row in soup.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if int(rank) > 10: break # Top 10만
            
            # 영화 제목 추출
            a_tag = cols[1].find("a")
            title = a_tag["title"].strip() if (a_tag and a_tag.get("title")) else cols[1].get_text(strip=True)
            rate = cols[3].get_text(strip=True).replace('%', '')
            
            if title not in history: history[title] = []
            
            # 값이 바뀌었거나 시간이 지났으면 추가
            if not history[title] or history[title][-1]['time'] != timestamp:
                history[title].append({
                    "time": timestamp,
                    "rate": float(rate),
                    "rank": int(rank)
                })
                # 최근 144개(약 24시간) 유지
                if len(history[title]) > 144:
                    history[title] = history[title][-144:]

        with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
        print("Realtime Data Saved.")
        
    except Exception as e:
        print(f"Realtime Update Failed: {e}")

# [일별 박스오피스] 하루 한 번 실행
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
    
    # 일별 데이터는 없거나 특정 시간에만 업데이트
    if not os.path.exists(DAILY_FILE) or datetime.datetime.utcnow().hour == 1:
        update_daily()
