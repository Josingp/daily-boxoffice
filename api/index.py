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
from pydantic import BaseModel
import google.generativeai as genai

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 환경 변수 확인 및 로드
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")
GEMINI_API_KEY = os.environ.get("API_KEY")

if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"Gemini Config Error: {e}")

# KOBIS URL
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

def normalize_string(s: str) -> str:
    s = html.unescape(s)
    s = re.sub(r'[^0-9a-zA-Z가-힣]', '', s)
    return s.lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Backend Alive"}

# --- [개선된] 실시간 예매율 크롤러 ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name")):
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do?dmlMode=search"
    try:
        # [수정] 헤더 보강 (브라우저처럼 보이게)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
        
        resp = requests.get(url, headers=headers, timeout=15)
        # 인코딩 강제 설정 (KOBIS가 가끔 cp949를 쓸 때가 있음)
        resp.encoding = 'utf-8' 
        html_text = resp.text

        # 파싱 로직
        tbody_match = re.search(r'<tbody>(.*?)</tbody>', html_text, re.DOTALL)
        if not tbody_match: 
            print("Error: tbody not found in KOBIS response")
            return {"found": False, "reason": "parsing_failed"}
        
        rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody_match.group(1), re.DOTALL)
        target_norm = normalize_string(movieName)
        
        print(f"Searching for: {movieName} (norm: {target_norm})")

        for row in rows:
            cols = re.findall(r'<td.*?>(.*?)</td>', row, re.DOTALL)
            if len(cols) < 7: continue
            
            # 제목 추출 (a 태그 안의 title 속성 혹은 텍스트)
            raw_title_part = cols[1]
            # 태그 다 지우고 텍스트만 추출
            raw_title = re.sub(r'<[^>]+>', '', raw_title_part).strip()
            
            if normalize_string(raw_title) == target_norm:
                rank = re.sub(r'<[^>]+>', '', cols[0]).strip()
                rate = re.sub(r'<[^>]+>', '', cols[3]).strip()
                audi_cnt = re.sub(r'<[^>]+>', '', cols[6]).strip().replace(',', '')
                
                print(f"Found: {raw_title}, Rank: {rank}")
                return {
                    "found": True,
                    "data": {
                        "rank": rank,
                        "title": raw_title,
                        "rate": rate,
                        "audiCnt": audi_cnt
                    }
                }
        
        print("Movie not found in top list")
        return {"found": False, "reason": "not_in_rank"}

    except Exception as e:
        print(f"Scrape Exception: {str(e)}")
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
                box_result = res.get('boxOfficeResult', {})
                daily_list = box_result.get('dailyBoxOfficeList', [])
                if not daily_list: return None
                
                movie = next((m for m in daily_list if m['movieCd'] == movieCd), None)
                if movie:
                    return {
                        "date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}",
                        "audiCnt": int(movie['audiCnt']), "scrnCnt": int(movie['scrnCnt'])
                    }
            except: pass
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0, "scrnCnt": 0}

        with ThreadPoolExecutor(max_workers=10) as ex:
            results = list(ex.map(fetch, dates))
            # None 제거
            return [r for r in results if r is not None]
    except Exception as e:
        print(f"Trend Error: {e}")
        return []

# --- AI 예측 ---
class PredictionRequest(BaseModel):
    movieName: str
    trendData: List[Dict[str, Any]]
    movieInfo: Dict[str, Any]
    currentAudiAcc: str

@app.post("/predict")
async def predict(req: PredictionRequest):
    # 키가 없을 경우 명확한 에러 반환
    if not GEMINI_API_KEY: 
        print("Error: GEMINI_API_KEY is missing in environment variables")
        raise HTTPException(status_code=500, detail="Server API Key Config Error")
    
    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        # 프롬프트 구성
        prompt = f"""
        Analyze the box office performance for the movie "{req.movieName}".
        Genre: {', '.join(req.movieInfo.get('genres', []))}
        Release Date: {req.movieInfo.get('openDt')}
        Current Audience: {req.currentAudiAcc}
        Recent Trend: {json.dumps(req.trendData[-7:])}

        Predict the final audience number and explain why.
        Provide output in JSON format with keys: 
        analysisText (Korean), predictedFinalAudi (min, max, avg), logicFactors, similarMovies, predictionSeries (next 3 days audience).
        """
        
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        return json.loads(response.text)
        
    except Exception as e:
        print(f"AI Prediction Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
