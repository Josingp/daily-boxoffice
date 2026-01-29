import React, { useState } from 'react';
import { DramaItem } from '../types';
import { ChevronDown, ChevronUp, Monitor, Tv } from 'lucide-react';

interface DramaListProps {
  title: string;
  items: DramaItem[];
  onItemClick: (item: DramaItem) => void;
}

const DramaList: React.FC<DramaListProps> = ({ title, items, onItemClick }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!items || items.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div 
        className="flex items-center justify-between p-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            {title.includes('주간') ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> : <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>}
            {title}
        </h3>
        {isExpanded ? <ChevronUp size={14} className="text-slate-400"/> : <ChevronDown size={14} className="text-slate-400"/>}
      </div>
      
      {isExpanded && (
        <div className="divide-y divide-slate-50">
          {items.map((item, idx) => (
            <div 
                key={idx} 
                onClick={() => onItemClick(item)}
                className="flex items-center p-3 hover:bg-purple-50/50 transition-colors cursor-pointer group"
            >
              <div className={`w-6 text-center font-black text-lg italic ${idx < 3 ? 'text-purple-600' : 'text-slate-300'}`}>
                {item.rank}
              </div>
              <div className="flex-1 min-w-0 ml-3">
                <div className="text-xs text-slate-400 mb-0.5 flex items-center gap-1">
                    <span className="bg-slate-100 px-1 py-0.5 rounded text-[9px] font-bold text-slate-500">
                        {item.mediaType || item.channel} 
                    </span>
                    {/* 미디어 타입이 별도로 있으면 채널명도 표시 */}
                    {item.mediaType && item.mediaType !== item.channel && (
                        <span>{item.channel}</span>
                    )}
                </div>
                <div className="text-sm font-bold text-slate-800 truncate group-hover:text-purple-700 transition-colors">
                    {item.title}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-black text-slate-800">{item.rating}%</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DramaList;
