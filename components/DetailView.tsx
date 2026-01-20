import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieDetail, fetchMovieNews, fetchMoviePoster, fetchRealtimeReservation, NewsItem } from '../services/kobisService';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, ExternalLink, Newspaper, Monitor, PlayCircle, Users, Check, Clock, Bot } from 'lucide-react';

interface DetailViewProps {
  movie: DailyBoxOfficeList | null;
  targetDate: string;
  type: 'DAILY' | 'REALTIME';
  onClose: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({ movie, targetDate, type, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [chartMetric, setChartMetric] = useState<'audi' | 'sales' | 'scrn' | 'show'>('audi');
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [realtimeHistory, setRealtimeHistory] = useState<any[]>([]);
  const [realtimeInfo, setRealtimeInfo] = useState<any>(null);
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [posterUrl, setPosterUrl] = useState<string>('');
  
  // AI 관련 State
  const [analysis, setAnalysis] = useState<string>('');
  const [predictionSeries, setPredictionSeries] = useState<number[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (movie) {
      setIsVisible(true);
      loadData(movie);
    } else {
      setIsVisible(false);
      // 초기화
      setAnalysis('');
      setPredictionSeries([]);
    }
  }, [movie]);

  const getDDay = (openDt: string) => {
      if (!openDt) return '';
      const start = new Date(openDt.replace(/-/g, '/'));
      const now = new Date();
      const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return diff >= 0 ? `(개봉 ${diff + 1}일차)` : `(D-${Math.abs(diff)})`;
  };

  const loadData = async (movie: DailyBoxOfficeList) => {
    setLoading(true);
    setTrendData(movie.trend || []);
    setRealtimeHistory([]);
    setRealtimeInfo(movie.realtime || null);
    setNewsList([]);
    setPosterUrl('');
    setMovieDetail(null);
    setChartMetric('audi');

    try {
      const [info, poster, news] = await Promise.all([
          fetchMovieDetail(movie.movieCd),
          fetchMoviePoster(movie.movieNm),
          fetchMovieNews(movie.movieNm)
      ]);
      setMovieDetail(info);
      setPosterUrl(poster);
      setNewsList(news.length > 0 ? news : []);

      let currentRt = movie.realtime;
      if (!currentRt) {
          const live = await fetchRealtimeReservation(movie.movieNm, movie.movieCd);
          if (live.data) {
              currentRt = { ...live.data, crawledTime: live.crawledTime };
              setRealtimeInfo(currentRt);
          }
      }

      if (type === 'REALTIME') {
        try {
          const res = await fetch(`/realtime_data.json?t=${Date.now()}`);
          if (res.ok) {
            const json = await res.json();
            const history = json[movie.movieNm] || [];
            if (history.length === 0 && currentRt) {
                history.push({
                    time: currentRt.crawledTime || new Date().toISOString(),
                    rate: currentRt.rate, 
                    val_audi: parseInt(currentRt.audiCnt.replace(/,/g,'')),
                    audiCnt: currentRt.audiCnt
                });
            }
            setRealtimeHistory(history);
          }
        } catch {}
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // [버튼 클릭 시 실행] AI 분석 요청
  const handleAiAnalysis = async () => {
    if (!movie) return;
    setIsAiLoading(true);
    try {
        const payload = {
            movieName: movie.movieNm,
            trendData: type === 'DAILY' ? trendData : [],
            movieInfo: movieDetail,
            currentAudiAcc: movie.audiAcc,
            type: type,
            historyData: type === 'REALTIME' ? realtimeHistory : []
        };

        const res = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.analysisText) setAnalysis(data.analysisText);
        if (data.predictionSeries) setPredictionSeries(data.predictionSeries);

    } catch (e) {
        setAnalysis("분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
        setIsAiLoading(false);
    }
  };

  const handleShare = async () => {
    if (!movie) return;
    const text = `[BoxOffice Pro] ${movie.movieNm}\n누적관객: ${formatNumber(movie.audiAcc)}명\n${analysis.slice(0,50)}...`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {}
  };

  const openNewsLink = (url: string) => window.open(url, '_blank');
  const IntenBadge = ({ val }: { val?: string | number }) => {
      const v = typeof val === 'string' ? parseInt(val) : (val || 0);
      if (v === 0) return <span className="text-slate-400 text-[10px]">-</span>;
      const isUp = v > 0;
      return <span className={`text-[10px] ${isUp ? 'text-red-500' : 'text-blue-500'} font-medium`}>
          {isUp ? '▲' : '▼'} {Math.abs(v).toLocaleString()}
      </span>;
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
          <h2 className="text-xl font-bold text-slate-800 leading-tight mt-1 pr-4 line-clamp-1">{movie.movieNm}</h2>
        </div>
        <button onClick={onClose} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full shrink-0"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 bg-slate-50/30">
        
        {/* 1. 영화 정보 & 포스터 */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex gap-4">
           <div className="w-24 h-36 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
             {posterUrl ? <img src={posterUrl} alt={movie.movieNm} className="w-full h-full object-cover" /> : <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1"><Film size={24} /><span className="text-[10px]">No Poster</span></div>}
           </div>
           <div className="flex-1 flex flex-col justify-center space-y-2 text-xs text-slate-600">
             <div className="flex gap-2"><Film size={14} className="text-slate-400 shrink-0"/> <span className="text-slate-800 line-clamp-1">{movieDetail?.directors?.map((d: any)=>d.peopleNm).join(', ') || '-'}</span></div>
             <div className="flex gap-2"><User size={14} className="text-slate-400 shrink-0"/> <span className="text-slate-800 line-clamp-2">{movieDetail?.actors?.slice(0,3).map((a: any)=>a.peopleNm).join(', ') || '-'}</span></div>
             <div className="flex gap-2"><CalendarIcon size={14} className="text-slate-400 shrink-0"/> 
               <span className="text-slate-800">{movieDetail?.openDt || '-'} <span className="text-orange-500 font-bold ml-1">{getDDay(movie.openDt)}</span></span>
             </div>
             <div className="flex gap-2 font-bold text-blue-600 pt-2 mt-auto border-t border-slate-50"><Users size={14}/> 누적: {formatNumber(movie.audiAcc)}명</div>
           </div>
        </div>

        {/* 2. 통계 카드 */}
        {type === 'DAILY' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1"><div className="flex items-center gap-1.5 text-slate-500"><TrendingUp size={14}/><span className="text-xs">일일 관객</span></div><IntenBadge val={movie.audiInten} /></div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.audiCnt)}명</div>
            </div>
            {/* ... 나머지 카드 생략 (기존 유지) ... */}
          </div>
        ) : (
            realtimeInfo && (
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-xl shadow-lg text-white">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1"><Sparkles size={10}/> KOBIS 실시간 예매</span>
                        <span className="text-[10px] bg-black/20 px-1.5 py-0.5 rounded flex items-center gap-1"><Clock size={10}/> {realtimeInfo.crawledTime || '실시간'} 기준</span>
                    </div>
                    <div className="flex items-end gap-2 mb-4">
                        <span className="text-4xl font-black">{realtimeInfo.rate}</span>
                        <span className="text-sm font-medium opacity-80 mb-1">예매율 {realtimeInfo.rank}위</span>
                    </div>
                    {/* ... 실시간 상세 정보 ... */}
                </div>
            )
        )}

        {/* 3. 그래프 & AI 버튼 */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            {type === 'DAILY' && (
                <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
                    {[{id:'audi',l:'관객수'},{id:'sales',l:'매출액'},{id:'scrn',l:'스크린'},{id:'show',l:'상영수'}].map(m=>(
                        <button key={m.id} onClick={()=>setChartMetric(m.id as any)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${chartMetric===m.id?'bg-blue-100 text-blue-600':'bg-slate-50 text-slate-500'}`}>{m.l}</button>
                    ))}
                </div>
            )}
            
            <TrendChart 
                data={type === 'DAILY' ? trendData : realtimeHistory} 
                type={type} 
                metric={chartMetric}
                loading={loading}
                prediction={predictionSeries.length > 0 ? { predictionSeries, analysisText: '', predictedFinalAudi: {min:0,max:0,avg:0} } : null} 
            />

            {/* [NEW] AI 분석 실행 버튼 */}
            {!analysis && (
                <button 
                    onClick={handleAiAnalysis} 
                    disabled={isAiLoading}
                    className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50"
                >
                    {isAiLoading ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>AI가 데이터를 분석 중입니다...</span>
                        </>
                    ) : (
                        <>
                            <Bot size={18} />
                            <span>AI 예측 분석 실행</span>
                        </>
                    )}
                </button>
            )}
        </div>

        {/* 4. AI 분석 리포트 (결과가 있을 때만 표시) */}
        {analysis && (
            <div className="bg-white p-5 rounded-xl border border-purple-100 shadow-sm ring-1 ring-purple-50">
                <div className="flex items-center gap-2 mb-3 text-purple-700 font-bold text-sm border-b border-purple-50 pb-2">
                  <Sparkles size={16}/> Gemini AI 분석 리포트
                </div>
                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line text-justify break-keep animate-fade-in">
                    {analysis}
                </div>
            </div>
        )}

        {/* ... 뉴스 섹션 (기존 유지) ... */}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 pb-8">
        <button onClick={handleShare} className={`w-full ${copied ? 'bg-green-500 text-white' : 'bg-[#FEE500] text-[#3c1e1e] hover:bg-[#FDD835]'} font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all duration-200 active:scale-[0.98]`}>
          {copied ? <Check size={18} /> : <Share2 size={18} />}
          <span>{copied ? '리포트 복사 완료!' : '리포트 공유하기'}</span>
        </button>
      </div>
    </div>
  );
};

export default DetailView;
