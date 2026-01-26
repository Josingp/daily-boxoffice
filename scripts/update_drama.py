import os
import json
import requests
import time
from bs4 import BeautifulSoup
from datetime import datetime, timedelta

# --- [설정] ---
MAIN_FILE = "public/drama_data.json"
ARCHIVE_ROOT = "public/archive/drama" 
NIELSEN_URL = "https://www.nielsenkorea.co.kr/tv_terrestrial_day.asp?menu=Tit_1&sub_menu=1_1"

def fetch_nielsen_rating(date_str, area_code):
    params = { "area": area_code, "begin_date": date_str }
    headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" }

    try:
        response = requests.get(NIELSEN_URL, params=params, headers=headers, timeout=10)
        
        # [핵심 수정] 인코딩 자동 감지 (UTF-8 / EUC-KR 자동 대응)
        response.encoding = response.apparent_encoding 
        soup = BeautifulSoup(response.text, 'html.parser')
        
        results = []
        table = soup.find('table', class_='ranking_tb')
        if not table: return []

        rows = table.find_all('tr')
        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 4: continue
            try:
                rank_text = cols[0].get_text(strip=True)
                
                # [수정] 헤더(제목줄) 건너뛰기: 순위가 숫자가 아니면 스킵
                if not rank_text.isdigit(): 
                    continue
                
                # 데이터 정제
                title = cols[2].get_text(strip=True)
                rating_str = cols[3].get_text(strip=True).replace("\t", "").strip()
                
                # 시청률 숫자 변환
                try: rating_val = float(rating_str)
                except: rating_val = 0
                
                results.append({
                    "rank": rank_text,
                    "channel": cols[1].get_text(strip=True),
                    "title": title,
                    "rating": rating_str,      # 표시용
                    "ratingVal": rating_val,   # 그래프용
                    "area": "전국" if area_code == "00" else "수도권"
                })
            except: continue
        return results[:20] # 상위 20개까지 여유있게 수집
    except Exception as e:
        print(f"Error fetching {date_str}: {e}")
        return []

def update_drama_data():
    print("Starting Drama Update (Auto-Encoding & Clean Archive)...")
    today = datetime.now()
    
    # 트렌드 집계를 위한 딕셔너리
    trend_history = {} # { "드라마제목": [ {date, rating}, ... ] }
    latest_data = None
    latest_date_str = ""

    # 아카이브 폴더 생성
    if not os.path.exists(ARCHIVE_ROOT):
        os.makedirs(ARCHIVE_ROOT)
    
    # 최근 30일 데이터 수집
    for i in range(1, 31):
        target_date = today - timedelta(days=i)
        d_str = target_date.strftime("%Y%m%d")
        
        # 파일 경로 단순화: public/archive/drama/20260126.json
        f_path = os.path.join(ARCHIVE_ROOT, f"{d_str}.json")
        
        daily_json = None
        
        # 1. 파일이 있으면 로드
        if os.path.exists(f_path):
            try:
                with open(f_path, 'r', encoding='utf-8') as f:
                    daily_json = json.load(f)
            except: pass
        
        # 2. 없으면 크롤링
        if not daily_json:
            print(f"  [Fetch] {d_str}...")
            nw = fetch_nielsen_rating(d_str, "00")
            cp = fetch_nielsen_rating(d_str, "01")
            
            # 데이터가 유효한지 확인 (빈 리스트가 아니어야 함)
            if nw and len(nw) > 0:
                daily_json = { "date": d_str, "nationwide": nw, "capital": cp }
                with open(f_path, 'w', encoding='utf-8') as f:
                    json.dump(daily_json, f, ensure_ascii=False, indent=2)
                time.sleep(0.5)
            else:
                print(f"    ⚠️ No valid data for {d_str}")

        # 3. 트렌드 데이터 누적
        if daily_json:
            # 최신 날짜 데이터 확보 (메인 파일용)
            if latest_data is None:
                latest_data = daily_json
                latest_date_str = d_str
            
            # 전국 데이터 트렌드 수집
            for item in daily_json.get("nationwide", []):
                # 제목 공백 제거하여 매칭 확률 높임
                title = item['title'].replace(" ", "").strip()
                if title not in trend_history: trend_history[title] = []
                
                # 중복 날짜 방지
                if not any(x['date'] == d_str for x in trend_history[title]):
                    trend_history[title].append({ 
                        "date": d_str, 
                        "rating": item['ratingVal'] 
                    })

    # 4. 최신 데이터에 트렌드 정보 주입
    if latest_data:
        print(f"Injecting trend history for {latest_date_str}...")
        
        # 전국 리스트에 트렌드 추가
        for item in latest_data.get("nationwide", []):
            title_key = item['title'].replace(" ", "").strip()
            history = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
            item['trend'] = history
            
        # 수도권 리스트에 트렌드 추가 (전국 데이터 기반 트렌드 공유)
        for item in latest_data.get("capital", []):
            title_key = item['title'].replace(" ", "").strip()
            history = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
            item['trend'] = history

        # 메인 파일 저장
        if not os.path.exists("public"): os.makedirs("public")
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Main file updated: {latest_date_str}")
        
    else:
        # 데이터가 하나도 없을 경우 (에러 방지용 빈 파일)
        if not os.path.exists("public"): os.makedirs("public")
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump({"date":"", "nationwide":[], "capital":[]}, f)
        print("⚠️ No data found at all.")

if __name__ == "__main__":
    update_drama_data()
