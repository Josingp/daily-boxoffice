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

# CORS 설정
app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"]
)

# 환경변수 설정
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")

KOBIS_DAILY_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"

# ---------------------------------------------------------
# [기능 1] 뉴스 검색 API (네이버 공식 API 연동)
# ---------------------------------------------------------
@app.get("/api/news")
def get_news(keyword: str = ""):
    if not keyword: return {"items": []}
    
    # 1. 네이버 API 키가 있는 경우 (공식 API 사용)
    if NAVER_CLIENT_ID and NAVER_CLIENT_SECRET:
        try:
            url = "https://openapi.naver.com/v1/search/news.json"
            headers = {
                "X-Naver-Client-Id": NAVER_CLIENT_ID,
                "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
            }
            params = {
                "query": keyword,
                "display": 5,
                "sort": "sim"
            }
            res = requests.get(url, headers=headers, params=params, timeout=5)
            
            if res.status_code == 200:
                items = []
                for item in res.json().get('items', []):
                    # HTML 태그 제거 (<b>...</b> 등)
                    clean_title = re.sub('<[^<]+?>', '', item['title'])
                    clean_desc = re.sub('<[^<]+?>', '', item['description'])
                    # 날짜 포맷팅 (예: "Tue, 21 Jan 2026..." -> "2026-01-21")
                    pub_date = item.get('pubDate', '')
                    
                    items.append({
                        "title": clean_title,
                        "link": item['originallink'] or item['link'],
                        "desc": clean_desc,
                        "press": pub_date[:16] # 언론사 정보 대신 날짜 표시
                    })
                return {"items": items}
        except Exception as e:
            print(f"Naver API Error: {e}")
            
    # 2. 키가 없거나 실패 시 크롤링 (Fallback - 비상용)
    try:
        search_url = f"https://search.naver.com/search.naver?where=news&query={quote(keyword)}"
        res = requests.get(search_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        items = []
        for news in soup.select("div.news_wrap")[:5]:
            title_tag = news.select_one("a.news_tit")
            desc_tag = news.select_one("div.news_dsc")
            press_tag = news.select_one("a.info.press")
            if title_tag:
                items.append({
                    "title": title_tag.get_text(),
                    "link": title_tag['href'],
                    "desc": desc_tag.get_text() if desc_tag else "",
                    "press": press_tag.get_text() if press_tag else "네이버뉴스"
                })
        return {"items": items}
    except:
        return {"items": []}

# ---------------------------------------------------------
# [기능 2] 포스터 검색 API (다음 이미지 검색 크롤링)
# ---------------------------------------------------------
@app.get("/api/poster")
def get_poster(movieName: str = ""):
    if not movieName: return {"url": ""}
    
    # 다음 이미지 검색 활용
    try:
        search_url = f"https://search.daum.net/search?w=img&q={quote(movieName + ' 포스터')}"
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = requests.get(search_url, headers=headers, timeout=5)
        
        # 이미지 URL 패턴 추출
        match = re.search(r'data-original-src="(http[^"]+)"', res.text)
        if match:
            return {"url": match.group(1).replace("&amp;", "&")}
        return {"url": ""}
    except:
        return {"url": ""}

# ---------------------------------------------------------
# [기능 3] 일별 박스오피스 Fallback API
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
# [기능 5] 트렌드 API
# ---------------------------------------------------------
@app.get("/kobis/trend")
def trend(movieCd: str = Query(...), openDt: str = Query(None)):
    if not KOBIS_API_KEY: return []
    
    today = datetime.now()
    yesterday = today - timedelta(days=1)
    
    start_date = today - timedelta(days=30)
    if openDt:
        try:
            start_date = datetime.strptime(openDt.replace("-",""), "%Y%m%d")
        except: pass
        
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
        
    clean = [r for r in results if r]
    clean.sort(key=lambda x: x['date'])
    return clean

# ---------------------------------------------------------
# [기능 6] 실시간 예매 정보 (Fallback용 API)
# ---------------------------------------------------------
@app.get("/api/realtime")
def get_realtime_ranking():
    return {"status": "ok", "data": [], "crawledTime": ""}

@app.get("/api/reservation")
def get_reservation(movieName: str = Query(...)):
    # 상세 화면 등에서 호출 시 크롤링하여 정보 제공
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
