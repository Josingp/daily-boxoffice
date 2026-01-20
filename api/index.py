import os
import requests
import re
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS 설정 (모든 도메인 허용)
app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"]
)

# 환경변수 및 상수 설정
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# ---------------------------------------------------------
# [기능 1] 뉴스 검색 API (네이버 뉴스 크롤링)
# ---------------------------------------------------------
@app.get("/api/news")
def get_news(keyword: str = ""):
    if not keyword: return {"items": []}
    
    # 네이버 뉴스 검색 URL
    search_url = f"https://search.naver.com/search.naver?where=news&query={quote(keyword)}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        res = requests.get(search_url, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        items = []
        
        # 뉴스 리스트 파싱
        news_list = soup.select("div.news_wrap")
        for news in news_list[:5]: # 최대 5개
            title_tag = news.select_one("a.news_tit")
            desc_tag = news.select_one("div.news_dsc")
            press_tag = news.select_one("a.info.press")
            
            if title_tag:
                items.append({
                    "title": title_tag.get_text(),
                    "link": title_tag['href'],
                    "desc": desc_tag.get_text() if desc_tag else "",
                    "press": press_tag.get_text() if press_tag else "언론사"
                })
        return {"items": items}
    except Exception as e:
        print(f"News error: {e}")
        return {"items": []}

# ---------------------------------------------------------
# [기능 2] 포스터 검색 API (다음 영화 검색 크롤링)
# ---------------------------------------------------------
@app.get("/api/poster")
def get_poster(movieName: str = ""):
    if not movieName: return {"url": ""}
    
    # 다음 검색 활용 (이미지 탭)
    search_url = f"https://search.daum.net/search?w=img&q={quote(movieName + ' 포스터')}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        res = requests.get(search_url, headers=headers, timeout=5)
        # 이미지 URL 패턴 추출
        match = re.search(r'data-original-src="(http[^"]+)"', res.text)
        if match:
            return {"url": match.group(1).replace("&amp;", "&")}
            
        return {"url": ""}
    except:
        return {"url": ""}

# ---------------------------------------------------------
# [기능 3] 일별 박스오피스 Fallback API (JSON 파일 없을 때 호출)
# ---------------------------------------------------------
@app.get("/kobis/daily")
def get_daily_boxoffice(targetDt: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"error": "API Key Missing", "movies": []}

    try:
        res = requests.get(f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={targetDt}", timeout=5)
        data = res.json()
        daily_list = data.get("boxOfficeResult", {}).get("dailyBoxOfficeList", [])
        
        if not daily_list:
            return {"movies": []}

        final_movies = []

        # 영화 상세정보 병렬 호출
        def fetch_detail(movie):
            try:
                r = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie['movieCd']}", timeout=2)
                movie['detail'] = r.json().get("movieInfoResult", {}).get("movieInfo", {})
            except:
                movie['detail'] = {}
            return movie

        with ThreadPoolExecutor(max_workers=5) as ex:
            final_movies = list(ex.map(fetch_detail, daily_list))
        
        final_movies.sort(key=lambda x: int(x['rank']))

        return {"movies": final_movies}

    except Exception as e:
        return {"error": str(e), "movies": []}

# ---------------------------------------------------------
# [기능 4] 영화 상세정보 API
# ---------------------------------------------------------
@app.get("/kobis/detail")
def get_movie_detail(movieCd: str = Query(...)):
    if not KOBIS_API_KEY:
        return {"movieInfoResult": {"movieInfo": {}}}
    
    try:
        res = requests.get(f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movieCd}", timeout=5)
        return res.json()
    except Exception as e:
        return {"error": str(e)}

# ---------------------------------------------------------
# [기능 5] 특정 영화 과거 흥행 추이 (그래프용)
# ---------------------------------------------------------
@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    
    today = datetime.now()
    yesterday = (today - timedelta(days=1))
    
    if openDt:
        try:
            start_date = datetime.strptime(openDt.replace("-",""), "%Y%m%d")
        except:
            start_date = today - timedelta(days=30)
    else:
        start_date = today - timedelta(days=30)
        
    # 최대 60일치만 가져오도록 제한
    if (yesterday - start_date).days > 60:
        start_date = yesterday - timedelta(days=60)
        
    date_list = []
    curr = start_date
    while curr <= yesterday:
        date_list.append(curr.strftime("%Y%m%d"))
        curr += timedelta(days=1)
        
    results = []
    def fetch_daily_for_trend(d):
        try:
            url = f"{KOBIS_DAILY_URL}?key={KOBIS_API_KEY}&targetDt={d}"
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
        results = list(ex.map(fetch_daily_for_trend, date_list))
        
    return [r for r in results if r]

# ---------------------------------------------------------
# [기능 6] 실시간 예매 정보 크롤링 (백업용)
# ---------------------------------------------------------
@app.get("/api/realtime")
def get_realtime_ranking():
    # 실시간 데이터는 기본적으로 JSON 파일을 사용하므로,
    # 여기서는 빈 응답을 보내거나 필요 시 크롤링 로직을 구현합니다.
    # (타임아웃 방지를 위해 간단히 처리)
    return {"status": "ok", "data": [], "crawledTime": ""}

@app.get("/api/reservation")
def get_reservation(movieName: str = Query(...)):
    # 실시간 정보 상세 조회를 위한 크롤링
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = requests.get(KOBIS_REALTIME_URL, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        # 조회 시간 파싱
        crawled_time = ""
        try:
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", soup.get_text())
            if match: crawled_time = match.group(1).replace("/", "-")
        except: pass
        
        if not crawled_time:
            crawled_time = datetime.now().strftime("%Y-%m-%d %H:%M")

        norm_query = re.sub(r'[^0-9a-zA-Z가-힣]', '', movieName).lower()
        rows = soup.find_all("tr")
        found_data = None
        
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            title = cols[1].find("a")["title"].strip() if cols[1].find("a") else cols[1].get_text(strip=True)
            norm_title = re.sub(r'[^0-9a-zA-Z가-힣]', '', title).lower()
            
            if norm_query in norm_title or norm_title in norm_query:
                # 0원/0명 방지를 위해 원본 텍스트 사용
                found_data = {
                    "rank": cols[0].get_text(strip=True),
                    "rate": cols[3].get_text(strip=True),
                    "audiCnt": cols[6].get_text(strip=True),
                    "salesAmt": cols[4].get_text(strip=True),
                    "audiAcc": cols[7].get_text(strip=True),
                    "salesAcc": cols[5].get_text(strip=True),
                    "crawledTime": crawled_time
                }
                break
                
        if found_data:
            return {"found": True, "data": found_data, "crawledTime": crawled_time}
        return {"found": False}
        
    except:
        return {"found": False}
