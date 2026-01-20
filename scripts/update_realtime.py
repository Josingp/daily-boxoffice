import os
import json
import requests
import re
import datetime
from bs4 import BeautifulSoup

REALTIME_FILE = "public/realtime_data.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def ensure_dir():
    if not os.path.exists("public"):
        os.makedirs("public")

def update_realtime():
    print("Updating Realtime Data...")
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': KOBIS_REALTIME_URL,
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=20)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # [수정] 조회일시 추출
        crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        try:
            time_tag = soup.find(string=re.compile("조회일시"))
            if time_tag:
                match = re.search(r"(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", time_tag)
                if match: crawled_time = match.group(1).replace("/", "-")
        except: pass

        history = {}
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
            
            # [수정] 정확한 인덱스: 3(예매율), 6(예매관객)
            rate = cols[3].get_text(strip=True).replace('%', '')
            audiCnt = cols[6].get_text(strip=True).replace(',', '')
            
            if title not in history: history[title] = []
            
            # 시간 중복 방지
            if not history[title] or history[title][-1]['time'] != crawled_time:
                history[title].append({
                    "time": crawled_time,
                    "rate": float(rate) if rate else 0,
                    "audiCnt": int(audiCnt) if audiCnt.isdigit() else 0, # 관객수도 저장
                    "rank": int(rank)
                })
                if len(history[title]) > 144: history[title] = history[title][-144:]
            count += 1

        if count > 0:
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            print(f"Realtime Data Saved ({count} movies). Time: {crawled_time}")
        
    except Exception as e:
        print(f"Realtime Update Failed: {e}")

if __name__ == "__main__":
    ensure_dir()
    update_realtime()
