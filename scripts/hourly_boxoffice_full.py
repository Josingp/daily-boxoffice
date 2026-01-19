import requests
from bs4 import BeautifulSoup
import datetime
import re
import os

# ---------------------------------------------------------
# 설정 (기존 api/index.py 참고)
# ---------------------------------------------------------
KOBIS_API_KEY = "7b6e13eaf7ec8194db097e7ea0bba626" # 업로드된 파일 내 키 사용
DAILY_BOXOFFICE_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def normalize_string(s):
    """매칭 확률을 높이기 위해 특수문자 제거 및 소문자 변환"""
    if not s: return ""
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', s).lower()

# ---------------------------------------------------------
# 1. KOBIS API로 '일일 박스오피스' 가져오기 (기준 데이터)
# ---------------------------------------------------------
def get_daily_boxoffice():
    # 어제 날짜 구하기 (일일 박스오피스는 어제 날짜 기준)
    yesterday = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime("%Y%m%d")
    
    try:
        res = requests.get(f"{DAILY_BOXOFFICE_URL}?key={KOBIS_API_KEY}&targetDt={yesterday}")
        data = res.json()
        if "boxOfficeResult" in data and "dailyBoxOfficeList" in data["boxOfficeResult"]:
            return data["boxOfficeResult"]["dailyBoxOfficeList"]
        else:
            print("API 응답에 데이터가 없습니다.")
            return []
    except Exception as e:
        print(f"API 호출 에러: {e}")
        return []

# ---------------------------------------------------------
# 2. 웹 크롤링으로 '실시간 예매율 전체 리스트' 가져오기 (보강 데이터)
# ---------------------------------------------------------
def get_all_realtime_data():
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    data = {'dmlMode': 'search'}  # 전체 검색 모드
    
    result_map = {} # 검색 편의를 위해 { "영화제목(정규화)": {상세정보} } 형태로 저장
    
    try:
        resp = requests.post(REALTIME_URL, headers=headers, data=data, timeout=15)
        if resp.status_code != 200:
            print("웹사이트 접속 실패")
            return {}

        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all("tr") # 모든 행(영화) 가져오기

        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue # 데이터가 부족한 행 패스

            # 영화 제목 추출 (a태그 title 속성 우선)
            a_tag = cols[1].find("a")
            title = a_tag["title"].strip() if (a_tag and a_tag.get("title")) else cols[1].get_text(strip=True)
            
            # 정규화된 제목을 키(Key)로 사용
            norm_title = normalize_string(title)
            
            # api/index.py의 컬럼 인덱스 참고
            result_map[norm_title] = {
                "real_rank": cols[0].get_text(strip=True),      # 실시간 예매 순위
                "title": title,                                 # 영화 제목
                "rate": cols[3].get_text(strip=True),           # 예매율
                "salesAmt": cols[4].get_text(strip=True),       # 예매 매출액
                "salesAcc": cols[5].get_text(strip=True),       # 누적 매출액
                "audiCnt": cols[6].get_text(strip=True),        # 예매 관객수
                "audiAcc": cols[7].get_text(strip=True)         # 누적 관객수
            }
            
        return result_map

    except Exception as e:
        print(f"크롤링 에러: {e}")
        return {}

# ---------------------------------------------------------
# 3. 메인 실행: 데이터 매칭 및 출력
# ---------------------------------------------------------
def job():
    print(f"[{datetime.datetime.now()}] 데이터 수집 시작...\n")

    # 1. API 데이터 (Top 10)
    box_office_list = get_daily_boxoffice()
    print(f"-> API 박스오피스 데이터 {len(box_office_list)}건 확보")

    # 2. 크롤링 데이터 (Top 100~200)
    realtime_map = get_all_realtime_data()
    print(f"-> 실시간 예매 데이터 {len(realtime_map)}건 확보\n")

    print("-" * 120)
    print(f"{'순위(API)':<10} {'영화 제목':<30} {'실시간순위':<10} {'예매율':<10} {'예매관객수':<15} {'누적관객수(전체)':<15}")
    print("-" * 120)

    # 3. 매칭 및 결과 출력
    for movie in box_office_list:
        api_title = movie['movieNm']
        norm_title = normalize_string(api_title)
        
        # 크롤링 데이터에서 찾기
        matched_data = realtime_map.get(norm_title)
        
        # 출력 데이터 준비
        rank_str = f"{movie['rank']}위"
        
        if matched_data:
            real_rank = f"{matched_data['real_rank']}위"
            rate = f"{matched_data['rate']}%"
            res_audi = f"{matched_data['audiCnt']}명"
            total_audi = f"{matched_data['audiAcc']}명" # 크롤링 데이터가 더 최신일 수 있음
        else:
            real_rank = "-"
            rate = "-"
            res_audi = "-"
            total_audi = f"{movie['audiAcc']}명" # API 데이터 사용

        print(f"{rank_str:<10} {api_title:<30} {real_rank:<10} {rate:<10} {res_audi:<15} {total_audi:<15}")

if __name__ == "__main__":
    job()
