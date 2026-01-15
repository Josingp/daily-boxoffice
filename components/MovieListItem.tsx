import React from 'react';
import { DailyBoxOfficeList } from '../types';
import { formatNumber } from '../constants';
import { ChevronRight } from 'lucide-react';

interface MovieListItemProps {
  movie: DailyBoxOfficeList;
  onClick: (movie: DailyBoxOfficeList) => void;
}

const MovieListItem: React.FC<MovieListItemProps> = ({ movie, onClick }) => {
  const rank = Number(movie.rank);
  const isTop3 = rank <= 3;

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
          <span className="text-base font-bold text-slate-800 truncate">{movie.movieNm}</span>
          {movie.rankOldAndNew === 'NEW' && (
            <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">NEW</span>
          )}
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>일일 {formatNumber(movie.audiCnt)}명</span>
            <span className="w-0.5 h-3 bg-slate-300"></span>
            <span>예매율 {movie.salesShare}%</span>
        </div>
      </div>

      <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
    </li>
  );
};

export default MovieListItem;