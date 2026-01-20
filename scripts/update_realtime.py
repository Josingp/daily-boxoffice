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
        
        # [1] 조회일시 파싱 (HTML 내 텍스트 추출)
        crawled_time = ""
        try:
            # "조회일시"가 포함된 텍스트 노드 찾기
            time_node = soup.find(string=re.compile("조회일시"))
            if time_node:
                # 2026/01/20 15:39 형식 추출
                match = re.search(r"(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", time_node)
                if match: 
                    crawled_time = match.group(1).replace("/", "-")
        except: pass
        
        # 실패 시 시스템 시간 (Fallback)
        if not crawled_time:
            crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        # [2] 기존 데이터 로드 (누적을 위해)
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
            if not rank.isdigit() or int(rank) > 200: continue
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            
            # [3] 데이터 추출 (서식 그대로)
            rate_str = cols[3].get_text(strip=True) # "14.4%"
            res_audi_str = cols[6].get_text(strip=True) # "36,157"
            res_sales_str = cols[4].get_text(strip=True) # "506,697,090"
            acc_audi_str = cols[7].get_text(strip=True) # "378"
            acc_sales_str = cols[5].get_text(strip=True) # "5,670,000"
            
            if title not in history: history[title] = []
            
            # [4] 데이터 누적 (시간이 다를 때만 추가)
            last_entry = history[title][-1] if history[title] else None
            if not last_entry or last_entry['time'] != crawled_time:
                history[title].append({
                    "time": crawled_time,
                    "rank": int(rank),
                    "rate": rate_str, 
                    "audiCnt": res_audi_str, 
                    "salesAmt": res_sales_str,
                    "audiAcc": acc_audi_str,
                    "salesAcc": acc_sales_str,
                    # 그래프 및 AI 분석용 숫자값
                    "val_audi": int(res_audi_str.replace(',', '')) if res_audi_str.replace(',', '').isdigit() else 0,
                    "val_rate": float(rate_str.replace('%', '')) if rate_str else 0
                })
                # 최근 288개 (약 24시간 분량, 5분 간격) 유지
                if len(history[title]) > 288: history[title] = history[title][-288:]
            count += 1

        if count > 0:
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            print(f"Updated {count} movies at {crawled_time}")
        
    except Exception as e:
        print(f"Update Failed: {e}")

if __name__ == "__main__":
    ensure_dir()
    update_realtime()
