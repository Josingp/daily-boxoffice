import os
import requests
import json
from datetime import datetime, timedelta

# KOBIS API 키 (환경변수에서 로드)
API_KEY = os.environ.get("KOBIS_API_KEY")
DAILY_URL = "http://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"

def get_yesterday():
    yesterday = datetime.now() - timedelta(days=1)
    return yesterday.strftime("%Y%m%d")

def fetch_daily_data(target_date):
    params = {
        "key": API_KEY,
        "targetDt": target_date
    }
    response = requests.get(DAILY_URL, params=params)
    return response.json()

def update_data():
    if not API_KEY:
        print("Error: KOBIS_API_KEY not found.")
        return

    target_date = get_yesterday()
    data = fetch_daily_data(target_date)
    
    file_path = "public/daily_data.json"
    
    existing_data = {}
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            try:
                existing_data = json.load(f)
            except json.JSONDecodeError:
                existing_data = {}
    
    # 데이터 구조: { "영화제목": [ { date, audiCnt, ... }, ... ] }
    if "boxOfficeResult" in data and "dailyBoxOfficeList" in data["boxOfficeResult"]:
        daily_list = data["boxOfficeResult"]["dailyBoxOfficeList"]
        
        for movie in daily_list:
            title = movie["movieNm"]
            if title not in existing_data:
                existing_data[title] = []
            
            # 중복 날짜 체크
            is_exist = any(d["date"] == target_date for d in existing_data[title])
            if not is_exist:
                # 데이터 추가 (필요한 필드만)
                d_key = target_date
                existing_data[title].append({
                    "date": d_key,
                    "dateDisplay": f"{d_key[4:6]}/{d_key[6:8]}",
                    "audiCnt": int(movie["audiCnt"]),
                    "salesAmt": int(movie["salesAmt"]),
                    "scrnCnt": int(movie["scrnCnt"]),
                    "showCnt": int(movie["showCnt"])
                })
                # 최근 30일 데이터만 유지 (선택사항)
                existing_data[title] = sorted(existing_data[title], key=lambda x: x["date"])[-30:]

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
    
    print(f"Updated daily data for {target_date}")

if __name__ == "__main__":
    update_data()
