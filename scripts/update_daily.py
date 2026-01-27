import os
import json
import requests
import re
import datetime
import time
from bs4 import BeautifulSoup

# --- [설정] ---
REALTIME_FILE = "public/realtime_data.json"
DAILY_FILE = "public/daily_data.json"
MANUAL_FILE = "manual_data.json"
KOBIS_REALTIME_URL = "https://www.kobis.or.kr/kobis/business/stat/boxs/findRealTicketList.do"
KOBIS_DETAIL_URL = "https://www.kobis.or.kr/kobisopenapi/webservice/rest/movie/searchMovieInfo.json"
KOBIS_API_KEY = os.environ.get("KOBIS_API_KEY")

# JavaScript 함수 mstView('movie', '20231234') 에서 코드 추출용
MSTVIEW_REGEX = re.compile(r"mstView\s*\(\s*['\"]movie['\"]\s*,\s*['\"]([0-9]+)['\"]\s*\)")

def load_json(filepath):
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}
    return {}

def fetch_movie_detail(movie_cd):
    if not KOBIS_API_KEY or not movie_cd: return None
    try:
        url = f"{KOBIS_DETAIL_URL}?key={KOBIS_API_KEY}&movieCd={movie_cd}"
        res = requests.get(url, timeout=3)
        return res.json().get("movieInfoResult", {}).get("movieInfo")
    except: return None

def is_same_data(last, new):
    """
    직전 데이터와 비교해서 변화가 없으면 저장하지 않음 (중복 방지)
    """
    if not last: return False
    # 순위, 예매율, 예매관객수가 모두 같으면 같은 데이터로 간주
    return (
        last['rank'] == new['rank'] and
        last['rate'] == new['rate'] and
        last['audiCnt'] == new['audiCnt']
    )

def update_realtime():
    print("Updating Realtime Data...")
    
    # 기존 데이터 로드 (히스토리 유지를 위해 필수)
    realtime_data = load_json(REALTIME_FILE)
    daily_data = load_json(DAILY_FILE)
    manual_data = load_json(MANUAL_FILE)
    
    # 기존 Daily 데이터에서 상세정보 캐시 확보 (API 호출 절약)
    detail_cache_cd = {}
    if "movies" in daily_data:
        for m in daily_data["movies"]:
            if "movieCd" in m and "detail" in m:
                detail_cache_cd[m["movieCd"]] = m["detail"]

    session = requests.Session()
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'}
    
    try:
        # 1. KOBIS 페이지 접속 (세션 쿠키 및 CSRF 토큰 획득)
        visit = session.get(KOBIS_REALTIME_URL, headers=headers, timeout=10)
        soup = BeautifulSoup(visit.text, 'html.parser')
        csrf_input = soup.find('input', {'name': 'CSRFToken'})
        if not csrf_input:
            print("CSRF Token not found.")
            return
        csrf = csrf_input['value']
        
        # 2. 데이터 요청 (POST)
        resp = session.post(KOBIS_REALTIME_URL, headers=headers, data={
            'CSRFToken': csrf, 
            'dmlMode': 'search', 
            'allMovieYn': 'Y', # 전체 영화 조회
            'loadEnd': '0'
        }, timeout=20)
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # 조회 시간 파싱
        crawled_time = ""
        try:
            txt = soup.get_text()
            match = re.search(r"조회일시\s*:\s*(\d{4}[./-]\d{2}[./-]\d{2}\s+\d{2}:\d{2})", txt)
            if match: crawled_time = match.group(1).replace("/", "-")
        except: pass
        if not crawled_time: 
            crawled_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        rows = soup.find_all("tr")
        count = 0
        
        # 메타 데이터 저장소 초기화
        if "meta" not in realtime_data: realtime_data["meta"] = {}

        # 3. 영화 목록 파싱
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 8: continue
            
            rank = cols[0].get_text(strip=True)
            if not rank.isdigit(): continue
            
            # 영화 제목 및 코드 추출
            target_link = row.find("a", onclick=MSTVIEW_REGEX.search)
            title = ""
            movie_cd = ""
            
            if target_link:
                title = target_link.get("title", "").strip() or target_link.get_text(strip=True)
                match = MSTVIEW_REGEX.search(target_link['onclick'])
                if match: movie_cd = match.group(1)
            else:
                title = cols[1].get_text(strip=True)
            
            if not title: continue
            
            # [상세 정보 확보]
            # 이미 있는 메타 정보는 유지하되, 없으면 API/캐시/수동데이터에서 찾음
            if title not in realtime_data["meta"] or "posterUrl" not in realtime_data["meta"][title]:
                found_detail = None
                
                # A. API/캐시 데이터 먼저 확인
                if movie_cd and movie_cd in detail_cache_cd:
                    found_detail = detail_cache_cd[movie_cd]
                elif movie_cd and int(rank) <= 20: # 상위 20위만 API 호출 (제한 고려)
                    found_detail = fetch_movie_detail(movie_cd)
                    if found_detail: time.sleep(0.1)

                if not found_detail: found_detail = {}
                
                # B. 수동 데이터(포스터 등) 병합
                clean_title = title.replace(" ", "")
                for m_title, m_info in manual_data.items():
                    if m_title.replace(" ", "") == clean_title:
                        found_detail.update(m_info) 
                        break
                
                # 메타데이터 저장
                realtime_data["meta"][title] = found_detail

            # 데이터 추출
            rate = cols[3].get_text(strip=True).replace('%', '')
            audi_cnt_raw = cols[6].get_text(strip=True)
            sales_amt_raw = cols[4].get_text(strip=True)
            audi_acc_raw = cols[7].get_text(strip=True)
            sales_acc_raw = cols[5].get_text(strip=True)

            # [핵심] 히스토리 데이터 구조 초기화
            # 키는 영화 제목 (공백 제거하여 매칭 확률 높여도 좋지만 여기선 원본 제목 사용)
            if title not in realtime_data: realtime_data[title] = []
            
            new_entry = {
                "time": crawled_time,
                "rank": int(rank),
                "rate": float(rate) if rate else 0,
                "audiCnt": audi_cnt_raw, 
                "salesAmt": sales_amt_raw,
                "audiAcc": audi_acc_raw,
                "salesAcc": sales_acc_raw,
                # 그래프 그리기 편하게 숫자형 변환 값 미리 저장
                "val_audi": int(audi_cnt_raw.replace(',', '')) if audi_cnt_raw.replace(',', '').isdigit() else 0,
                "val_rate": float(rate) if rate else 0
            }
            
            # 마지막 데이터와 비교하여 중복 아니면 추가
            last = realtime_data[title][-1] if realtime_data[title] else None
            
            if is_same_data(last, new_entry):
                # 데이터가 같으면 시간만 업데이트 (최신 조회 시간으로)
                realtime_data[title][-1]['time'] = crawled_time
            else:
                realtime_data[title].append(new_entry)
            
            # 데이터가 너무 많이 쌓이면 오래된 것 삭제 (최근 288개 = 약 12일치 유지)
            if len(realtime_data[title]) > 288:
                realtime_data[title] = realtime_data[title][-288:]
            
            count += 1

        # 4. 파일 저장
        if count > 0:
            if not os.path.exists("public"): os.makedirs("public")
            with open(REALTIME_FILE, 'w', encoding='utf-8') as f:
                json.dump(realtime_data, f, ensure_ascii=False, indent=2)
            print(f"✅ Updated {count} movies at {crawled_time}")
        else:
            print("⚠️ No data parsed.")

    except Exception as e:
        print(f"❌ Update Failed: {e}")

if __name__ == "__main__":
    update_realtime()
