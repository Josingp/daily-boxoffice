import os
import requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

# ... (기존 Realtime, News API 유지) ...

# [NEW] 특정 영화의 과거 데이터 API 호출 (JSON에 없을 때 사용)
@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    
    # 오늘 기준
    today = datetime.now()
    yesterday = (today - timedelta(days=1))
    
    # 개봉일이 없으면 30일 전부터, 있으면 개봉일부터
    if openDt:
        start_date = datetime.strptime(openDt.replace("-",""), "%Y%m%d")
    else:
        start_date = today - timedelta(days=30)
        
    # 최대 60일치만 가져오도록 제한 (속도 문제)
    if (yesterday - start_date).days > 60:
        start_date = yesterday - timedelta(days=60)
        
    date_list = []
    curr = start_date
    while curr <= yesterday:
        date_list.append(curr.strftime("%Y%m%d"))
        curr += timedelta(days=1)
        
    # 병렬 호출
    results = []
    def fetch(d):
        try:
            url = f"https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json?key={KOBIS_API_KEY}&targetDt={d}"
            r = requests.get(url, timeout=3).json()
            box_list = r.get('boxOfficeResult',{}).get('dailyBoxOfficeList',[])
            found = next((x for x in box_list if x['movieCd'] == movieCd), None)
            if found:
                return {
                    "date": d,
                    "dateDisplay": f"{d[4:6]}/{d[6:8]}",
                    "audiCnt": int(found['audiCnt']),
                    "salesAmt": int(found['salesAmt']),
                    "scrnCnt": int(found['scrnCnt']),
                    "showCnt": int(found['showCnt'])
                }
        except: pass
        return None

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch, date_list))
        
    return [r for r in results if r]
