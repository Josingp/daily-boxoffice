import React, { useState, useEffect, useMemo } from 'react';
import { getYesterdayStr, formatDateDisplay } from './constants';
import { fetchDailyBoxOffice, fetchRealtimeRanking } from './services/kobisService';
import { DailyBoxOfficeList, RealtimeMovie } from './types';
import MovieListItem from './components/MovieListItem';
import DetailView from './components/DetailView';
import SearchBar from './components/SearchBar';
import { Calendar, Clock, RotateCw } from 'lucide-react';

type BoxOfficeType = 'DAILY' | 'REALTIME';

const App: React.FC = () => {
  const [targetDate, setTargetDate] = useState<string>(getYesterdayStr());
  const [boxOfficeType, setBoxOfficeType] = useState<BoxOfficeType>('DAILY');
  
  const [movieList, setMovieList] = useState<(DailyBoxOfficeList | RealtimeMovie)[]>([]);
  const [realtimeMap, setRealtimeMap] = useState<Map<string, any>>(new Map()); // 실시간 데이터 검색용
  const [crawledTime, setCrawledTime] = useState<string>('');
  
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMovie, setSelectedMovie] = useState<DailyBoxOfficeList | null>(null);

  const loadData = async () => {
    setLoading(true);
    setMovieList([]);

    try {
      // 1. 실시간 데이터를 항상 먼저 로드 (일별 탭에서도 정보 매칭을 위해 필요)
      const rtResult = await fetchRealtimeRanking();
      const rtMap = new Map();
      if (rtResult.data) {
        rtResult.data.forEach(m => {
          // 영화 제목을 키로 (공백 제거, 소문자)
          const key = m.title.replace(/\s+/g, '').toLowerCase();
          rtMap.set(key, m);
        });
        setCrawledTime(rtResult.crawledTime);
        setRealtimeMap(rtMap);
      }

      // 2. 현재 탭에 맞는 데이터 로드
      if (boxOfficeType === 'DAILY') {
        const data = await fetchDailyBoxOffice(targetDate);
        if (data.boxOfficeResult?.dailyBoxOfficeList) {
          setMovieList(data.boxOfficeResult.dailyBoxOfficeList);
        }
      } else {
        setMovieList(rtResult.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [targetDate, boxOfficeType]);

  const filteredList = useMemo(() => {
    return movieList.filter(m => {
      const title = 'movieNm' in m ? m.movieNm : m.title;
      return title.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [movieList, searchQuery]);

  const handleMovieClick = (movie: DailyBoxOfficeList | RealtimeMovie) => {
    if ('movieNm' in movie) {
      // [일별 탭] 클릭 시
      // 실시간 데이터 맵에서 해당 영화 정보 검색
      const key = movie.movieNm.replace(/\s+/g, '').toLowerCase();
      const rtInfo = realtimeMap.get(key);
      
      const enrichedMovie = { ...movie };
      
      // 실시간 정보가 있으면 주입 (보라색 카드 + 시간)
      if (rtInfo) {
        enrichedMovie.realtime = {
            rank: rtInfo.rank,
            rate: rtInfo.rate,
            audiCnt: rtInfo.audiCnt,
            salesAmt: rtInfo.salesAmt,
            audiAcc: rtInfo.audiAcc,
            salesAcc: rtInfo.salesAcc,
            crawledTime: crawledTime // 메인 화면의 시간 사용
        };
      }
      setSelectedMovie(enrichedMovie);
    } else {
      // [실시간 탭] 클릭 시
      const converted: DailyBoxOfficeList = {
        rnum: movie.rank, rank: movie.rank, rankInten: '0', rankOldAndNew: 'OLD',
        movieCd: movie.movieCd, movieNm: movie.title, openDt: '',
        salesAmt: movie.salesAmt, salesShare: movie.rate.replace('%', ''),
        salesInten: '0', salesChange: '0', salesAcc: movie.salesAcc,
        audiCnt: movie.audiCnt, audiInten: '0', audiChange: '0', audiAcc: movie.audiAcc,
        scrnCnt: '0', showCnt: '0',
        realtime: {
            rank: movie.rank, rate: movie.rate,
            audiCnt: movie.audiCnt, salesAmt: movie.salesAmt,
            audiAcc: movie.audiAcc, salesAcc: movie.salesAcc,
            crawledTime: crawledTime
        }
      };
      // 상세정보(포스터 등)가 있으면 병합
      if ((movie as any).detail) {
          converted['detail'] = (movie as any).detail;
      }
      setSelectedMovie(converted);
    }
  };

  const dateInputValue = `${targetDate.substring(0, 4)}-${targetDate.substring(4, 6)}-${targetDate.substring(6, 8)}`;

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center font-sans text-slate-900">
      <div className="w-full max-w-md bg-white min-h-screen shadow-2xl relative flex flex-col">
        
        <header className="bg-white px-5 pt-6 pb-4 sticky top-0 z-10 border-b border-slate-100">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">BoxOffice Pro</h1>
              <p className="text-xs text-slate-500 font-medium mt-1">
                {boxOfficeType === 'DAILY' ? '일별 박스오피스 리포트' : 'KOBIS 실시간 예매율'}
              </p>
            </div>
            
            {boxOfficeType === 'DAILY' && (
              <div className="relative">
                <label htmlFor="date-picker" className="flex items-center gap-2 text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors">
                  <Calendar size={16} />
                  {formatDateDisplay(targetDate)}
                </label>
                <input id="date-picker" type="date" className="absolute inset-0 opacity-0 cursor-pointer"
                  value={dateInputValue} max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setTargetDate(e.target.value.replace(/-/g, ''))}
                />
              </div>
            )}
            
            {boxOfficeType === 'REALTIME' && (
               <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1.5 rounded-lg border border-indigo-100">
                 <Clock size={14} />
                 <span>{crawledTime ? `${crawledTime} 기준` : '실시간'}</span>
               </div>
            )}
          </div>

          <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
            <button 
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'DAILY' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setBoxOfficeType('DAILY')}
            >
              일별 박스오피스
            </button>
            <button 
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'REALTIME' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setBoxOfficeType('REALTIME')}
            >
              실시간 예매율
            </button>
          </div>
          
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
        </header>

        <main className="flex-1 p-4 bg-slate-50/50">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 gap-4">
               <div className={`w-10 h-10 border-4 ${boxOfficeType === 'DAILY' ? 'border-blue-500' : 'border-indigo-500'} border-t-transparent rounded-full animate-spin`}></div>
               <p className="text-slate-400 text-sm font-medium">데이터 불러오는 중...</p>
             </div>
          ) : filteredList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-4">
              <p>데이터가 없습니다.</p>
              <button onClick={loadData} className="flex items-center gap-2 text-sm text-blue-500 hover:underline">
                <RotateCw size={16}/> 다시 시도
              </button>
            </div>
          ) : (
            <ul className="pb-10">
              {filteredList.map((movie) => (
                <MovieListItem 
                  key={movie.movieCd} 
                  movie={movie} 
                  type={boxOfficeType}
                  onClick={handleMovieClick} 
                />
              ))}
            </ul>
          )}
        </main>
        
        <div className="text-center py-6 bg-slate-50 text-[10px] text-slate-400 border-t border-slate-100">
          데이터 출처: 영화진흥위원회(KOBIS)<br/>Copyright © BoxOffice Pro
        </div>

        <DetailView 
          movie={selectedMovie} 
          targetDate={targetDate} 
          type={boxOfficeType}
          onClose={() => setSelectedMovie(null)} 
        />
      </div>
    </div>
  );
};

export default App;
