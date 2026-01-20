# api/index.py

import os
import requests
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

# ... (기존 임포트 및 설정 유지)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

# ---------------------------------------------------------
# [추가] 일별 박스오피스 Fallback API
# JSON 파일이 없을 때 호출됨
# ---------------------------------------------------------
@app.get("/kobis/daily")
def get_daily_boxoffice(targetDt: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"error": "API Key Missing"}

    # KOBIS API 호출
    url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
    detail_url = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
    
    try:
        # 1. 박스오피스 리스트 가져오기
        res = requests.get(f"{url}?key={KOBIS_API_KEY}&targetDt={targetDt}")
        data = res.json()
        daily_list = data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        final_movies = []

        # 2. 영화 상세정보 병렬 호출 (포스터, 감독 등 필요하므로)
        def fetch_detail(movie):
            try:
                r = requests.get(f"{detail_url}?key={KOBIS_API_KEY}&movieCd={movie['movieCd']}")
                detail = r.json().get("movieInfoResult", {}).get("movieInfo", {})
                movie['detail'] = detail
            except:
                movie['detail'] = {}
            return movie

        with ThreadPoolExecutor(max_workers=5) as ex:
            # 리스트의 각 영화에 대해 상세정보 호출
            final_movies = list(ex.map(fetch_detail, daily_list))
        
        # 순위대로 정렬
        final_movies.sort(key=lambda x: int(x['rank']))

        return {"movies": final_movies}

    except Exception as e:
        return {"error": str(e), "movies": []}

# ... (기존 trend 함수 및 기타 코드 유지) ...
# 기존에 있던 @app.get("/kobis/trend") 등은 그대로 두세요.
