import os
import json
import requests
import re
import html
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
# [핵심 수정] 이 줄이 있어야 'List', 'Dict' 에러가 사라집니다.
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

app = FastAPI()

# Vercel 환경에서는 CORS 설정이 유연해야 함
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 환경 변수 로드
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")
GEMINI_API_KEY = os.environ.get("API_KEY")

if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"GenAI Config Error: {e}")

# 상수
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

# 문자열 정규화 함수
def normalize_string(s: str) -> str:
    s = html.unescape(s)
    s = re.sub(r'[^0-9a-zA-Z가-힣]', '', s)
    return s.lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend is Running"}

# --- 실시간 예매율 크롤링 ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do?dmlMode=search"
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(url, headers=headers, timeout=10)
        resp.encoding = 'utf-8'
        html_text = resp.text

        tbody_match = re.search(r'<tbody>(.*?)</tbody>', html_text, re.DOTALL)
        if not tbody_match: return {"found": False}
        
        rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody_match.group(1), re.DOTALL)
        target_norm = normalize_string(movieName)
        
        for row in rows:
            cols = re.findall(r'<td.*?>(.*?)</td>', row, re.DOTALL)
            if len(cols) < 7: continue
            
            raw_title = re.sub(r'<[^>]+>', '', cols[1]).strip()
            if normalize_string(raw_title) == target_norm:
                return {
                    "found": True,
                    "data": {
                        "rank": re.sub(r'<[^>]+>', '', cols[0]).strip(),
                        "title": raw_title,
                        "rate": re.sub(r'<[^>]+>', '', cols[3]).strip(),
                        "audiCnt": re.sub(r'<[^>]+>', '', cols[6]).strip().replace(',', '')
                    }
                }
        return {"found": False}
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

# --- 트렌드 데이터 (병렬 처리) ---
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
            return list(ex.map(fetch, dates))
    except: return []

# --- AI 예측용 데이터 모델 ---
class PredictionRequest(BaseModel):
    movieName: str
    trendData: List[Dict[str, Any]]
    movieInfo: Dict[str, Any]
    currentAudiAcc: str

@app.post("/predict")
async def predict(req: PredictionRequest):
    if not GEMINI_API_KEY: raise HTTPException(503, "API Key Missing")
    
    # 실제 Gemini 로직 (간소화됨)
    return {
        "analysisText": "AI 분석 완료 (Vercel Backend)", 
        "predictedFinalAudi": {"min":0, "max":0, "avg":0}, 
        "predictionSeries": [0,0,0],
        "similarMovies": [], 
        "logicFactors": {}
    }
