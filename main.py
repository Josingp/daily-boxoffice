import os
import json
import requests
import re
import html
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

# --- 환경 설정 ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# KOBIS API Key
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")
GEMINI_API_KEY = os.environ.get("API_KEY") 

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# --- 상수 ---
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

# --- Helper: 문자열 정규화 (비교용) ---
def normalize_string(s: str) -> str:
    # 1. HTML 엔티티 디코딩
    s = html.unescape(s)
    # 2. 공백 및 특수문자 제거 (숫자, 한글, 영어만 남김)
    s = re.sub(r'[^0-9a-zA-Z가-힣]', '', s)
    return s.lower()

# --- [핵심] 실시간 예매율 크롤러 (개선된 버전) ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name to search")):
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do?dmlMode=search"
    
    try:
        session = requests.Session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/'
        }
        resp = session.get(url, headers=headers, timeout=10)
        resp.encoding = 'utf-8'
        html_text = resp.text

        # 2. HTML <tbody> 부분 추출
        tbody_match = re.search(r'<tbody>(.*?)</tbody>', html_text, re.DOTALL)
        if not tbody_match:
             return {"found": False, "message": "HTML structure error"}
        
        rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody_match.group(1), re.DOTALL)
        
        # 검색어 정규화
        target_normalized = normalize_string(movieName)
        
        scanned_count = 0
        for row in rows:
            scanned_count += 1
            cols = re.findall(r'<td.*?>(.*?)</td>', row, re.DOTALL)
            if len(cols) < 7: continue 
            
            # 영화 제목 추출
            title_html = cols[1]
            # 태그 제거
            raw_title = re.sub(r'<[^>]+>', '', title_html).strip()
            
            # 비교
            if normalize_string(raw_title) == target_normalized:
                # 데이터 추출
                rank = re.sub(r'<[^>]+>', '', cols[0]).strip()
                rate = re.sub(r'<[^>]+>', '', cols[3]).strip()
                audi_cnt = re.sub(r'<[^>]+>', '', cols[6]).strip().replace(',', '')
                
                return {
                    "found": True,
                    "data": {
                        "rank": int(rank),
                        "title": raw_title, # 원본 제목 반환
                        "rate": rate,
                        "audiCnt": audi_cnt
                    }
                }

        return {
            "found": False, 
            "message": f"Movie '{movieName}' not found in top {scanned_count} rankings.",
            "scanned": scanned_count
        }

    except Exception as e:
        print(f"Scrape Error: {e}")
        return {"found": False, "error": str(e)}

# --- KOBIS 데이터 병렬 처리 엔드포인트 ---
# 프론트엔드에서 14번 요청하던 것을 서버에서 1번 요청으로 처리 -> 속도 10배 향상
@app.get("/kobis/trend")
def get_movie_trend(movieCd: str, endDate: str):
    try:
        dates = []
        try:
            end_dt = datetime.strptime(endDate, "%Y%m%d")
        except ValueError:
             end_dt = datetime.now() - timedelta(days=1)

        # 최근 28일치 데이터 (넉넉하게)
        for i in range(27, -1, -1):
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
                    
                    if movie_data:
                         return {
                            "date": dt,
                            "dateDisplay": f"{dt[4:6]}/{dt[6:8]}",
                            "audiCnt": int(movie_data['audiCnt']),
                            "scrnCnt": int(movie_data['scrnCnt']),
                            "showCnt": int(movie_data['showCnt']),
                            "rank": int(movie_data['rank']),
                            "salesShare": float(movie_data['salesShare'])
                        }
            except Exception:
                pass
            # 데이터 없으면 0으로 채움
            return {
                "date": dt, 
                "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", 
                "audiCnt": 0, 
                "scrnCnt": 0,
                "showCnt": 0
            }

        # 병렬 처리로 속도 최적화
        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(fetch_date, dates))
        
        return results
    except Exception as e:
        print(f"Trend Error: {e}")
        return []

# --- 기타 엔드포인트 (기존 유지) ---
@app.get("/kobis/daily")
def get_daily_box_office(targetDt: str):
    return requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}").json()

@app.get("/kobis/weekly")
def get_weekly_box_office(targetDt: str, weekGb: str = "1"):
    return requests.get(f"{KOBIS_WEEKLY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}&weekGb={weekGb}").json()

@app.get("/kobis/detail")
def get_movie_detail(movieCd: str):
    return requests.get(f"{KOBIS_MOVIE_INFO_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}").json()

# --- AI Prediction Stub ---
class PredictionRequest(BaseModel):
    movieName: str
    trendData: List[Dict[str, Any]]
    movieInfo: Dict[str, Any]
    currentAudiAcc: str

@app.post("/predict")
async def predict_movie(request: PredictionRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="AI Service Unavailable")
    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        # 실제 예측 로직은 프론트엔드 서비스 코드와 호환을 위해 단순화함
        return {
            "analysisText": "AI 분석 결과입니다.",
            "predictedFinalAudi": {"min": 0, "max": 0, "avg": 0},
            "logicFactors": {},
            "similarMovies": [],
            "similarMovieSeries": [],
            "predictionSeries": []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
