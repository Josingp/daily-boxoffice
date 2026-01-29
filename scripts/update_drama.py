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
NIELSEN_BASE_URL = "https://www.nielsenkorea.co.kr/tv_terrestrial_day.asp"
NAVER_SEARCH_URL = "https://search.naver.com/search.naver?where=nexearch&query="

# 닐슨코리아 메뉴 코드 (지상파, 종편, 케이블)
# sub_menu 형식: {매체}_{1:일일, 2:주간}
# 1: 지상파, 2: 종편, 3: 케이블
MEDIA_CODES = [
    {"code": "1", "name": "지상파"},
    {"code": "2", "name": "종편"},
    {"code": "3", "name": "케이블"}
]

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
        
        info = { "posterUrl": "", "broadcaster": "", "cast": "", "summary": "" }
        
        poster_img = soup.select_one(".detail_info .thumb img") or \
                     soup.select_one(".info_group .thumb img") or \
                     soup.select_one("img[src*='csearch-phinf']")
        if poster_img: info['posterUrl'] = poster_img.get('src')

        broadcast_info = soup.select_one(".info_group dt:-soup-contains('편성') + dd")
        if not broadcast_info: broadcast_info = soup.select_one(".info_group .text")
        if broadcast_info: info['broadcaster'] = broadcast_info.get_text(strip=True)

        cast_info = soup.select_one(".info_group dt:-soup-contains('출연') + dd")
        if cast_info: info['cast'] = cast_info.get_text(strip=True)
            
        desc_info = soup.select_one(".info_group dt:-soup-contains('소개') + dd")
        if desc_info: info['summary'] = desc_info.get_text(strip=True)

        return info
    except Exception as e:
        print(f"  Start scraping Naver failed for {clean_title}: {e}")
        return None

def fetch_combined_ranking(date_str, area_code, is_weekly=False):
    """
    지상파(1), 종편(2), 케이블(3) 데이터를 모두 가져와서 시청률 순으로 통합 정렬합니다.
    is_weekly=True 이면 주간 순위(x_2), False이면 일일 순위(x_1)를 가져옵니다.
    """
    sub_menu_suffix = "2" if is_weekly else "1"
    combined_results = []
    
    headers = { "User-Agent": "Mozilla/5.0" }

    for media in MEDIA_CODES:
        menu_code = media["code"]
        media_name = media["name"]
        
        params = {
            "menu": "Tit_1",
            "sub_menu": f"{menu_code}_{sub_menu_suffix}",
            "area": area_code,
            "begin_date": date_str
        }

        try:
            response = requests.get(NIELSEN_BASE_URL, params=params, headers=headers, timeout=10)
            response.encoding = response.apparent_encoding 
            soup = BeautifulSoup(response.text, 'html.parser')
            
            table = soup.find('table', class_='ranking_tb')
            if not table: continue

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
                    
                    combined_results.append({
                        "originalRank": int(rank_text),
                        "mediaType": media_name, # 지상파/종편/케이블 구분
                        "channel": cols[1].get_text(strip=True),
                        "title": title,
                        "rating": rating_str,
                        "ratingVal": rating_val,
                        "area": "전국" if area_code == "00" else "수도권"
                    })
                except: continue
            time.sleep(0.2) # 차단 방지용 짧은 대기
        except Exception as e:
            print(f"  Error fetching {media_name}: {e}")
            continue

    # 시청률(ratingVal) 기준으로 내림차순 정렬
    combined_results.sort(key=lambda x: x['ratingVal'], reverse=True)
    
    # 통합 순위(rank) 재부여 (1위부터 20위까지만 자름)
    final_list = []
    for idx, item in enumerate(combined_results[:20]): # 상위 20개만
        item['rank'] = idx + 1
        final_list.append(item)
        
    return final_list

