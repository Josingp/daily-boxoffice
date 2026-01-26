import React from 'react';
import { DramaItem } from '../types';
import { Tv } from 'lucide-react';

interface DramaListProps {
  items: DramaItem[];
  title: string;
  onItemClick?: (item: DramaItem) => void;
}

const DramaList: React.FC<DramaListProps> = ({ items, title, onItemClick }) => {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-bold text-slate-800 mb-3 px-2 flex items-center gap-2">
        <Tv size={18} className="text-purple-600"/> {title}
      </h3>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {items.length === 0 ? (
           <div className="p-4 text-center text-slate-400 text-sm">데이터가 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((item, idx) => (
              <div 
                key={idx} 
                onClick={() => onItemClick && onItemClick(item)} 
                className="flex items-center p-3 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className={`w-8 text-center font-black text-lg ${idx < 3 ? 'text-purple-600' : 'text-slate-400'}`}>
                  {item.rank}
                </span>
                <div className="flex-1 px-3">
                  <div className="font-bold text-slate-800 text-sm">{item.title}</div>
                  <div className="text-[11px] text-slate-400">{item.channel}</div>
                </div>
                <div className="text-right">
                  {/* [수정] 여기에 % 단위 추가 */}
                  <div className="font-black text-slate-800 text-sm">{item.rating}%</div>
                  <div className="text-[10px] text-slate-400">시청률</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DramaList;
