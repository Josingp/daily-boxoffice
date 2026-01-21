import os
import json
import requests
import re
import datetime
import time
from bs4 import BeautifulSoup

REALTIME_FILE = "public/realtime_data.json"
DAILY_FILE = "public/daily_data.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

MSTVIEW_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

def load_json(filepath):
    if os.path.exists(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            try: return json.load(f)
            except: pass
    return {}

def fetch_movie_detail(movie_cd):
    if not KOBIS_API_KEY or not movie_cd: return None
    try:
        url = f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie_cd}"
        res = requests.get(url, timeout=3)
        return res.json().get("movieInfoResult", {}).get("movieInfo")
    except: return None

def is_same_data(last, new):
    if not last: return False
    return (
        last['rank'] == new['rank'] and
        last['rate'] == new['rate'] and
        last['audiCnt'] == new['audiCnt']
    )

def update_realtime():
    print("Updating Realtime Data...")
    
    realtime_data = load_json(REALTIME_FILE)
    daily_data = load_json(DAILY_FILE)
    
    detail_cache_cd = {}
    detail_cache_title = {}
    
    if "movies" in daily_data:
        for m in daily_data["movies"]:
            if "detail" in m:
                if "movieCd" in m: detail_cache_cd[m["movieCd"]] = m["detail"]
                if "movieNm" in m: detail_cache_title[m["movieNm"].replace(" ", "")] = m["detail"]

    session = requests.Session()
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=20)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        crawled_time = ""
        try:
            txt = soup.get_text()
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", txt)
            if match: crawled_time = match.group(1).replace("/", "-")
        except: pass
        if not crawled_time: crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        rows = soup.find_all("tr")
        count = 0
        if "meta" not in realtime_data: realtime_data["meta"] = {}

        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if not rank.isdigit(): continue
            
            target_link = row.find("a", onclick=MSTVIEW_REGEX.search)
            title = ""
            movie_cd = ""
            
            if target_link:
                title = target_link.get("title", "").strip() or target_link.get_text(strip=True)
                match = MSTVIEW_REGEX.search(target_link['onclick'])
                if match: movie_cd = match.group(1)
            else:
                title = cols[1].get_text(strip=True)
            
            if not title: continue
            
            # 상세정보 확보 (캐시 -> API)
            if title not in realtime_data["meta"]:
                found_detail = None
                norm_title = title.replace(" ", "")
                
                if movie_cd and movie_cd in detail_cache_cd:
                    found_detail = detail_cache_cd[movie_cd]
                elif norm_title in detail_cache_title:
                    found_detail = detail_cache_title[norm_title]
                elif movie_cd and int(rank) <= 30:
                    found_detail = fetch_movie_detail(movie_cd)
                    if found_detail: time.sleep(0.1)

                if found_detail: realtime_data["meta"][title] = found_detail

            rate = cols[3].get_text(strip=True).replace('%', '')
            audi_cnt_raw = cols[6].get_text(strip=True)
            sales_amt_raw = cols[4].get_text(strip=True)
            audi_acc_raw = cols[7].get_text(strip=True)
            sales_acc_raw = cols[5].get_text(strip=True)

            if title not in realtime_data: realtime_data[title] = []
            
            new_entry = {
                "time": crawled_time,
                "rank": int(rank),
                "rate": float(rate) if rate else 0,
                "audiCnt": audi_cnt_raw, 
                "salesAmt": sales_amt_raw,
                "audiAcc": audi_acc_raw,
                "salesAcc": sales_acc_raw,
                "val_audi": int(audi_cnt_raw.replace(',', '')) if audi_cnt_raw.replace(',', '').isdigit() else 0,
                "val_rate": float(rate) if rate else 0
            }
            
            last = realtime_data[title][-1] if realtime_data[title] else None
            
            if is_same_data(last, new_entry):
                realtime_data[title][-1]['time'] = crawled_time
            else:
                realtime_data[title].append(new_entry)
            
            if len(realtime_data[title]) > 288:
                realtime_data[title] = realtime_data[title][-288:]
            
            count += 1

        if count > 0:
            os.makedirs("public", exist_ok=True)
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(realtime_data, f, ensure_ascii=False, indent=2)
            print(f"Updated {count} movies at {crawled_time}")

    except Exception as e:
        print(f"Update Failed: {e}")

if __name__ == "__main__":
    if not os.path.exists("public"): os.makedirs("public")
    update_realtime()
