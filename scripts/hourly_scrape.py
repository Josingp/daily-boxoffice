# 파일 위치: scripts/hourly_scrape.py
import requests
from bs4 import BeautifulSoup
import datetime

def job():
    # api/index.py에 있는 URL과 동일
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
    
    # 크롤링 차단 방지용 헤더
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    data = {'dmlMode': 'search'} 
    
    try:
        print(f"[{datetime.datetime.now()}] 크롤링 시작...")
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            rows = soup.find_all("tr")
            
            # 예시: 1위 영화 정보만 출력
            if len(rows) > 0:
                first_row = rows[0]
                cols = first_row.find_all("td")
                if len(cols) >= 8:
                    rank = cols[0].get_text(strip=True)
                    title = cols[1].get_text(strip=True)
                    rate = cols[3].get_text(strip=True)
                    print(f"★ 현재 1위: {title} (예매율: {rate}%)")
                else:
                    print("데이터 형식이 변경되었습니다.")
            else:
                print("데이터를 찾을 수 없습니다.")
        else:
            print(f"접속 실패: {resp.status_code}")
            
    except Exception as e:
        print(f"에러 발생: {e}")

if __name__ == "__main__":
    job()
