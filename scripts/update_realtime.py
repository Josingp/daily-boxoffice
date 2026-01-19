import os
import json
import requests
import datetime
from bs4 import BeautifulSoup

DATA_FILE = "public/realtime_data.json"
URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def main():
    print("Fetching Realtime Data...")
    try:
        resp = requests.post(URL, data={'dmlMode': 'search', 'allMovieYn': 'Y'}, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        new_data = {}

        for row in soup.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if int(rank) > 10: break # Top 10만
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            rate = cols[3].get_text(strip=True).replace('%', '')
            
            new_data[title] = {
                "rank": rank,
                "rate": float(rate),
                "time": timestamp
            }

        # 기존 데이터 로드 및 병합
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                history = json.load(f)
        else:
            history = {}

        # 영화별로 이력 추가
        for title, info in new_data.items():
            if title not in history: history[title] = []
            # 중복 시간 제외하고 추가
            if not history[title] or history[title][-1]['time'] != timestamp:
                history[title].append(info)
                # 데이터가 너무 많으면 최근 72개(약 3일치)만 유지
                if len(history[title]) > 72:
                    history[title] = history[title][-72:]

        os.makedirs("public", exist_ok=True)
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
            
        print("Realtime data updated.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
