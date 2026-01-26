import os
import json
import requests
import time
from bs4 import BeautifulSoup
from datetime import datetime, timedelta

# --- [설정] ---
MAIN_FILE = "public/drama_data.json"
ARCHIVE_ROOT = "public/archive/drama" # 폴더 구조 단순화
NIELSEN_URL = "https://www.nielsenkorea.co.kr/tv_terrestrial_day.asp?menu=Tit_1&sub_menu=1_1"

def fetch_nielsen_rating(date_str, area_code):
    params = { "area": area_code, "begin_date": date_str }
    headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" }

    try:
        response = requests.get(NIELSEN_URL, params=params, headers=headers, timeout=5)
        
        # [핵심] 한글 깨짐 방지: 바이트를 직접 EUC-KR로 디코딩 (에러 발생 시 대체 문자로 치환)
        html_content = response.content.decode('euc-kr', 'replace')
        soup = BeautifulSoup(html_content, 'html.parser')
        
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
                
                # 데이터 정제
                title = cols[2].get_text(strip=True)
                rating_str = cols[3].get_text(strip=True).replace("\t", "").strip()
                
                # 시청률을 숫자로 변환 가능한지 확인 (그래프용)
                try: rating_val = float(rating_str)
                except: rating_val = 0
                
                results.append({
                    "rank": rank,
                    "channel": cols[1].get_text(strip=True),
                    "title": title,
                    "rating": rating_str,      # 화면 표시용 (문자열)
                    "ratingVal": rating_val,   # 그래프용 (숫자)
                    "area": "전국" if area_code == "00" else "수도권"
                })
            except: continue
        return results[:10]
    except Exception as e:
        print(f"Error fetching {date_str}: {e}")
        return []

def update_drama_data():
    print("Starting Drama Update (Fixed Encoding & Trends)...")
    today = datetime.now()
    
    # 트렌드 집계를 위한 딕셔너리
    # 구조: { "드라마제목": [ {date: "20260101", rating: 15.4}, ... ] }
    trend_history = {}

    latest_data = None
    latest_date_str = ""

    # 폴더 생성
    if not os.path.exists(ARCHIVE_ROOT):
        os.makedirs(ARCHIVE_ROOT)
    
    # 최근 30일 데이터 수집 및 병합
    for i in range(1, 31):
        # 날짜 역순 계산 (어제 -> 30일 전)
        target_date = today - timedelta(days=i)
        d_str = target_date.strftime("%Y%m%d")
        
        # 폴더 구조 단순화: public/archive/drama/20260126.json
        f_path = os.path.join(ARCHIVE_ROOT, f"{d_str}.json")
        
        daily_json = None
        
        # 1. 아카이브 확인
        if os.path.exists(f_path):
            try:
                with open(f_path, 'r', encoding='utf-8') as f:
                    daily_json = json.load(f)
            except: pass
        
        # 2. 없으면 수집
        if not daily_json:
            print(f"  [Fetch] {d_str}...")
            nw = fetch_nielsen_rating(d_str, "00")
            cp = fetch_nielsen_rating(d_str, "01")
            
            if nw or cp:
                daily_json = { "date": d_str, "nationwide": nw, "capital": cp }
                with open(f_path, 'w', encoding='utf-8') as f:
                    json.dump(daily_json, f, ensure_ascii=False, indent=2)
                time.sleep(0.5)
            else:
                print(f"    ⚠️ No data for {d_str}")

        # 3. 트렌드 데이터 누적 (History Building)
        if daily_json:
            # 가장 최신 데이터(어제)는 메인 파일용으로 저장하기 위해 잡아둠
            if latest_data is None:
                latest_data = daily_json
                latest_date_str = d_str
            
            # 전국 기준 트렌드 수집
            for item in daily_json.get("nationwide", []):
                title = item['title'].replace(" ", "") # 공백 제거로 매칭률 상승
                if title not in trend_history: trend_history[title] = []
                trend_history[title].append({ "date": d_str, "rating": item['ratingVal'] })
            
            # 수도권 기준 트렌드 수집
            for item in daily_json.get("capital", []):
                title = item['title'].replace(" ", "")
                if title not in trend_history: trend_history[title] = []
                # 날짜 중복 방지 (전국/수도권 타이틀 같을 경우 대비)
                existing = next((x for x in trend_history[title] if x['date'] == d_str), None)
                if not existing:
                    trend_history[title].append({ "date": d_str, "rating": item['ratingVal'] })

    # 4. 최신 데이터에 트렌드 정보 주입 (Injection)
    if latest_data:
        print("Injecting trend history...")
        
        # 전국 리스트에 트렌드 추가
        for item in latest_data.get("nationwide", []):
            title_key = item['title'].replace(" ", "")
            # 날짜 오름차순 정렬
            history = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
            item['trend'] = history
            
        # 수도권 리스트에 트렌드 추가
        for item in latest_data.get("capital", []):
            title_key = item['title'].replace(" ", "")
            history = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
            item['trend'] = history

        # 메인 파일 저장
        if not os.path.exists("public"): os.makedirs("public")
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Main file updated: {latest_date_str} (Encoding Fixed)")
        
    else:
        # 데이터가 없을 경우 빈 파일
        if not os.path.exists("public"): os.makedirs("public")
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump({"date":"", "nationwide":[], "capital":[]}, f)
        print("⚠️ No data found.")

if __name__ == "__main__":
    update_drama_data()
