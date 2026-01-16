import os
import json
import requests
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

# --- Soft Imports for Heavy Libraries ---
try:
    import numpy as np
    import pandas as pd
    HAS_DATA_LIBS = True
except ImportError:
    HAS_DATA_LIBS = False
    print("Warning: numpy or pandas not found. Prediction features will be disabled.")

try:
    from sklearn.ensemble import GradientBoostingRegressor
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

# --- Configuration ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Keys
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")
# Use the same env var name as the frontend for consistency, or a dedicated backend one
GEMINI_API_KEY = os.environ.get("API_KEY") 

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("Warning: API_KEY not found in environment. AI parsing will fail.")

KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

# --- Data Structures ---
class PredictionResponse(BaseModel):
    movie_name: str
    analysis_text: str
    history: List[Dict[str, Any]]
    forecast: List[Dict[str, Any]]
    features_used: Dict[str, Any]

# --- Proxy Endpoints (KOBIS) ---

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

@app.get("/kobis/daily")
def get_daily_box_office(targetDt: str):
    try:
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching daily box office: {e}")
        raise HTTPException(status_code=500, detail=f"KOBIS API Error: {str(e)}")

@app.get("/kobis/weekly")
def get_weekly_box_office(targetDt: str, weekGb: str = "1"):
    try:
        url = f"{KOBIS_WEEKLY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}&weekGb={weekGb}"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching weekly box office: {e}")
        raise HTTPException(status_code=500, detail=f"KOBIS API Error: {str(e)}")

@app.get("/kobis/detail")
def get_movie_detail(movieCd: str):
    try:
        url = f"{KOBIS_MOVIE_INFO_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching movie detail: {e}")
        raise HTTPException(status_code=500, detail=f"KOBIS API Error: {str(e)}")

@app.get("/kobis/trend")
def get_movie_trend(movieCd: str, endDate: str):
    try:
        dates = []
        try:
            end_dt = datetime.strptime(endDate, "%Y%m%d")
        except ValueError:
             end_dt = datetime.now() - timedelta(days=1)

        for i in range(13, -1, -1):
            d = end_dt - timedelta(days=i)
            dates.append(d.strftime("%Y%m%d"))
        
        def fetch_date(dt):
            try:
                url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={dt}"
                res = requests.get(url, timeout=3)
                if res.status_code == 200:
                    data = res.json()
                    daily_list = data.get('boxOfficeResult', {}).get('dailyBoxOfficeList', [])
                    movie_data = next((m for m in daily_list if m['movieCd'] == movieCd), None)
                    return {
                        "date": dt,
                        "dateDisplay": f"{dt[4:6]}/{dt[6:8]}",
                        "audiCnt": int(movie_data['audiCnt']) if movie_data else 0,
                        "scrnCnt": int(movie_data['scrnCnt']) if movie_data else 0,
                        "showCnt": int(movie_data['showCnt']) if movie_data else 0,
                    }
            except Exception:
                pass
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0}

        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(fetch_date, dates))
        
        return results

    except Exception as e:
        print(f"Trend Fetch Error: {str(e)}")
        return []

# --- [NEW] Real-Time Reservation Scraper ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name to search")):
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do?dmlMode=search"
    
    try:
        # 1. KOBIS 서버 접속
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/'
        }
        resp = requests.get(url, headers=headers, timeout=5)
        # KOBIS 인코딩 처리 (utf-8이 아닐 경우 대비)
        resp.encoding = 'utf-8'
        html = resp.text

        # 2. HTML <tbody> 부분 추출
        tbody_match = re.search(r'<tbody>(.*?)</tbody>', html, re.DOTALL)
        if not tbody_match:
             return {"found": False, "message": "HTML structure changed or empty"}
        
        tbody_content = tbody_match.group(1)
        
        # 3. 각 행(tr) 추출 및 검색
        # 정규식으로 tr 태그들을 찾음
        rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody_content, re.DOTALL)
        
        target_name_clean = movieName.replace(" ", "").strip()
        
        for row in rows:
            # 각 열(td) 추출
            cols = re.findall(r'<td.*?>(.*?)</td>', row, re.DOTALL)
            if len(cols) < 7:
                continue
            
            # 영화 제목 추출 (두번째 td)
            # <a ... title="영화명">영화명</a> 형태일 수 있음
            title_html = cols[1]
            # 태그 제거
            clean_title = re.sub(r'<[^>]+>', '', title_html).strip()
            
            # 공백 제거 후 비교 (정확도 향상)
            if clean_title.replace(" ", "") == target_name_clean:
                # 데이터 추출
                rank = re.sub(r'<[^>]+>', '', cols[0]).strip()
                rate = re.sub(r'<[^>]+>', '', cols[3]).strip()
                audi_cnt = re.sub(r'<[^>]+>', '', cols[6]).strip().replace(',', '')
                
                return {
                    "found": True,
                    "data": {
                        "rank": rank,
                        "title": clean_title,
                        "rate": rate,
                        "audiCnt": audi_cnt
                    }
                }

        return {"found": False, "message": "Movie not found in top rankings"}

    except Exception as e:
        print(f"Scrape Error: {e}")
        return {"found": False, "error": str(e)}

# --- Step C: Prediction API Endpoint ---

@app.get("/predict/{movie_name}")
async def predict_movie(movie_name: str):
    # ... (Prediction logic remains unchanged - simplified for this file)
    return {
        "movie_name": movie_name,
        "analysis_text": "예측 기능",
        "history": [],
        "forecast": [],
        "features_used": {}
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