def update_drama_data():
    print("Starting Integrated Drama Update (Terrestrial + Jongpyeon + Cable)...")
    
    kst_timezone = timezone(timedelta(hours=9))
    today = datetime.now(kst_timezone)
    
    trend_history = {}
    latest_data = None
    drama_details_cache = {} 

    if not os.path.exists(ARCHIVE_ROOT): os.makedirs(ARCHIVE_ROOT)
    
    # 1. 일일 데이터 수집 (최근 30일)
    for i in range(1, 31):
        target_date = today - timedelta(days=i)
        d_str = target_date.strftime("%Y%m%d")
        f_path = os.path.join(ARCHIVE_ROOT, f"{d_str}.json")
        
        daily_json = None
        if os.path.exists(f_path):
            try:
                with open(f_path, 'r', encoding='utf-8') as f: daily_json = json.load(f)
            except: pass
        
        if not daily_json:
            print(f"  [Fetch Daily Combined] {d_str}...")
            # 전국(00), 수도권(01) 각각 통합 수집
            nw = fetch_combined_ranking(d_str, "00", is_weekly=False)
            cp = fetch_combined_ranking(d_str, "01", is_weekly=False)
            
            if nw and len(nw) > 0:
                daily_json = { "date": d_str, "nationwide": nw, "capital": cp }
                with open(f_path, 'w', encoding='utf-8') as f:
                    json.dump(daily_json, f, ensure_ascii=False, indent=2)
                print(f"  ✅ Saved combined data for {d_str}")
                time.sleep(0.5)
            else:
                print(f"  ⚠️ No data yet for {d_str}")
        
        if daily_json:
            if latest_data is None: latest_data = daily_json
            
            # 트렌드 수집 (일일 데이터 기준)
            for item in daily_json.get("nationwide", []):
                title = item['title'].replace(" ", "").strip()
                if title not in trend_history: trend_history[title] = []
                if not any(x['date'] == d_str for x in trend_history[title]):
                    trend_history[title].append({ "date": d_str, "rating": item['ratingVal'] })

    # 2. 주간 데이터 수집 (최신 주간 랭킹 추가)
    if latest_data:
        print("Fetching Weekly Rankings...")
        # 주간 랭킹은 날짜를 넣으면 해당 주간을 자동으로 찾아줌 (보통 최근 데이터)
        # 그냥 어제 날짜를 넣어서 해당 주간 데이터를 가져옴
        yesterday_str = (today - timedelta(days=1)).strftime("%Y%m%d")
        
        weekly_nw = fetch_combined_ranking(yesterday_str, "00", is_weekly=True)
        weekly_cp = fetch_combined_ranking(yesterday_str, "01", is_weekly=True)
        
        latest_data["weekly_nationwide"] = weekly_nw
        latest_data["weekly_capital"] = weekly_cp

    # 3. 최신 데이터(일일+주간)에 Naver 정보 + 트렌드 주입
    if latest_data:
        print(f"Enriching data for {latest_data['date']} with Naver Info & Trends...")
        
        # 처리할 리스트들: 일일(전국/수도권) + 주간(전국/수도권)
        target_lists = [
            latest_data.get("nationwide", []),
            latest_data.get("capital", []),
            latest_data.get("weekly_nationwide", []),
            latest_data.get("weekly_capital", [])
        ]
        
        for lst in target_lists:
            for item in lst:
                # 트렌드는 일일 데이터 기반으로 매칭
                title_key = item['title'].replace(" ", "").strip()
                item['trend'] = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
                
                # 네이버 정보 크롤링
                raw_title = item['title']
                if raw_title not in drama_details_cache:
                    print(f"  [Scrape Naver] {raw_title}")
                    naver_info = get_naver_drama_info(raw_title)
                    if naver_info:
                        drama_details_cache[raw_title] = naver_info
                    time.sleep(0.5) # 딜레이
                
                if raw_title in drama_details_cache:
                    item.update(drama_details_cache[raw_title])

        # 메인 파일 저장
        if not os.path.exists("public"): os.makedirs("public")
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, ensure_ascii=False, indent=2)
        print("✅ Integrated Drama Data Updated (Daily & Weekly).")
        
    else:
        print("⚠️ No data found at all.")

if __name__ == "__main__":
    update_drama_data()
