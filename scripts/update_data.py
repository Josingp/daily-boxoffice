import os
import json
import requests
import datetime
from bs4 import BeautifulSoup

# [설정]
DATA_FILE = "public/history.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def get_realtime_top10():
    try:
        # KOBIS 크롤링 (api/index.py와 동일 로직)
        headers = {'User-Agent': 'Mozilla/5.0'}
        data = {'dmlMode': 'search', 'allMovieYn': 'Y'}
        resp = requests.post(KOBIS_REALTIME_URL, headers=headers, data=data, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        results = []
        rows = soup.find_all("tr")
        
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if int(rank) > 10: break # Top 10만 기록
            
            # 영화 제목
            a_tag = cols[1].find("a")
            title = a_tag["title"].strip() if (a_tag and a_tag.get("title")) else cols[1].get_text(strip=True)
            
            # 예매율 (숫자만 추출)
            rate = cols[3].get_text(strip=True).replace('%', '')
            
            results.append({
                "rank": rank,
                "title": title,
                "rate": float(rate)
            })
            
        return results
    except Exception as e:
        print(f"Error fetching data: {e}")
        return []

def update_json():
    # 1. 기존 데이터 로드
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            try:
                history = json.load(f)
            except:
                history = {}
    else:
        history = {}

    # 2. 새 데이터 가져오기
    top10 = get_realtime_top10()
    if not top10: return

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    
    # 3. 데이터 구조 변환 (영화별로 묶기)
    # history = { "영화제목": [ { "time": "...", "rate": 15.5, "rank": 1 }, ... ] }
    for movie in top10:
        title = movie['title']
        if title not in history:
            history[title] = []
        
        # 중복 방지 (가장 최근 데이터와 시간이 같으면 패스)
        if history[title] and history[title][-1]['time'] == timestamp:
            continue
            
        history[title].append({
            "time": timestamp,
            "rate": movie['rate'],
            "rank": movie['rank']
        })
        
        # 데이터 너무 많이 쌓이면 최근 100개만 유지
        if len(history[title]) > 100:
            history[title] = history[title][-100:]

    # 4. 저장
    os.makedirs("public", exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    
    print(f"Updated Top 10 at {timestamp}")

if __name__ == "__main__":
    update_json()
