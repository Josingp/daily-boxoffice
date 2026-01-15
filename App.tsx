import React, { useState, useEffect, useMemo } from 'react';
import { getYesterdayStr, formatDateDisplay } from './constants';
import { fetchDailyBoxOffice, fetchWeeklyBoxOffice } from './services/kobisService';
import { DailyBoxOfficeList } from './types';
import MovieListItem from './components/MovieListItem';
import DetailView from './components/DetailView';
import SearchBar from './components/SearchBar';
import { Calendar, AlertCircle } from 'lucide-react';

type BoxOfficeType = 'DAILY' | 'WEEKLY';

const App: React.FC = () => {
  const [targetDate, setTargetDate] = useState<string>(getYesterdayStr());
  const [boxOfficeType, setBoxOfficeType] = useState<BoxOfficeType>('DAILY');
  const [boxOfficeList, setBoxOfficeList] = useState<DailyBoxOfficeList[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMovie, setSelectedMovie] = useState<DailyBoxOfficeList | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      setBoxOfficeList([]); // Clear list on load

      try {
        let data;
        if (boxOfficeType === 'DAILY') {
          data = await fetchDailyBoxOffice(targetDate);
          if (data.boxOfficeResult && data.boxOfficeResult.dailyBoxOfficeList) {
            setBoxOfficeList(data.boxOfficeResult.dailyBoxOfficeList);
          }
        } else {
          // Fetch Weekend (Fri-Sun) Box Office
          data = await fetchWeeklyBoxOffice(targetDate, "1"); 
          if (data.boxOfficeResult && data.boxOfficeResult.weeklyBoxOfficeList) {
            setBoxOfficeList(data.boxOfficeResult.weeklyBoxOfficeList);
          }
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
    return boxOfficeList.filter(m => 
      m.movieNm.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [boxOfficeList, searchQuery]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/-/g, '');
    if (val) setTargetDate(val);
  };

  // Convert YYYYMMDD to YYYY-MM-DD for input value
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
                {boxOfficeType === 'DAILY' ? '일별' : '주말(금~일)'} 박스오피스 리포트
              </p>
            </div>
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
          </div>

          {/* Type Toggle */}
          <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
            <button 
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'DAILY' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setBoxOfficeType('DAILY')}
            >
              일별
            </button>
            <button 
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                boxOfficeType === 'WEEKLY' 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setBoxOfficeType('WEEKLY')}
            >
              주간/주말
            </button>
          </div>
          
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
        </header>

        {/* Content */}
        <main className="flex-1 p-4 bg-slate-50/50">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 gap-4">
               <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
               <p className="text-slate-400 text-sm font-medium">
                 {boxOfficeType === 'DAILY' ? '일별 데이터' : '주말 데이터'}를 불러오는 중...
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
              {boxOfficeType === 'WEEKLY' && (
                <p className="text-xs mt-2 opacity-70">
                  * 주말 데이터는 금~일 집계이므로<br/>해당 주말이 지나야 확인 가능할 수 있습니다.
                </p>
              )}
            </div>
          ) : (
            <ul className="pb-10">
              {filteredList.map((movie) => (
                <MovieListItem 
                  key={movie.movieCd} 
                  movie={movie} 
                  onClick={setSelectedMovie} 
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