import os
import json
import requests
import time
import re
from bs4 import BeautifulSoup
from datetime import datetime, timedelta, timezone

# --- [설정] ---
MAIN_FILE = "public/drama_data.json"
ARCHIVE_ROOT = "public/archive/drama"
NIELSEN_URL = "https://www.nielsenkorea.co.kr/tv_terrestrial_day.asp?menu=Tit_1&sub_menu=1_1"
NAVER_SEARCH_URL = "https://search.naver.com/search.naver?where=nexearch&query="

def get_naver_drama_info(raw_title):
    """
    드라마 제목으로 네이버 검색 후 포스터와 기본 정보를 크롤링합니다.
    """
    clean_title = re.sub(r'\(.*?\)', '', raw_title).strip()
    clean_title = re.sub(r'기획.*', '', clean_title).strip()
    
    query = f"{clean_title} 드라마"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
    }
    
    try:
        res = requests.get(NAVER_SEARCH_URL + query, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        info = {
            "posterUrl": "",
            "broadcaster": "",
            "cast": "",
            "summary": ""
        }
        
        # A. 포스터 이미지
        poster_img = soup.select_one(".detail_info .thumb img") or \
                     soup.select_one(".info_group .thumb img") or \
                     soup.select_one("img[src*='csearch-phinf']")
                     
        if poster_img:
            info['posterUrl'] = poster_img.get('src')

        # B. 방송사 및 편성 정보 (deprecated 경고 수정: :contains -> :-soup-contains)
        broadcast_info = soup.select_one(".info_group dt:-soup-contains('편성') + dd")
        if not broadcast_info:
             broadcast_info = soup.select_one(".info_group .text")
             
        if broadcast_info:
            info['broadcaster'] = broadcast_info.get_text(strip=True)

        # C. 제작진/출연진
        cast_info = soup.select_one(".info_group dt:-soup-contains('출연') + dd")
        if cast_info:
            info['cast'] = cast_info.get_text(strip=True)
            
        # D. 소개글
        desc_info = soup.select_one(".info_group dt:-soup-contains('소개') + dd")
        if desc_info:
            info['summary'] = desc_info.get_text(strip=True)

        return info

    except Exception as e:
        print(f"  Start scraping Naver failed for {clean_title}: {e}")
        return None

def fetch_nielsen_rating(date_str, area_code):
    params = { "area": area_code, "begin_date": date_str }
    headers = { "User-Agent": "Mozilla/5.0" }

    try:
        response = requests.get(NIELSEN_URL, params=params, headers=headers, timeout=10)
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
                if not rank_text.isdigit(): continue
                
                title = cols[2].get_text(strip=True)
                rating_str = cols[3].get_text(strip=True).replace("\t", "").strip()
                try: rating_val = float(rating_str)
                except: rating_val = 0
                
                results.append({
                    "rank": rank_text,
                    "channel": cols[1].get_text(strip=True),
                    "title": title,
                    "rating": rating_str,
                    "ratingVal": rating_val,
                    "area": "전국" if area_code == "00" else "수도권"
                })
            except: continue
        return results[:20]
    except: return []

def update_drama_data():
    print("Starting Drama Update (Nielsen + Naver Crawling)...")
    
    # KST 기준 날짜 설정
    kst_timezone = timezone(timedelta(hours=9))
    today = datetime.now(kst_timezone)
    
    # 1. 닐슨 데이터 수집 (최근 30일)
    trend_history = {}
    latest_data = None
    
    drama_details_cache = {} 

    if not os.path.exists(ARCHIVE_ROOT): os.makedirs(ARCHIVE_ROOT)
    
    for i in range(1, 31):
        target_date = today - timedelta(days=i)
        d_str = target_date.strftime("%Y%m%d")
        f_path = os.path.join(ARCHIVE_ROOT, f"{d_str}.json")
        
        daily_json = None
        # 이미 파일이 있으면 로드 (재시도 시 API 호출 절약)
        if os.path.exists(f_path):
            try:
                with open(f_path, 'r', encoding='utf-8') as f: daily_json = json.load(f)
            except: pass
        
        # 파일이 없으면 새로 수집 시도
        if not daily_json:
            print(f"  [Fetch Nielsen] {d_str}...")
            nw = fetch_nielsen_rating(d_str, "00")
            cp = fetch_nielsen_rating(d_str, "01")
            
            # [중요] 데이터가 실제로 존재할 때만 파일 저장
            if nw and len(nw) > 0:
                daily_json = { "date": d_str, "nationwide": nw, "capital": cp }
                with open(f_path, 'w', encoding='utf-8') as f:
                    json.dump(daily_json, f, ensure_ascii=False, indent=2)
                print(f"  ✅ Saved data for {d_str}")
                time.sleep(0.5)
            else:
                print(f"  ⚠️ No data yet for {d_str}")
        
        if daily_json:
            if latest_data is None: latest_data = daily_json
            
            # 트렌드 수집
            for item in daily_json.get("nationwide", []):
                title = item['title'].replace(" ", "").strip()
                if title not in trend_history: trend_history[title] = []
                if not any(x['date'] == d_str for x in trend_history[title]):
                    trend_history[title].append({ "date": d_str, "rating": item['ratingVal'] })

    # 2. 최신 데이터에 Naver 정보 + 트렌드 주입
    if latest_data:
        print(f"Enriching data for {latest_data['date']} with Naver Info & Trends...")
        
        # 전국 데이터 처리
        for item in latest_data.get("nationwide", []):
            title_key = item['title'].replace(" ", "").strip()
            item['trend'] = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
            
            raw_title = item['title']
            if raw_title not in drama_details_cache:
                print(f"  [Scrape Naver] {raw_title}")
                naver_info = get_naver_drama_info(raw_title)
                if naver_info:
                    drama_details_cache[raw_title] = naver_info
                time.sleep(1)
            
            if raw_title in drama_details_cache:
                item.update(drama_details_cache[raw_title])

        # 수도권 데이터 처리
        for item in latest_data.get("capital", []):
            title_key = item['title'].replace(" ", "").strip()
            item['trend'] = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
            
            raw_title = item['title']
            if raw_title in drama_details_cache:
                item.update(drama_details_cache[raw_title])
            else:
                print(f"  [Scrape Naver] {raw_title}")
                naver_info = get_naver_drama_info(raw_title)
                if naver_info:
                    drama_details_cache[raw_title] = naver_info
                    item.update(naver_info)
                time.sleep(1)

        # 메인 파일 저장
        if not os.path.exists("public"): os.makedirs("public")
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, ensure_ascii=False, indent=2)
        print("✅ Drama Data Updated with Poster & Info.")
        
    else:
        print("⚠️ No data found at all.")

if __name__ == "__main__":
    update_drama_data()
