import os
import json
import requests
import time
from bs4 import BeautifulSoup
from datetime import datetime, timedelta

# --- [설정] ---
MAIN_FILE = "public/drama_data.json"
ARCHIVE_DIR = "public/archive/drama"
NIELSEN_URL = "https://www.nielsenkorea.co.kr/tv_terrestrial_day.asp?menu=Tit_1&sub_menu=1_1"

def fetch_nielsen_rating(date_str, area_code):
    params = { "area": area_code, "begin_date": date_str }
    headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" }

    try:
        response = requests.get(NIELSEN_URL, params=params, headers=headers, timeout=10)
        response.encoding = 'euc-kr'
        soup = BeautifulSoup(response.text, 'html.parser')
        
        results = []
        table = soup.find('table', class_='ranking_tb')
        if not table: return []

        rows = table.find_all('tr')
        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 4: continue
            try:
                rank = cols[0].get_text(strip=True)
                if not rank: continue
                title = cols[2].get_text(strip=True)
                rating = cols[3].get_text(strip=True).replace("\t", "").strip()
                results.append({
                    "rank": rank,
                    "channel": cols[1].get_text(strip=True),
                    "title": title,
                    "rating": rating,
                    "area": "전국" if area_code == "00" else "수도권"
                })
            except: continue
        return results[:10]
    except Exception as e:
        print(f"Error fetching {date_str}: {e}")
        return []

def update_drama_data():
    print("Starting Drama Update...")
    today = datetime.now()
    end_date = today - timedelta(days=1)
    start_date = end_date - timedelta(days=30)
    
    current = start_date
    latest_data = None 

    # 30일간의 데이터를 순회
    while current <= end_date:
        d_str = current.strftime("%Y%m%d")
        f_path = os.path.join(ARCHIVE_DIR, d_str[:4], d_str[4:6], f"{d_str}.json")
        
        # 이미 수집된 날짜는 건너뛰기 (속도 향상)
        if os.path.exists(f_path):
            print(f"  [Skip] {d_str}")
            try: 
                with open(f_path, 'r', encoding='utf-8') as f: latest_data = json.load(f)
            except: pass
        else:
            print(f"  [Fetch] {d_str}...")
            nw = fetch_nielsen_rating(d_str, "00")
            cp = fetch_nielsen_rating(d_str, "01")
            
            # 데이터가 있으면 저장
            if nw or cp:
                data = { "date": d_str, "nationwide": nw, "capital": cp }
                os.makedirs(os.path.dirname(f_path), exist_ok=True)
                with open(f_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                latest_data = data
                print("    ✅ Saved.")
                time.sleep(1)
            else:
                print("    ⚠️ No data.")
        
        current += timedelta(days=1)

    # [중요] public 폴더가 없으면 생성
    if not os.path.exists("public"): os.makedirs("public")
    
    # 최신 데이터로 메인 파일 생성 (없으면 빈 파일 생성)
    if latest_data:
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Updated main file with {latest_data['date']}")
    else:
        # 데이터가 하나도 없을 경우 빈 껍데기 파일 생성 -> 404 에러 방지
        empty_data = { "date": end_date.strftime("%Y%m%d"), "nationwide": [], "capital": [] }
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(empty_data, f, ensure_ascii=False, indent=2)
        print("⚠️ Created empty file (No data found).")

if __name__ == "__main__":
    update_drama_data()
