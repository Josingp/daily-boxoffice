import os
import json
import requests
import re
import html
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

app = FastAPI()

# CORS 설정
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

# KOBIS URL 상수
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_WEEKLY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json"
KOBIS_MOVIE_INFO_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"

def normalize_string(s: str) -> str:
    s = html.unescape(s)
    s = re.sub(r'[^0-9a-zA-Z가-힣]', '', s)
    return s.lower()

@app.get("/")
def read_root():
    return {"status": "ok", "service": "BoxOffice Pro Backend Running"}

# --- 실시간 예매율 ---
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

# --- KOBIS API Proxy ---
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
        from concurrent.futures import ThreadPoolExecutor
        dates = []
        end_dt = datetime.strptime(endDate, "%Y%m%d")
        for i in range(27, -1, -1):
            dates.append((end_dt - timedelta(days=i)).strftime("%Y%m%d"))
            
        def fetch(dt):
            try:
                res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={dt}", timeout=3).json()
                box_res = res.get('boxOfficeResult', {})
                daily_list = box_res.get('dailyBoxOfficeList', [])
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
            return [r for r in results if r is not None]
    except: return []

# --- AI Prediction ---
class PredictionRequest(BaseModel):
    movieName: str
    trendData: List[Dict[str, Any]]
    movieInfo: Dict[str, Any]
    currentAudiAcc: str

@app.post("/predict")
async def predict(req: PredictionRequest):
    if not GEMINI_API_KEY: 
        print("CRITICAL: API Key is missing in env vars")
        raise HTTPException(status_code=500, detail="Server Configuration Error: API Key Missing")
    
    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        prompt = f"""
        Analyze Korean movie "{req.movieName}".
        Genre: {', '.join(req.movieInfo.get('genres', []))}
        Current Audience: {req.currentAudiAcc}
        Trend Data (Last 7 days): {json.dumps(req.trendData[-7:])}

        Predict final audience and explain logic.
        IMPORTANT: Output MUST be valid JSON only. No markdown.
        JSON Keys: analysisText (Korean), predictedFinalAudi (min, max, avg), logicFactors, similarMovies, predictionSeries (3 days).
        """
        
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        
        # [중요] 500 에러 방지: 응답 텍스트 정제 (마크다운 제거)
        cleaned_text = response.text.replace("```json", "").replace("```", "").strip()
        
        return json.loads(cleaned_text)
        
    except Exception as e:
        print(f"AI Error: {e}")
        # 에러 내용을 프론트엔드로 보내서 디버깅을 도움
        raise HTTPException(status_code=500, detail=f"AI Error: {str(e)}")
