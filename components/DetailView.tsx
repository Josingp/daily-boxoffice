import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieTrend, fetchMovieDetail, fetchMovieNews, NewsItem } from '../services/kobisService';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, ExternalLink, Newspaper, Monitor, PlayCircle, Users } from 'lucide-react';

interface DetailViewProps {
  movie: DailyBoxOfficeList | null;
  targetDate: string;
  type: 'DAILY' | 'REALTIME';
  onClose: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({ movie, targetDate, type, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [realtimeHistory, setRealtimeHistory] = useState<any[]>([]);
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [analysis, setAnalysis] = useState<string>('');
  const [predictionSeries, setPredictionSeries] = useState<number[]>([]);
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
    setPredictionSeries([]);
    setTrendData([]);
    setRealtimeHistory([]);
    setNewsList([]);
    setMovieDetail(null);

    try {
      const info = await fetchMovieDetail(movie.movieCd);
      setMovieDetail(info);

      // 뉴스
      fetchMovieNews(movie.movieNm).then(items => {
         if (!items || items.length === 0) fetchMovieNews(movie.movieNm + " 영화").then(setNewsList);
         else setNewsList(items);
      });

      if (type === 'DAILY') {
        const trend = await fetchMovieTrend(movie.movieCd, targetDate);
        setTrendData(trend);
        requestAnalysis(movie.movieNm, trend, info, movie.audiAcc, 'DAILY', null);
      } else {
        // [REALTIME] History JSON 로드
        try {
          const res = await fetch(`/realtime_data.json?t=${Date.now()}`);
          if (res.ok) {
            const json = await res.json();
            const history = json[movie.movieNm] || [];
            setRealtimeHistory(history);
            requestAnalysis(movie.movieNm, [], info, movie.audiAcc, 'REALTIME', history);
          } else {
             // 데이터 없으면 분석만이라도 요청
             requestAnalysis(movie.movieNm, [], info, movie.audiAcc, 'REALTIME', null);
          }
        } catch { 
             requestAnalysis(movie.movieNm, [], info, movie.audiAcc, 'REALTIME', null);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const requestAnalysis = async (name: string, trend: any, info: any, total: string, type: string, history: any) => {
    try {
        const res = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ movieName: name, trendData: trend, movieInfo: info, currentAudiAcc: total, type, historyData: history })
        });
        const data = await res.json();
        if(data.analysisText) setAnalysis(data.analysisText);
        if(data.predictionSeries) setPredictionSeries(data.predictionSeries);
    } catch(e) {}
  };

  const openNewsLink = (url: string) => window.open(url, '_blank');
  const openSearch = (engine: 'naver' | 'google') => {
      const q = encodeURIComponent(movie?.movieNm + " 영화");
      window.open(engine === 'naver' ? `https://search.naver.com/search.naver?query=${q}` : `https://www.google.com/search?q=${q}`, '_blank');
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
        
        {/* 상세 정보 */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-xs text-slate-600 space-y-1.5">
           <div className="flex gap-2"><Film size={14} className="text-slate-400"/> 감독: <span className="text-slate-800">{movieDetail?.directors?.map((d: any)=>d.peopleNm).join(', ') || '-'}</span></div>
           <div className="flex gap-2"><User size={14} className="text-slate-400"/> 출연: <span className="text-slate-800">{movieDetail?.actors?.slice(0,3).map((a: any)=>a.peopleNm).join(', ') || '-'}</span></div>
           <div className="flex gap-2"><CalendarIcon size={14} className="text-slate-400"/> 개봉: <span className="text-slate-800">{movieDetail?.openDt || '-'}</span></div>
           {/* [추가] 누적 관객수 표시 */}
           <div className="flex gap-2 font-bold text-blue-600 pt-1 border-t border-slate-50 mt-1"><Users size={14}/> 누적 관객: {formatNumber(movie.audiAcc)}명</div>
        </div>

        {/* 통계 박스 (DAILY 모드만) */}
        {type === 'DAILY' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><TrendingUp size={14}/><span className="text-xs">일일 관객</span></div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.audiCnt)}명</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><DollarSign size={14}/><span className="text-xs">매출액</span></div>
                <div className="text-lg font-bold text-slate-800">{formatKoreanNumber(movie.salesAmt)}원</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><Monitor size={14}/><span className="text-xs">스크린 수</span></div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.scrnCnt)}개</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-1.5 text-slate-500 mb-1"><PlayCircle size={14}/><span className="text-xs">상영 횟수</span></div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.showCnt)}회</div>
            </div>
          </div>
        )}

        {/* [그래프 복구] 통합 TrendChart 사용 */}
        <TrendChart 
            data={type === 'DAILY' ? trendData : realtimeHistory} 
            type={type} 
            loading={loading}
            prediction={{ predictionSeries, analysisText: '', predictedFinalAudi: {min:0,max:0,avg:0} }} // 예측 데이터 전달
        />

        {/* AI 리포트 */}
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm border-b border-slate-50 pb-2">
              <Sparkles size={16} className="text-purple-600"/> 
              AI 상세 분석
            </div>
            {analysis ? (
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line text-justify break-keep">{analysis}</p>
            ) : (
              <div className="space-y-2 animate-pulse"><div className="h-4 bg-slate-100 rounded w-3/4"></div><div className="h-4 bg-slate-100 rounded w-full"></div></div>
            )}
        </div>

        {/* 뉴스 (데이터 있으면 리스트, 없으면 버튼) */}
        {newsList.length > 0 ? (
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm"><Newspaper size={16} className="text-blue-500"/> 관련 최신 기사</div>
            <div className="space-y-3">
              {newsList.map((news, idx) => (
                <div key={idx} onClick={() => openNewsLink(news.link)} className="flex flex-col gap-1 cursor-pointer group pb-3 border-b border-slate-50 last:border-0 last:pb-0">
                  <h4 className="text-sm font-bold text-slate-800 line-clamp-1 group-hover:text-blue-600 transition-colors" dangerouslySetInnerHTML={{ __html: news.title }} />
                  <p className="text-xs text-slate-500 line-clamp-2 leading-snug" dangerouslySetInnerHTML={{ __html: news.desc }} />
                  <div className="flex justify-between items-center mt-1"><span className="text-[10px] text-slate-400">{news.press}</span><ExternalLink size={12} className="text-slate-300"/></div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex gap-2 mt-4">
             <button onClick={() => openSearch('naver')} className="flex-1 py-3 bg-[#03C75A] text-white rounded-lg text-xs font-bold shadow-sm">네이버 검색</button>
             <button onClick={() => openSearch('google')} className="flex-1 py-3 bg-blue-500 text-white rounded-lg text-xs font-bold shadow-sm">구글 검색</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DetailView;
