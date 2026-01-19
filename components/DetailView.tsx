import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieTrend, fetchMovieDetail, fetchRealtimeReservation } from '../services/kobisService';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, Ticket, Monitor, PlayCircle, BarChart3 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DetailViewProps {
  movie: DailyBoxOfficeList | null;
  targetDate: string;
  type: 'DAILY' | 'REALTIME'; // 타입 추가
  onClose: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({ movie, targetDate, type, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [realtimeHistory, setRealtimeHistory] = useState<any[]>([]); // GitHub 데이터
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [analysis, setAnalysis] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (movie) {
      setIsVisible(true);
      loadData(movie);
    } else {
      setIsVisible(false);
    }
  }, [movie]);

  const loadData = async (movie: DailyBoxOfficeList) => {
    setLoading(true);
    setAnalysis('');
    setTrendData([]);
    setRealtimeHistory([]);

    try {
      const info = await fetchMovieDetail(movie.movieCd);
      setMovieDetail(info);

      if (type === 'DAILY') {
        // [DAILY] KOBIS 과거 트렌드 로드
        const trend = await fetchMovieTrend(movie.movieCd, targetDate);
        setTrendData(trend);
        
        // AI 분석 요청 (Daily)
        requestAnalysis(movie.movieNm, trend, info, movie.audiAcc, 'DAILY', null);

      } else {
        // [REALTIME] GitHub에서 누적된 예매율 데이터 로드
        try {
          const res = await fetch('/history.json'); // public 폴더의 파일
          if (res.ok) {
            const json = await res.json();
            const history = json[movie.movieNm] || [];
            setRealtimeHistory(history);
            // AI 분석 요청 (Realtime + History)
            requestAnalysis(movie.movieNm, [], info, movie.audiAcc, 'REALTIME', history);
          }
        } catch (e) { console.error("History Load Failed", e); }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const requestAnalysis = async (name: string, trend: any, info: any, total: string, type: string, history: any) => {
    try {
        const res = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movieName: name,
                trendData: trend,
                movieInfo: info,
                currentAudiAcc: total,
                type: type,
                historyData: history
            })
        });
        const data = await res.json();
        setAnalysis(data.analysisText);
    } catch(e) {}
  };

  const handleShare = async () => {
    if (navigator.share) try { await navigator.share({ title: movie?.movieNm, text: 'BoxOffice Pro Analysis' }); } catch {}
    else alert('복사되었습니다.');
  };

  if (!movie) return null;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
        <div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${type === 'DAILY' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600'}`}>
             {type === 'DAILY' ? '일별 박스오피스' : '실시간 예매율'}
          </span>
          <h2 className="text-xl font-bold text-slate-800 leading-tight mt-1">{movie.movieNm}</h2>
        </div>
        <button onClick={onClose} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 bg-slate-50/30">
        
        {/* 영화 기본 정보 */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-sm text-slate-600 space-y-1">
           <div className="flex gap-2"><Film size={14}/> 감독: {movieDetail?.directors?.map(d=>d.peopleNm).join(', ') || '-'}</div>
           <div className="flex gap-2"><User size={14}/> 출연: {movieDetail?.actors?.slice(0,3).map(a=>a.peopleNm).join(', ') || '-'}</div>
           <div className="flex gap-2"><CalendarIcon size={14}/> 개봉: {movieDetail?.openDt || '-'}</div>
        </div>

        {/* [분기] DAILY 모드: 상세 스탯 */}
        {type === 'DAILY' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><TrendingUp size={14}/><span className="text-xs">일일 관객</span></div>
                <div className="text-lg font-bold">{formatNumber(movie.audiCnt)}명</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><DollarSign size={14}/><span className="text-xs">매출액</span></div>
                <div className="text-lg font-bold">{formatKoreanNumber(movie.salesAmt)}원</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><Monitor size={14}/><span className="text-xs">스크린 수</span></div>
                <div className="text-lg font-bold">{formatNumber(movie.scrnCnt)}개</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><PlayCircle size={14}/><span className="text-xs">상영 횟수</span></div>
                <div className="text-lg font-bold">{formatNumber(movie.showCnt)}회</div>
            </div>
          </div>
        )}

        {/* [분기] REALTIME 모드: 예매율 추이 그래프 (GitHub Data) */}
        {type === 'REALTIME' && (
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
             <div className="flex items-center gap-2 mb-4 text-indigo-600 font-bold text-sm">
               <BarChart3 size={16}/> 실시간 예매율 추이 (History)
             </div>
             {realtimeHistory.length > 0 ? (
               <div className="h-48 w-full">
                 <ResponsiveContainer width="100%" height="100%">
                   <AreaChart data={realtimeHistory}>
                     <defs>
                       <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                         <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                         <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                       </linearGradient>
                     </defs>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} />
                     <XAxis dataKey="time" hide />
                     <YAxis domain={['auto', 'auto']} fontSize={10} />
                     <Tooltip />
                     <Area type="monotone" dataKey="rate" stroke="#6366f1" fill="url(#colorRate)" />
                   </AreaChart>
                 </ResponsiveContainer>
               </div>
             ) : (
               <div className="h-20 flex items-center justify-center text-xs text-slate-400">
                 누적된 데이터가 없습니다. (1시간 후 업데이트 됨)
               </div>
             )}
          </div>
        )}

        {/* 공통: AI 분석 리포트 */}
        {analysis ? (
          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm">
              <Sparkles size={16} className="text-purple-600"/> 
              AI 데이터 분석
            </div>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line text-justify break-keep">
              {analysis}
            </p>
          </div>
        ) : (
          <div className="h-24 bg-slate-100 rounded-xl animate-pulse"/>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 pb-8">
        <button onClick={handleShare} className="w-full bg-[#FEE500] text-[#3c1e1e] font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-sm">
          <Share2 size={18} /><span>공유하기</span>
        </button>
      </div>
    </div>
  );
};

export default DetailView;
