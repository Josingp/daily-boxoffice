import os
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta

# --- [설정] ---
DRAMA_FILE = "public/drama_data.json"
# 닐슨코리아 URL 패턴
NIELSEN_URL = "https://www.nielsenkorea.co.kr/tv_terrestrial_day.asp?menu=Tit_1&sub_menu=1_1"

def fetch_nielsen_rating(date_str, area_code):
    """
    area_code: 00(전국), 01(수도권)
    """
    params = {
        "area": area_code,
        "begin_date": date_str
    }
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    try:
        response = requests.get(NIELSEN_URL, params=params, headers=headers)
        response.encoding = 'euc-kr' # 닐슨코리아는 EUC-KR 사용
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 닐슨코리아 테이블 구조 파싱 (상위 20위)
        results = []
        table = soup.find('table', class_='ranking_tb')
        
        if not table:
            return []

        rows = table.find_all('tr')
        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 4: continue
            
            # 데이터 추출: 순위, 채널, 프로그램명, 시청률
            try:
                rank = cols[0].get_text(strip=True)
                channel = cols[1].get_text(strip=True)
                title = cols[2].get_text(strip=True)
                rating = cols[3].get_text(strip=True).replace("\t", "").replace("\r", "").replace("\n", "").strip()
                
                results.append({
                    "rank": rank,
                    "channel": channel,
                    "title": title,
                    "rating": rating, # 문자열 그대로 유지 (예: 15.4)
                    "area": "전국" if area_code == "00" else "수도권"
                })
            except:
                continue
                
        return results[:10] # 상위 10개만 저장

    except Exception as e:
        print(f"Error fetching Nielsen data ({area_code}): {e}")
        return []

def update_drama_data():
    # 어제 날짜 기준 (닐슨은 당일 데이터가 다음날 나옴)
    today = datetime.now()
    yesterday = (today - timedelta(days=1)).strftime("%Y%m%d")
    
    print(f"Fetching Drama Ratings for {yesterday}...")
    
    # 1. 전국 데이터
    nationwide = fetch_nielsen_rating(yesterday, "00")
    # 2. 수도권 데이터
    capital = fetch_nielsen_rating(yesterday, "01")
    
    data = {
        "date": yesterday,
        "nationwide": nationwide,
        "capital": capital
    }
    
    # 저장
    if not os.path.exists("public"):
        os.makedirs("public")
        
    with open(DRAMA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        
    print(f"✅ Saved {len(nationwide)} nationwide and {len(capital)} capital items.")

if __name__ == "__main__":
    update_drama_data()
