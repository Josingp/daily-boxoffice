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

# 매체 코드 (1:지상파, 2:종편, 3:케이블)
MEDIA_TYPES = [
    {'code': '1', 'name': '지상파'},
    {'code': '2', 'name': '종편'},
    {'code': '3', 'name': '케이블'}
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
        
        # 포스터
        poster_img = soup.select_one(".detail_info .thumb img") or \
                     soup.select_one(".info_group .thumb img") or \
                     soup.select_one("img[src*='csearch-phinf']")
        if poster_img: info['posterUrl'] = poster_img.get('src')

        # 편성
        broadcast_info = soup.select_one(".info_group dt:-soup-contains('편성') + dd")
        if not broadcast_info: broadcast_info = soup.select_one(".info_group .text")
        if broadcast_info: info['broadcaster'] = broadcast_info.get_text(strip=True)

        # 출연
        cast_info = soup.select_one(".info_group dt:-soup-contains('출연') + dd")
        if cast_info: info['cast'] = cast_info.get_text(strip=True)
            
        # 소개
        desc_info = soup.select_one(".info_group dt:-soup-contains('소개') + dd")
        if desc_info: info['summary'] = desc_info.get_text(strip=True)

        return info
    except Exception as e:
        print(f"  Start scraping Naver failed for {clean_title}: {e}")
        return None

def fetch_integrated_ranking(date_str, area_code, is_weekly=False):
    """
    지상파(1)+종편(2)+케이블(3) 데이터를 모두 가져와 하나로 합친 뒤 시청률 순으로 정렬합니다.
    """
    combined_list = []
    # sub_menu: 일일은 1, 주간은 2 (예: 지상파 일일=1_1, 지상파 주간=1_2)
    period_code = "2" if is_weekly else "1"
    
    headers = { "User-Agent": "Mozilla/5.0" }

    # 3개 매체 반복 수집
    for media in MEDIA_TYPES:
        menu_code = media['code']
        media_name = media['name']
        
        params = {
            "menu": "Tit_1",
            "sub_menu": f"{menu_code}_{period_code}", # 1_1, 2_1, 3_1 ...
            "area": area_code,
            "begin_date": date_str
        }
        
        try:
            res = requests.get(NIELSEN_BASE_URL, params=params, headers=headers, timeout=10)
            res.encoding = res.apparent_encoding
            soup = BeautifulSoup(res.text, 'html.parser')
            
            table = soup.find('table', class_='ranking_tb')
            if not table: continue
            
            rows = table.find_all('tr')
            for row in rows:
                cols = row.find_all('td')
                if len(cols) < 4: continue
                
                # 순위(rank)는 무시하고 시청률만 추출 (나중에 재정렬할 것이므로)
                try:
                    title = cols[2].get_text(strip=True)
                    rating_str = cols[3].get_text(strip=True).replace("\t", "").strip()
                    # 탭 문자 제거 및 숫자 변환
                    rating_val = float(rating_str.replace(',', '')) if rating_str else 0.0
                    
                    combined_list.append({
                        "channel": cols[1].get_text(strip=True),
                        "title": title,
                        "rating": rating_str,
                        "ratingVal": rating_val,
                        "mediaType": media_name, # 지상파/종편/케이블 표시
                        "area": "전국" if area_code == "00" else "수도권"
                    })
                except: continue
                
            time.sleep(0.1) # 매체 간 짧은 텀
            
        except Exception as e:
            print(f"  Error fetching {media_name}: {e}")

    # 통합 리스트를 시청률 순(내림차순) 정렬
    combined_list.sort(key=lambda x: x['ratingVal'], reverse=True)
    
    # 통합 순위 부여 (상위 20개만 자름)
    final_list = []
    for idx, item in enumerate(combined_list[:20]):
        item['rank'] = idx + 1
        final_list.append(item)
        
    return final_list

def is_data_complete(data_list):
    """
    데이터 리스트가 통합 데이터인지 확인 (종편/케이블 포함 여부)
    """
    if not data_list: return False
    # 리스트에 '지상파' 외의 다른 매체('종편' or '케이블')가 하나라도 있으면 통합된 것으로 간주
    has_others = any(item.get('mediaType') in ['종편', '케이블'] for item in data_list)
    # 또는 mediaType 필드 자체가 있는지도 확인
    has_field = any('mediaType' in item for item in data_list)
    return has_others or (has_field and len(data_list) > 10)

def update_drama_data():
    print("Starting Integrated Drama Update (Terrestrial + Jongpyeon + Cable)...")
    
    # KST 날짜 계산
    kst_timezone = timezone(timedelta(hours=9))
    today = datetime.now(kst_timezone)
    
    trend_history = {}
    latest_data = None
    drama_details_cache = {} 

    if not os.path.exists(ARCHIVE_ROOT): os.makedirs(ARCHIVE_ROOT)
    
    # --- [A] 일일 데이터 수집 (과거 30일) ---
    for i in range(1, 31):
        target_date = today - timedelta(days=i)
        d_str = target_date.strftime("%Y%m%d")
        f_path = os.path.join(ARCHIVE_ROOT, f"{d_str}.json")
        
        need_fetch = True
        daily_json = None

        # 파일이 존재하면 로드해서 검사
        if os.path.exists(f_path):
            try:
                with open(f_path, 'r', encoding='utf-8') as f: 
                    daily_json = json.load(f)
                
                # [핵심] 기존 데이터가 '지상파만' 있는 반쪽짜리 데이터인지 확인
                nw_list = daily_json.get("nationwide", [])
                if is_data_complete(nw_list):
                    need_fetch = False
                    print(f"  [Skip] {d_str} (Already integrated)")
                else:
                    print(f"  [Reload] {d_str} (Found incomplete data, re-fetching...)")
                    need_fetch = True
            except: 
                need_fetch = True
        
        # 데이터가 없거나, 불완전하면 새로 수집
        if need_fetch:
            print(f"  [Fetch Daily Integrated] {d_str}...")
            nw = fetch_integrated_ranking(d_str, "00", is_weekly=False)
            cp = fetch_integrated_ranking(d_str, "01", is_weekly=False)
            
            if nw and len(nw) > 0:
                daily_json = { "date": d_str, "nationwide": nw, "capital": cp }
                with open(f_path, 'w', encoding='utf-8') as f:
                    json.dump(daily_json, f, ensure_ascii=False, indent=2)
                print(f"  ✅ Saved integrated data for {d_str}")
                time.sleep(0.5)
            else:
                print(f"  ⚠️ No data available for {d_str}")
                daily_json = None # 수집 실패 처리
        
        # 트렌드용 히스토리 축적
        if daily_json:
            if latest_data is None: latest_data = daily_json
            
            for item in daily_json.get("nationwide", []):
                title = item['title'].replace(" ", "").strip()
                if title not in trend_history: trend_history[title] = []
                if not any(x['date'] == d_str for x in trend_history[title]):
                    trend_history[title].append({ "date": d_str, "rating": item['ratingVal'] })

    # --- [B] 주간 데이터 수집 (최신 주간) ---
    if latest_data:
        print("Fetching Weekly Integrated Rankings...")
        # 어제 날짜 기준으로 해당 주간 랭킹을 가져옴
        yesterday_str = (today - timedelta(days=1)).strftime("%Y%m%d")
        
        weekly_nw = fetch_integrated_ranking(yesterday_str, "00", is_weekly=True)
        weekly_cp = fetch_integrated_ranking(yesterday_str, "01", is_weekly=True)
        
        latest_data["weekly_nationwide"] = weekly_nw
        latest_data["weekly_capital"] = weekly_cp

    # --- [C] 네이버 정보 & 트렌드 병합 ---
    if latest_data:
        print(f"Enriching data with Naver Info & Trends...")
        
        # 일일(전국/수도권) + 주간(전국/수도권) 모두 순회하며 정보 채우기
        target_lists = [
            latest_data.get("nationwide", []),
            latest_data.get("capital", []),
            latest_data.get("weekly_nationwide", []),
            latest_data.get("weekly_capital", [])
        ]
        
        for lst in target_lists:
            if not lst: continue
            for item in lst:
                # 트렌드 매핑
                title_key = item['title'].replace(" ", "").strip()
                item['trend'] = sorted(trend_history.get(title_key, []), key=lambda x: x['date'])
                
                # 네이버 크롤링 (캐시 활용)
                raw_title = item['title']
                if raw_title not in drama_details_cache:
                    print(f"  [Scrape Naver] {raw_title}")
                    naver_info = get_naver_drama_info(raw_title)
                    if naver_info:
                        drama_details_cache[raw_title] = naver_info
                    time.sleep(0.5) 
                
                if raw_title in drama_details_cache:
                    item.update(drama_details_cache[raw_title])

        # 최종 저장
        if not os.path.exists("public"): os.makedirs("public")
        with open(MAIN_FILE, 'w', encoding='utf-8') as f:
            json.dump(latest_data, f, ensure_ascii=False, indent=2)
        print("✅ Integrated Drama Data Updated (Daily & Weekly).")
        
    else:
        print("⚠️ No data found at all.")

if __name__ == "__main__":
    update_drama_data()
