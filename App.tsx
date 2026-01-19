import React, { useState, useEffect, useMemo } from 'react';
import { getYesterdayStr, formatDateDisplay } from './constants';
import { fetchDailyBoxOffice, fetchRealtimeRanking } from './services/kobisService';
import { DailyBoxOfficeList, RealtimeMovie } from './types';
import MovieListItem from './components/MovieListItem';
import DetailView from './components/DetailView';
import SearchBar from './components/SearchBar';
import { Calendar, AlertCircle, Clock } from 'lucide-react';

type BoxOfficeType = 'DAILY' | 'REALTIME';

const App: React.FC = () => {
  const [targetDate, setTargetDate] = useState<string>(getYesterdayStr());
  const [boxOfficeType, setBoxOfficeType] = useState<BoxOfficeType>('DAILY');
  
  const [movieList, setMovieList] = useState<(DailyBoxOfficeList | RealtimeMovie)[]>([]);
  const [crawledTime, setCrawledTime] = useState<string>('');
  
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMovie, setSelectedMovie] = useState<DailyBoxOfficeList | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      setMovieList([]);

      try {
        if (boxOfficeType === 'DAILY') {
          // 일별 데이터 로드
          const data = await fetchDailyBoxOffice(targetDate);
          if (data.boxOfficeResult && data.boxOfficeResult.dailyBoxOfficeList) {
            setMovieList(data.boxOfficeResult.dailyBoxOfficeList);
          }
        } else {
          // 실시간 데이터 로드
          const { data, crawledTime } = await fetchRealtimeRanking();
          setMovieList(data);
          setCrawledTime(crawledTime);
        }
      } catch (err) {
        setError('데이터를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };
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
      setSelectedMovie(movie);
    } else {
      // 실시간 데이터를 상세보기가 가능한 형태(DailyBoxOfficeList)로 변환
      const converted: DailyBoxOfficeList = {
        rnum: movie.rank, rank: movie.rank, rankInten: '0', rankOldAndNew: 'OLD',
        movieCd: movie.movieCd, movieNm: movie.title, openDt: '',
        salesAmt: movie.salesAmt, salesShare: movie.rate.replace('%', ''),
        salesInten: '0', salesChange: '0', salesAcc: movie.salesAcc,
        audiCnt: movie.audiCnt, audiInten: '0', audiChange: '0', audiAcc: movie.audiAcc,
        scrnCnt: '0', showCnt: '0'
      };
      setSelectedMovie(converted);
    }
  };

  const dateInputValue = `${targetDate.substring(0, 4)}-${targetDate.substring(4, 6)}-${targetDate.substring(6, 8)}`;

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center">
      <div className="w-full max-w-md bg-white min-h-screen shadow-2xl relative flex flex-col">
        
        {/* Header */}
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
                <label htmlFor="date-picker" className="flex items-center gap-2 text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-blue-100">
                  <Calendar size={16} />
                  {dateInputValue}
                </label>
                <input id="date-picker" type="date" className="absolute inset-0 opacity-0 cursor-pointer"
                  value={dateInputValue} max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setTargetDate(e.target.value.replace(/-/g, ''))}
                />
              </div>
            )}
            
            {boxOfficeType === 'REALTIME' && crawledTime && (
               <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1.5 rounded-lg border border-indigo-100">
                 <Clock size={14} />
                 <span>{crawledTime} 기준</span>
               </div>
            )}
          </div>

          {/* 탭 버튼 */}
          <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
            <button 
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'DAILY' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'
              }`}
              onClick={() => setBoxOfficeType('DAILY')}
            >
              일별 박스오피스
            </button>
            <button 
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'REALTIME' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'
              }`}
              onClick={() => setBoxOfficeType('REALTIME')}
            >
              실시간 예매율
            </button>
          </div>
          
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
        </header>

        {/* 목록 */}
        <main className="flex-1 p-4 bg-slate-50/50">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 gap-4">
               <div className={`w-10 h-10 border-4 ${boxOfficeType === 'DAILY' ? 'border-blue-500' : 'border-indigo-500'} border-t-transparent rounded-full animate-spin`}></div>
               <p className="text-slate-400 text-sm font-medium">데이터를 불러오는 중...</p>
             </div>
          ) : filteredList.length === 0 ? (
            <div className="text-center py-20 text-slate-400"><p>데이터가 없습니다.</p></div>
          ) : (
            <ul className="pb-10">
              {filteredList.map((movie) => (
                <MovieListItem 
                  key={movie.movieCd} 
                  movie={movie} 
                  type={boxOfficeType} // [중요] 타입 전달
                  onClick={handleMovieClick} 
                />
              ))}
            </ul>
          )}
        </main>
        
        <div className="text-center py-6 bg-slate-50 text-[10px] text-slate-400 border-t border-slate-100">
          데이터 출처: 영화진흥위원회(KOBIS)<br/>Copyright © BoxOffice Pro
        </div>

        <DetailView movie={selectedMovie} targetDate={targetDate} onClose={() => setSelectedMovie(null)} />
      </div>
    </div>
  );
};

export default App;
