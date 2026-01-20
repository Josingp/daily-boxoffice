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
        
        # [핵심] 조회일시 파싱 (HTML 텍스트에서 추출)
        crawled_time = ""
        try:
            # "조회일시 :" 텍스트가 포함된 태그 찾기
            time_tag = soup.find(string=re.compile("조회일시"))
            if time_tag:
                # 2026/01/20 15:39 형태 추출
                match = re.search(r"(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", time_tag)
                if match: 
                    crawled_time = match.group(1).replace("/", "-")
        except: pass
        
        if not crawled_time:
            crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

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
            if not rank.isdigit() or int(rank) > 200: continue # 상위 200위
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            
            # [수정] 데이터 원본 그대로 추출 (쉼표, % 포함)
            rate_str = cols[3].get_text(strip=True) # "12.7%"
            res_sales = cols[4].get_text(strip=True) # "502,840,240"
            acc_sales = cols[5].get_text(strip=True) # "74,577,278,660"
            res_audi = cols[6].get_text(strip=True)  # "29,205"
            acc_audi = cols[7].get_text(strip=True)  # "6,398,660"
            
            if title not in history: history[title] = []
            
            # 시간 중복 방지
            if not history[title] or history[title][-1]['time'] != crawled_time:
                history[title].append({
                    "time": crawled_time,
                    "rank": int(rank),
                    "rate": rate_str, # 문자열 그대로 ("12.7%")
                    "audiCnt": res_audi, # 문자열 그대로 ("29,205")
                    "salesAmt": res_sales,
                    "audiAcc": acc_audi,
                    "salesAcc": acc_sales,
                    # 그래프용 숫자 변환 값
                    "val_rate": float(rate_str.replace('%','')) if rate_str else 0,
                    "val_audi": int(res_audi.replace(',','')) if res_audi.replace(',','').isdigit() else 0
                })
                # 최근 100개 유지
                if len(history[title]) > 100: history[title] = history[title][-100:]
            count += 1

        if count > 0:
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            print(f"Saved {count} movies at {crawled_time}")
        
    except Exception as e:
        print(f"Update Failed: {e}")

if __name__ == "__main__":
    ensure_dir()
    update_realtime()
