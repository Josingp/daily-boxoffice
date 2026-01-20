import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieDetail, fetchMovieNews, fetchMoviePoster, fetchRealtimeReservation, fetchMovieTrend, NewsItem } from '../services/kobisService';
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
  
  // AI 상태
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string>('');
  const [predictionSeries, setPredictionSeries] = useState<number[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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
    setAnalysis(''); // 초기화
    setPredictionSeries([]);
    setTrendData(movie.trend || []);
    setRealtimeHistory([]);
    setRealtimeInfo(movie.realtime || null);
    setNewsList([]);
    setPosterUrl('');
    setMovieDetail(null);

    try {
      const [info, poster, news] = await Promise.all([
          fetchMovieDetail(movie.movieCd),
          fetchMoviePoster(movie.movieNm),
          fetchMovieNews(movie.movieNm)
      ]);
      setMovieDetail(info);
      setPosterUrl(poster);
      setNewsList(news);

      // 1. 실시간 정보 확보 (API Fallback)
      let currentRt = movie.realtime;
      if (!currentRt) {
          const live = await fetchRealtimeReservation(movie.movieNm, movie.movieCd);
          if (live.data) {
              currentRt = { ...live.data, crawledTime: live.crawledTime };
              setRealtimeInfo(currentRt);
          }
      }

      // 2. 일별 데이터 확보 (JSON에 없으면 API 호출)
      if (type === 'DAILY' && (!movie.trend || movie.trend.length === 0)) {
          const apiTrend = await fetchMovieTrend(movie.movieCd, targetDate);
          setTrendData(apiTrend);
      }

      // 3. 실시간 히스토리 로드
      if (type === 'REALTIME') {
          try {
              const res = await fetch(`/realtime_data.json?t=${Date.now()}`);
              if (res.ok) {
                  const json = await res.json();
                  const history = json[movie.movieNm] || [];
                  setRealtimeHistory(history);
              }
          } catch {}
      }

    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // [핵심] 버튼 클릭 시 AI 분석 시작
  const startAnalysis = async () => {
    if (!movie) return;
    setAnalyzing(true);
    try {
        const res = await fetch('/predict', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                movieName: movie.movieNm, 
                trendData: trendData, // 확보된 전체 데이터 전달
                movieInfo: movieDetail, 
                currentAudiAcc: movie.audiAcc, 
                type, 
                historyData: realtimeHistory // 실시간 히스토리 전달
            })
        });
        const data = await res.json();
        if(data.analysisText) setAnalysis(data.analysisText);
        if(data.predictionSeries) setPredictionSeries(data.predictionSeries);
    } catch (e) {
        setAnalysis("분석 중 오류가 발생했습니다.");
    } finally {
        setAnalyzing(false);
    }
  };

  const handleShare = async () => { if(!movie) return; const t=`${movie.movieNm}\n${analysis.slice(0,50)}...`; try{await navigator.clipboard.writeText(t); setCopied(true); setTimeout(()=>setCopied(false),2000);}catch{} };
  const openNewsLink = (url:string)=>window.open(url,'_blank');
  const IntenBadge = ({val}:{val?:number}) => { const v=val||0; if(v===0) return <span className="text-slate-400 text-[10px]">-</span>; return <span className={`text-[10px] ${v>0?'text-red-500':'text-blue-500'} font-medium`}>{v>0?'▲':'▼'} {Math.abs(v).toLocaleString()}</span>; };

  if (!movie) return null;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
        <div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${type==='DAILY'?'bg-blue-100 text-blue-600':'bg-indigo-100 text-indigo-600'}`}>{type==='DAILY'?'일별 박스오피스':'실시간 예매율'}</span>
          <h2 className="text-xl font-bold text-slate-800 leading-tight mt-1 pr-4 line-clamp-1">{movie.movieNm}</h2>
        </div>
        <button onClick={onClose} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full shrink-0"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 bg-slate-50/30">
        
        {/* 영화 정보 */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex gap-4">
           <div className="w-24 h-36 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
             {posterUrl ? <img src={posterUrl} alt={movie.movieNm} className="w-full h-full object-cover" /> : <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1"><Film size={24} /><span className="text-[10px]">No Poster</span></div>}
           </div>
           <div className="flex-1 flex flex-col justify-center space-y-2 text-xs text-slate-600">
             <div className="flex gap-2"><Film size={14} className="text-slate-400 shrink-0"/> <span className="text-slate-
