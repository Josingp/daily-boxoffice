import os
import json
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup

DAILY_FILE = "public/daily_data.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

def fetch_api_list(target_dt):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={target_dt}", timeout=5)
        return res.json().get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
    except: return []

def fetch_movie_detail(movie_cd):
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    try:
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&movieCd={movie_cd}", timeout=5)
        return res.json().get("movieInfoResult", {}).get("movieInfo", {})
    except: return {}

def fetch_realtime_data():
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kobis.or.kr/',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    try:
        session = requests.Session()
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf = soup.find('input', {'name': 'CSRFToken'})['value']
        
        # 조회 시간 파싱
        crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        try:
            time_tag = soup.find(string=lambda t: t and "조회일시" in t)
            if time_tag:
                import re
                match = re.search(r"(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", time_tag)
                if match: crawled_time = match.group(1).replace("/", "-")
        except: pass

        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 'dmlMode': 'search', 'allMovieYn': 'Y', 'loadEnd': '0'
        }, timeout=15)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        result = {}
        for row in soup.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            result[title] = {
                "rank": cols[0].get_text(strip=True),
                "rate": cols[3].get_text(strip=True),
                "audiCnt": cols[6].get_text(strip=True).replace(',', ''), # 예매관객 (인덱스 주의)
                "salesAmt": cols[4].get_text(strip=True).replace(',', ''), # 예매매출
                "audiAcc": cols[7].get_text(strip=True).replace(',', ''),  # 누적관객
                "salesAcc": cols[5].get_text(strip=True).replace(',', ''), # 누적매출
                "crawledTime": crawled_time
            }
        return result
    except: return {}

def main():
    if not KOBIS_API_KEY: return

    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=1)).strftime("%Y%m%d")
    
    print(f"Target: {yesterday}")

    # 1. 어제자 박스오피스 리스트 확보
    target_list = fetch_api_list(yesterday)
    realtime_map = fetch_realtime_data()
    
    final_movies = []

    # 2. 각 영화별로 '개봉일 ~ 어제' 전체 데이터 수집 (병렬 처리)
    with ThreadPoolExecutor(max_workers=5) as executor:
        for movie in target_list:
            movie_cd = movie['movieCd']
            open_dt_str = movie['openDt'].replace('-', '')
            
            # 개봉일이 없거나 미래면 최근 7일만
            if not open_dt_str or open_dt_str > yesterday:
                start_date = (today - datetime.timedelta(days=7)).strftime("%Y%m%d")
            else:
                start_date = open_dt_str

            # 날짜 리스트 생성 (개봉일 ~ 어제)
            date_range = []
            curr = datetime.datetime.strptime(start_date, "%Y%m%d")
            end = datetime.datetime.strptime(yesterday, "%Y%m%d")
            while curr <= end:
                date_range.append(curr.strftime("%Y%m%d"))
                curr += datetime.timedelta(days=1)
            
            # 너무 많으면 최근 60일로 제한 (API 보호)
            if len(date_range) > 60: date_range = date_range[-60:]

            print(f"Fetching history for {movie['movieNm']} ({len(date_range)} days)...")

            # 일별 데이터 병렬 수집
            trend_data = []
            futures = {executor.submit(fetch_api_list, d): d for d in date_range}
            
            for f in futures:
                d_key = futures[f]
                try:
                    d_list = f.result()
                    found = next((m for m in d_list if m['movieCd'] == movie_cd), None)
                    if found:
                        trend_data.append({
                            "date": d_key,
                            "dateDisplay": f"{d_key[4:6]}/{d_key[6:8]}",
                            "audiCnt": int(found['audiCnt']),
                            "salesAmt": int(found['salesAmt']),
                            "scrnCnt": int(found['scrnCnt']),
                            "showCnt": int(found['showCnt'])
                        })
                except: pass
            
            # 날짜순 정렬
            trend_data.sort(key=lambda x: x['date'])
            movie['trend'] = trend_data

            # 전일 대비 증감 (trend 마지막 2개 비교)
            if len(trend_data) >= 2:
                last = trend_data[-1]
                prev = trend_data[-2]
                movie['scrnInten'] = last['scrnCnt'] - prev['scrnCnt']
                movie['showInten'] = last['showCnt'] - prev['showCnt']
            else:
                movie['scrnInten'] = 0
                movie['showInten'] = 0

            # 실시간 데이터 병합
            clean_name = movie['movieNm'].replace(" ", "").strip()
            for rt_title, rt_data in realtime_map.items():
                if clean_name in rt_title.replace(" ", ""):
                    movie['realtime'] = rt_data
                    break
            
            final_movies.append(movie)

    final_movies.sort(key=lambda x: int(x['rank']))

    os.makedirs("public", exist_ok=True)
    with open(DAILY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"date": yesterday, "movies": final_movies}, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {len(final_movies)} movies with FULL history.")

if __name__ == "__main__":
    main()
