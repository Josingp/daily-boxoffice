import os
import json
import requests
import re
import html
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# KOBIS API Key
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")

# URL 상수
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

def normalize_string(s: str) -> str:
    s = html.unescape(s)
    s = re.sub(r'[^0-9a-zA-Z가-힣]', '', s)
    return s.lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

# --- 실시간 예매율 크롤러 ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Origin': 'https://www.kobis.or.kr',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        data = {'dmlMode': 'search'} 
        resp = requests.post(url, headers=headers, data=data, timeout=15)
        
        if resp.status_code != 200:
            return {"found": False, "reason": f"Status {resp.status_code}"}

        html_text = resp.text
        
        tbody_match = re.search(r'<tbody>(.*?)</tbody>', html_text, re.DOTALL)
        if not tbody_match: 
            return {"found": False, "reason": "Parsing Fail"}
        
        rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody_match.group(1), re.DOTALL)
        target_norm = normalize_string(movieName)
        
        for row in rows:
            cols = re.findall(r'<td.*?>(.*?)</td>', row, re.DOTALL)
            if len(cols) < 8: continue 
            
            raw_title_html = cols[1]
            clean_title = re.sub(r'<[^>]+>', '', raw_title_html).strip()
            
            if normalize_string(clean_title) == target_norm:
                return {
                    "found": True,
                    "data": {
                        "rank": re.sub(r'<[^>]+>', '', cols[0]).strip(),
                        "title": clean_title,
                        "rate": re.sub(r'<[^>]+>', '', cols[3]).strip(),
                        "salesAmt": re.sub(r'<[^>]+>', '', cols[4]).strip(),
                        "salesAcc": re.sub(r'<[^>]+>', '', cols[5]).strip(),
                        "audiCnt": re.sub(r'<[^>]+>', '', cols[6]).strip(),
                        "audiAcc": re.sub(r'<[^>]+>', '', cols[7]).strip()
                    }
                }
        return {"found": False, "reason": "Not Found in List"}
        
    except Exception as e:
        return {"found": False, "error": str(e)}

# --- KOBIS API 프록시 ---
@app.get("/kobis/daily")
def get_daily(targetDt: str):
    return requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}").json()

@app.get("/kobis/weekly")
def get_weekly(targetDt: str, weekGb: str = "1"):
    return requests.get(f"{KOBIS_WEEKLY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}&weekGb={weekGb}").json()

@app.get("/kobis/detail")
def get_detail(movieCd: str):
    return requests.get(f"{KOBIS_MOVIE_INFO_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}").json()

@app.get("/kobis/trend")
def get_trend(movieCd: str, endDate: str):
    try:
        dates = []
        end_dt = datetime.strptime(endDate, "%Y%m%d")
        for i in range(27, -1, -1):
            dates.append((end_dt - timedelta(days=i)).strftime("%Y%m%d"))
            
        def fetch(dt):
            try:
                res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={dt}", timeout=3).json()
                movie = next((m for m in res['boxOfficeResult']['dailyBoxOfficeList'] if m['movieCd'] == movieCd), None)
                if movie:
                    return {
                        "date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}",
                        "audiCnt": int(movie['audiCnt']), "scrnCnt": int(movie['scrnCnt'])
                    }
            except: pass
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0, "scrnCnt": 0}

        with ThreadPoolExecutor(max_workers=10) as ex:
            results = list(ex.map(fetch, dates))
            return [r for r in results if r is not None]
    except: return []
