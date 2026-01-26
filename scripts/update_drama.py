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
    headers = { "User-Agent": "Mozilla/5.0" }
    try:
        response = requests.get(NIELSEN_URL, params=params, headers=headers, timeout=5)
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
                results.append({
                    "rank": rank,
                    "channel": cols[1].get_text(strip=True),
                    "title": cols[2].get_text(strip=True),
                    "rating": cols[3].get_text(strip=True).replace("\t", "").strip(),
                    "area": "전국" if area_code == "00" else "수도권"
                })
            except: continue
        return results[:10]
    except: return []

def update_drama_data():
    print("Starting Drama Update (Smart Skip Mode)...")
    today = datetime.now()
    
    # [최적화] 최근 날짜부터 과거로 거슬러 올라감
    # 최근 데이터가 이미 있다면, 굳이 먼 과거까지 확인할 필요 없음
    consecutive_hits = 0 # 연속으로 파일을 찾은 횟수
    
    latest_data = None
    
    # 최근 30일 검사
    for i in range(1, 31):
        target_date = today - timedelta(days=i)
        d_str = target_date.strftime("%Y%m%d")
        f_path = os.path.join(ARCHIVE_DIR, d_str[:4], d_str[4:6], f"{d_str}.json")
        
        # 1. 파일이 이미 있으면?
        if os.path.exists(f_path):
            consecutive_hits += 1
            print(f"  [Skip] {d_str} (Already exists) - Hit {consecutive_hits}")
            
            # 최신 데이터 확보용 로드
            if not latest_data:
                try: 
                    with open(f_path, 'r', encoding='utf-8') as f: latest_data = json.load(f)
                except: pass
            
            # [핵심] 이미 있는 파일이 3일 연속 발견되면, 그 이전도 다 있다고 판단하고 종료
            if consecutive_hits >= 3:
                print("  ⚡ Smart Skip activated: Found existing history, stopping early.")
                break
            continue
            
        # 2. 파일이 없으면? (수집 진행)
        consecutive_hits = 0 # 연속 카운트 초기화
        print(f"  [Fetch] {d_str}...")
        
        nw = fetch_nielsen_rating(d_str, "00")
        cp = fetch_nielsen_rating(d_str, "01")
        
        if nw or cp:
            data = { "date": d_str, "nationwide": nw, "capital": cp }
            os.makedirs(os.path.dirname(f_path), exist_ok=True)
            with open(f_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            if not latest_data: latest_data = data
            print("    ✅ Saved.")
            time.sleep(0.5) # 대기 시간 단축
        else:
            print("    ⚠️ No data found.")

    # 메인 파일 생성
    if not os.path.exists("public"): os.makedirs("public")
    if latest_data:
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Main file updated: {latest_data['date']}")
    else:
        # 데이터가 없어도 빈 파일 생성 (에러 방지)
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump({"date":"", "nationwide":[], "capital":[]}, f)

if __name__ == "__main__":
    update_drama_data()
