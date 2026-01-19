import React, { useState, useEffect, useMemo } from 'react';
import { getYesterdayStr, formatDateDisplay } from './constants';
import { fetchDailyBoxOffice, fetchRealtimeRanking } from './services/kobisService'; // fetchRealtimeRanking 추가
import { DailyBoxOfficeList, RealtimeMovie } from './types';
import MovieListItem from './components/MovieListItem';
import DetailView from './components/DetailView';
import SearchBar from './components/SearchBar';
import { Calendar, AlertCircle, Clock } from 'lucide-react';

// 타입 정의 변경
type BoxOfficeType = 'DAILY' | 'REALTIME';

const App: React.FC = () => {
  const [targetDate, setTargetDate] = useState<string>(getYesterdayStr());
  const [boxOfficeType, setBoxOfficeType] = useState<BoxOfficeType>('DAILY');
  
  // 데이터 상태 관리 (Union Type 사용)
  const [movieList, setMovieList] = useState<(DailyBoxOfficeList | RealtimeMovie)[]>([]);
  const [crawledTime, setCrawledTime] = useState<string>(''); // 크롤링 시간 저장
  
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // 상세보기를 위해 호환성 유지 (클릭 시 변환해서 전달)
  const [selectedMovie, setSelectedMovie] = useState<DailyBoxOfficeList | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      setMovieList([]);

      try {
        if (boxOfficeType === 'DAILY') {
          // 1. 일별 박스오피스 로드
          const data = await fetchDailyBoxOffice(targetDate);
          if (data.boxOfficeResult && data.boxOfficeResult.dailyBoxOfficeList) {
            setMovieList(data.boxOfficeResult.dailyBoxOfficeList);
          }
        } else {
          // 2. 실시간 예매율 로드
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
      // 타입에 따라 제목 필드가 다름 (movieNm vs title)
      const title = 'movieNm' in m ? m.movieNm : m.title;
      return title.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [movieList, searchQuery]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/-/g, '');
    if (val) setTargetDate(val);
  };

  // 상세 보기 클릭 핸들러 (타입 변환)
  const handleMovieClick = (movie: DailyBoxOfficeList | RealtimeMovie) => {
    if ('movieNm' in movie) {
      // 이미 DailyBoxOfficeList 타입인 경우
      setSelectedMovie(movie);
    } else {
      // RealtimeMovie를 DailyBoxOfficeList 형식으로 변환하여 전달
      // (DetailView가 DailyBoxOfficeList를 기대하므로)
      const converted: DailyBoxOfficeList = {
        rnum: movie.rank,
        rank: movie.rank,
        rankInten: '0',
        rankOldAndNew: 'OLD',
        movieCd: movie.movieCd,
        movieNm: movie.title,
        openDt: '', // 상세정보에서 로드됨
        salesAmt: movie.salesAmt,
        salesShare: movie.rate.replace('%', ''),
        salesInten: '0',
        salesChange: '0',
        salesAcc: movie.salesAcc,
        audiCnt: movie.audiCnt,
        audiInten: '0',
        audiChange: '0',
        audiAcc: movie.audiAcc,
        scrnCnt: '0',
        showCnt: '0'
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
                {boxOfficeType === 'DAILY' ? '일별 박스오피스 리포트' : 'KOBIS 실시간 예매율 집계'}
              </p>
            </div>
            
            {/* 날짜 선택 (일별 모드일 때만 표시) */}
            {boxOfficeType === 'DAILY' && (
              <div className="relative">
                <label htmlFor="date-picker" className="flex items-center gap-2 text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors">
                  <Calendar size={16} />
                  {formatDateDisplay(targetDate)}
                </label>
                <input
                  id="date-picker"
                  type="date"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  value={dateInputValue}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={handleDateChange}
                />
              </div>
            )}

            {/* 실시간 모드일 때는 조회 시간 표시 */}
            {boxOfficeType === 'REALTIME' && crawledTime && (
               <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1.5 rounded-lg border border-indigo-100">
                 <Clock size={14} />
                 <span>{crawledTime} 기준</span>
               </div>
            )}
          </div>

          {/* Type Toggle */}
          <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
            <button 
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'DAILY' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setBoxOfficeType('DAILY')}
            >
              일별 박스오피스
            </button>
            <button 
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'REALTIME' 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setBoxOfficeType('REALTIME')}
            >
              실시간 예매율
            </button>
          </div>
          
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
        </header>

        {/* Content */}
        <main className="flex-1 p-4 bg-slate-50/50">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 gap-4">
               <div className={`w-10 h-10 border-4 ${boxOfficeType === 'DAILY' ? 'border-blue-500' : 'border-indigo-500'} border-t-transparent rounded-full animate-spin`}></div>
               <p className="text-slate-400 text-sm font-medium">
                 {boxOfficeType === 'DAILY' ? '일별 데이터' : '실시간 예매율'}를 불러오는 중...
               </p>
             </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4">
              <AlertCircle size={40} className="text-red-400 mb-3" />
              <p className="text-slate-600 font-medium mb-1">오류가 발생했습니다</p>
              <p className="text-slate-400 text-sm">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="mt-4 text-blue-500 font-semibold text-sm hover:underline"
              >
                다시 시도하기
              </button>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <p>데이터가 없거나 검색 결과가 없습니다.</p>
            </div>
          ) : (
            <ul className="pb-10">
              {filteredList.map((movie) => (
                <MovieListItem 
                  // movieCd를 key로 사용 (양쪽 타입 모두 존재)
                  key={movie.movieCd} 
                  movie={movie} 
                  type={boxOfficeType}
                  onClick={handleMovieClick} 
                />
              ))}
            </ul>
          )}
        </main>

        {/* Footer Info */}
        <div className="text-center py-6 bg-slate-50 text-[10px] text-slate-400 border-t border-slate-100">
          데이터 출처: 영화진흥위원회(KOBIS)<br/>
          Copyright © BoxOffice Pro
        </div>

        {/* Detail Modal */}
        <DetailView 
          movie={selectedMovie} 
          targetDate={targetDate}
          onClose={() => setSelectedMovie(null)} 
        />
      </div>
    </div>
  );
};

export default App;
