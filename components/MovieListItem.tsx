import React from 'react';
import { DailyBoxOfficeList, RealtimeMovie } from '../types';
import { formatNumber } from '../constants';
import { ChevronRight, Ticket, Users, BarChart2 } from 'lucide-react';

interface MovieListItemProps {
  movie: DailyBoxOfficeList | RealtimeMovie;
  type: 'DAILY' | 'REALTIME';
  onClick: (movie: any) => void;
}

const MovieListItem: React.FC<MovieListItemProps> = ({ movie, type, onClick }) => {
  const rank = Number(movie.rank);
  const isTop3 = rank <= 3;
  
  const isDaily = (m: any): m is DailyBoxOfficeList => type === 'DAILY';
  const title = isDaily(movie) ? movie.movieNm : movie.title;
  const isNew = isDaily(movie) ? movie.rankOldAndNew === 'NEW' : false;

  return (
    <li 
      onClick={() => onClick(movie)}
      className="group bg-white p-4 rounded-xl border border-slate-100 mb-3 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer flex items-center gap-4 active:scale-[0.99]"
    >
      <div className={`
        w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shadow-sm shrink-0
        ${isTop3 ? 'bg-gradient-to-br from-red-500 to-orange-500 text-white' : 'bg-slate-800 text-white'}
      `}>
        {movie.rank}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base font-bold text-slate-800 truncate">{title}</span>
          {isNew && (
            <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">NEW</span>
          )}
        </div>
        
        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
          {isDaily(movie) ? (
            // [수정] 일별 모드: 일일 관객 + 누적 관객 표시
            <>
              <span className="flex items-center gap-1 font-medium text-slate-600">
                <Users size={12}/> {formatNumber(movie.audiCnt)}명
              </span>
              <span className="w-px h-3 bg-slate-200"></span>
              <span className="text-slate-400">누적 {formatNumber(movie.audiAcc)}명</span>
            </>
          ) : (
            // [수정] 실시간 모드: 예매율 강조
            <>
              <span className="flex items-center gap-1 text-indigo-600 font-bold">
                <Ticket size={12}/> 예매율 {movie.rate}
              </span>
              {/* 예매 관객수가 있으면 표시 */}
              {movie.audiCnt !== "0" && (
                <>
                  <span className="w-px h-3 bg-slate-200"></span>
                  <span>예매 {formatNumber(movie.audiCnt)}명</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
    </li>
  );
};

export default MovieListItem;
