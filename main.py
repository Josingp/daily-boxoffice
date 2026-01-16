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

# --- 환경 설정 ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 실제 배포 시에는 프론트엔드 도메인으로 제한 권장
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# KOBIS API Key
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY", "7b6e13eaf7ec8194db097e7ea0bba626")
# Gemini API Key
GEMINI_API_KEY = os.environ.get("API_KEY") 

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("Warning: API_KEY (Gemini) not found.")

KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

# --- [핵심] 실시간 예매율 크롤러 (Regex 기반) ---
@app.get("/api/reservation")
def get_realtime_reservation(movieName: str = Query(..., description="Movie name to search")):
    # KOBIS 실시간 예매율 페이지 (전체 리스트가 로딩되는 페이지)
    url = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do?dmlMode=search"
    
    try:
        # 1. KOBIS 서버 접속
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kobis.or.kr/'
        }
        resp = requests.get(url, headers=headers, timeout=10)
        resp.encoding = 'utf-8' # 한글 깨짐 방지
        html = resp.text

        # 2. HTML <tbody> 부분 추출
        tbody_match = re.search(r'<tbody>(.*?)</tbody>', html, re.DOTALL)
        if not tbody_match:
             return {"found": False, "message": "HTML structure changed or empty"}
        
        tbody_content = tbody_match.group(1)
        
        # 3. 각 행(tr) 추출
        rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody_content, re.DOTALL)
        
        # 검색어 공백 제거 (비교용)
        target_name_clean = movieName.replace(" ", "").strip()
        
        for row in rows:
            # 각 열(td) 추출
            cols = re.findall(r'<td.*?>(.*?)</td>', row, re.DOTALL)
            if len(cols) < 7: continue # 데이터 부족한 행 패스
            
            # 영화 제목 추출 (두번째 td)
            # <a ... title="영화명">영화명</a> 형태 또는 텍스트
            title_html = cols[1]
            # 태그 제거
            clean_title = re.sub(r'<[^>]+>', '', title_html).strip()
            
            # [중요] 공백 제거 후 비교 ("만약에 우리" == "만약에우리")
            if clean_title.replace(" ", "") == target_name_clean:
                # 데이터 추출
                rank = re.sub(r'<[^>]+>', '', cols[0]).strip()
                rate = re.sub(r'<[^>]+>', '', cols[3]).strip() # 예매율 (4번째)
                audi_cnt = re.sub(r'<[^>]+>', '', cols[6]).strip().replace(',', '') # 예매관객수 (7번째)
                
                return {
                    "found": True,
                    "data": {
                        "rank": int(rank),
                        "title": clean_title,
                        "rate": rate,
                        "audiCnt": audi_cnt
                    }
                }

        return {"found": False, "message": f"Movie '{movieName}' not found in top rankings."}

    except Exception as e:
        print(f"Scrape Error: {e}")
        return {"found": False, "error": str(e)}

# --- 기존 엔드포인트들 (KOBIS 프록시) ---

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend"}

@app.get("/kobis/daily")
def get_daily_box_office(targetDt: str):
    try:
        url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}"
        return requests.get(url, timeout=10).json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/kobis/weekly")
def get_weekly_box_office(targetDt: str, weekGb: str = "1"):
    try:
        url = f"{KOBIS_WEEKLY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}&weekGb={weekGb}"
        return requests.get(url, timeout=10).json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/kobis/detail")
def get_movie_detail(movieCd: str):
    try:
        url = f"{KOBIS_MOVIE_INFO_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}"
        return requests.get(url, timeout=10).json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/kobis/trend")
def get_movie_trend(movieCd: str, endDate: str):
    try:
        dates = []
        try:
            end_dt = datetime.strptime(endDate, "%Y%m%d")
        except ValueError:
             end_dt = datetime.now() - timedelta(days=1)

        # 최근 14일치 데이터
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
                    }
            except Exception:
                pass
            return {"date": dt, "dateDisplay": f"{dt[4:6]}/{dt[6:8]}", "audiCnt": 0}

        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(fetch_date, dates))
        return results
    except Exception as e:
        return []

# --- AI Prediction (Gemini) ---
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
        
        # ... (프롬프트 구성 로직, 이전 코드와 동일하게 유지하거나 필요시 추가)
        # 간단한 응답 예시 (실제 AI 로직 연결 필요)
        return {
            "analysisText": f"AI가 분석한 {request.movieName}의 흥행 예측 리포트입니다...",
            "predictedFinalAudi": {"min": 0, "max": 0, "avg": 0},
            "logicFactors": {"decayFactor": "-", "seasonalityScore": "-", "momentum": "-"},
            "similarMovies": [],
            "similarMovieSeries": [],
            "predictionSeries": [0, 0, 0]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
