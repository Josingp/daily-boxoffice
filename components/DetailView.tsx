import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieDetail, fetchMovieNews, fetchMoviePoster, fetchRealtimeReservation, NewsItem } from '../services/kobisService';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, ExternalLink, Newspaper, Monitor, PlayCircle, Users, Check } from 'lucide-react';

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
  const [realtimeInfo, setRealtimeInfo] = useState<any>(null); // 실시간 정보 (카드용)
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [posterUrl, setPosterUrl] = useState<string>('');
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
    setAnalysis('');
    setPredictionSeries([]);
    setTrendData([]);
    setRealtimeHistory([]);
    setRealtimeInfo(null);
    setNewsList([]);
    setPosterUrl('');
    setMovieDetail(null);
    setChartMetric('audi');

    try {
      // 1. 기본 정보 로드
      const info = await fetchMovieDetail(movie.movieCd);
      setMovieDetail(info);
      fetchMoviePoster(movie.movieNm).then(setPosterUrl);
      fetchMovieNews(movie.movieNm).then(items => {
         if (!items || items.length === 0) fetchMovieNews(movie.movieNm + " 영화").then(setNewsList);
         else setNewsList(items);
      });

      // 2. 실시간 정보 확보 (Daily탭이어도 실시간 정보 있으면 가져옴)
      let rtData = movie.realtime; 
      
      // JSON에 없으면 API로 긁어오기 시도
      if (!rtData) {
          const live = await fetchRealtimeReservation(movie.movieNm, movie.movieCd);
          if (live.data) {
              rtData = {
                  rank: live.data.rank,
                  rate: live.data.rate,
                  audiCnt: live.data.audiCnt,
                  salesAmt: live.data.salesAmt,
                  audiAcc: live.data.audiAcc,
                  salesAcc: live.data.salesAcc
              };
          }
      }
      setRealtimeInfo(rtData);

      // 3. 그래프 데이터 및 분석 요청
      if (type === 'DAILY') {
        if (movie.trend && movie.trend.length > 0) {
            setTrendData(movie.trend);
            requestAnalysis(movie.movieNm, movie.trend, info, movie.audiAcc, 'DAILY', rtData);
        }
      } else {
        // 실시간 탭
        try {
          const res = await fetch(`/realtime_data.json?t=${Date.now()}`);
          if (res.ok) {
            const json = await res.json();
            const history = json[movie.movieNm] || [];
            // 히스토리가 없으면 현재 데이터로 점 찍기
            if (history.length === 0 && rtData) {
                history.push({ 
                    time: new Date().toISOString().slice(0,16).replace('T',' '), 
                    rate: parseFloat(rtData.rate.replace('%','')), 
                    rank: parseInt(rtData.rank) 
                });
            }
            setRealtimeHistory(history);
            requestAnalysis(movie.movieNm, [], info, movie.audiAcc, 'REALTIME', history);
          }
        } catch { }
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

  const handleShare = async () => {
    if (!movie) return;
    const text = `[BoxOffice Pro] ${movie.movieNm}\n관객수: ${formatNumber(movie.audiCnt)}명\n${analysis.slice(0,50)}...`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {}
  };

  const openNewsLink = (url: string) => window.open(url, '_blank');

  // 증감 배지 컴포넌트
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
               <span className="text-slate-800">{movieDetail?.openDt || '-'}</span>
             </div>
             <div className="flex gap-2 font-bold text-blue-600 pt-2 mt-auto border-t border-slate-50"><Users size={14}/> 누적: {formatNumber(movie.audiAcc)}명</div>
           </div>
        </div>

        {/* 2. 일일 통계 (DAILY 모드일 때만 표시) */}
        {type === 'DAILY' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5 text-slate-500"><TrendingUp size={14}/><span className="text-xs">일일 관객</span></div>
                    <IntenBadge val={movie.audiInten} />
                </div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.audiCnt)}명</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5 text-slate-500"><DollarSign size={14}/><span className="text-xs">매출액</span></div>
                    <IntenBadge val={movie.salesInten} />
                </div>
                <div className="text-lg font-bold text-slate-800">{formatKoreanNumber(movie.salesAmt)}원</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5 text-slate-500"><Monitor size={14}/><span className="text-xs">스크린</span></div>
                    <IntenBadge val={movie.scrnInten} />
                </div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.scrnCnt)}개</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5 text-slate-500"><PlayCircle size={14}/><span className="text-xs">상영</span></div>
                    <IntenBadge val={movie.showInten} />
                </div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.showCnt)}회</div>
            </div>
          </div>
        )}

        {/* 3. 보라색 실시간 예매 카드 (데이터가 있으면 무조건 표시) */}
        {realtimeInfo && (
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-xl shadow-lg text-white">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1"><Sparkles size={10}/> KOBIS 실시간 예매</span>
                    <span className="text-xs opacity-80">{realtimeInfo.rank}위</span>
                </div>
                <div className="flex items-end gap-2 mb-4">
                    <span className="text-4xl font-black">{realtimeInfo.rate}</span>
                    <span className="text-sm font-medium opacity-80 mb-1">예매율</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs border-t border-white/20 pt-3">
                    <div>
                        <div className="opacity-70 mb-0.5">예매 관객</div>
                        <div className="font-bold text-base">{realtimeInfo.audiCnt}명</div>
                    </div>
                    <div>
                        <div className="opacity-70 mb-0.5">예매 매출</div>
                        <div className="font-bold text-base">{formatKoreanNumber(realtimeInfo.salesAmt)}원</div>
                    </div>
                </div>
            </div>
        )}

        {/* 4. 그래프 (DAILY는 선택형, REALTIME은 추이형) */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            {type === 'DAILY' && (
                <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
                    {[
                        { id: 'audi', label: '관객수' },
                        { id: 'sales', label: '매출액' },
                        { id: 'scrn', label: '스크린' },
                        { id: 'show', label: '상영수' }
                    ].map((m) => (
                        <button key={m.id} onClick={() => setChartMetric(m.id as any)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${chartMetric === m.id ? 'bg-blue-100 text-blue-600' : 'bg-slate-50 text-slate-500'}`}>
                            {m.label}
                        </button>
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
        </div>

        {/* 5. AI 분석 */}
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm border-b border-slate-50 pb-2">
              <Sparkles size={16} className="text-purple-600"/> AI 분석 리포트
            </div>
            {analysis ? (
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line text-justify break-keep">{analysis}</p>
            ) : (
              <div className="space-y-2 animate-pulse"><div className="h-4 bg-slate-100 rounded w-3/4"></div><div className="h-4 bg-slate-100 rounded w-full"></div></div>
            )}
        </div>

        {/* 6. 뉴스 */}
        {newsList.length > 0 && (
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
        )}
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
