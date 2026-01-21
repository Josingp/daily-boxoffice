import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieDetail, fetchMovieNews, fetchMoviePoster, fetchRealtimeReservation, NewsItem } from '../services/kobisService';
import manualDataJson from '../manual_data.json';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, ExternalLink, Newspaper, Monitor, PlayCircle, Users, Check, Clock, Coins, BrainCircuit } from 'lucide-react';

const MANUAL_JSON = manualDataJson as Record<string, { posterUrl?: string, productionCost?: number }>;

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
  
  const [analysis, setAnalysis] = useState<string>('');
  const [predictionSeries, setPredictionSeries] = useState<number[]>([]);
  const [finalAudiPredict, setFinalAudiPredict] = useState<{min:number, max:number, avg:number} | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const getManualInfo = (title: string) => {
      if (!title) return null;
      const cleanTitle = title.replace(/\s+/g, '');
      const key = Object.keys(MANUAL_JSON).find(k => k.replace(/\s+/g, '') === cleanTitle);
      return key ? MANUAL_JSON[key] : null;
  };

  useEffect(() => {
    if (movie) {
      setIsVisible(true);
      loadData(movie);
    } else {
      setIsVisible(false);
    }
  }, [movie]);

  // 날짜 포맷팅 (20260211 -> 2026/02/11)
  const parseDate = (str: string) => {
      if (!str) return null;
      let dateStr = String(str).replace(/-/g, '/'); // 2026-02-11 -> 2026/02/11
      
      // 20260211 처럼 하이픈 없는 8자리 문자열 처리
      if (!dateStr.includes('/') && dateStr.length === 8) {
          const y = dateStr.substring(0,4);
          const m = dateStr.substring(4,6);
          const d = dateStr.substring(6,8);
          dateStr = `${y}/${m}/${d}`;
      }
      return new Date(dateStr);
  };

  const getDDayBadge = (openDt: string) => {
      const start = parseDate(openDt);
      if (!start || isNaN(start.getTime())) return null;

      const now = new Date();
      start.setHours(0,0,0,0);
      now.setHours(0,0,0,0);
      
      const diffTime = start.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays > 0) {
          return <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-red-100 text-red-600 text-[10px] font-bold border border-red-200">D-{diffDays}</span>;
      } else if (diffDays === 0) {
          return <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold animate-pulse">D-Day</span>;
      } else {
          return <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-medium border border-slate-200">개봉 {Math.abs(diffDays) + 1}일차</span>;
      }
  };

  const loadData = async (movie: DailyBoxOfficeList) => {
    setLoading(true);
    setAnalysis('');
    setPredictionSeries([]);
    setFinalAudiPredict(null);
    setIsAnalyzing(false); 
    
    setTrendData(movie.trend || []);
    setRealtimeHistory([]);
    setRealtimeInfo(movie.realtime || null);
    setNewsList([]);
    setPosterUrl('');
    setMovieDetail(null);
    setChartMetric('audi');

    try {
      let infoData = (movie as any).detail;
      if (!infoData && movie.movieCd && movie.movieCd !== "0") {
          infoData = await fetchMovieDetail(movie.movieCd);
      }
      setMovieDetail(infoData);

      const manual = getManualInfo(movie.movieNm);
      if (manual?.posterUrl) {
          setPosterUrl(manual.posterUrl);
          fetchMovieNews(movie.movieNm).then(setNewsList);
      } else {
          const [poster, news] = await Promise.all([
              fetchMoviePoster(movie.movieNm),
              fetchMovieNews(movie.movieNm)
          ]);
          setPosterUrl(poster);
          setNewsList(news.length > 0 ? news : []);
      }

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
                    val_audi: parseInt(String(currentRt.audiCnt).replace(/,/g,'')),
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

  const handleRunAnalysis = async () => {
      if (!movie) return;
      setIsAnalyzing(true);

      const manual = getManualInfo(movie.movieNm);
      const cost = manual?.productionCost || 0;
      
      const currentRt = realtimeInfo;
      const sales = currentRt ? parseInt(String(currentRt.salesAcc).replace(/,/g,'')) : parseInt(movie.salesAcc || "0");
      const audi = currentRt ? parseInt(String(currentRt.audiAcc).replace(/,/g,'')) : parseInt(movie.audiAcc || "0");
      const atp = audi > 0 ? (sales / audi) : 12000;

      const history = type === 'REALTIME' ? realtimeHistory : null;
      const trend = type === 'DAILY' ? trendData : [];

      try {
        const res = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                movieName: movie.movieNm, trendData: trend, movieInfo: movieDetail, 
                currentAudiAcc: movie.audiAcc, type, historyData: history,
                productionCost: cost, salesAcc: sales, audiAcc: audi, avgTicketPrice: atp
            })
        });
        const data = await res.json();
        if(data.analysisText) setAnalysis(data.analysisText);
        if(data.predictionSeries) setPredictionSeries(data.predictionSeries);
        if(data.predictedFinalAudi) setFinalAudiPredict(data.predictedFinalAudi);
      } catch(e) {
          setAnalysis("분석 중 오류가 발생했습니다.");
      } finally {
          setIsAnalyzing(false);
      }
  };

  const handleShare = async () => {
    if (!movie) return;
    const fmtInten = (v: any) => {
        const val = parseInt(v || 0);
        if (val === 0) return "-";
        return `${val > 0 ? "▲" : "▼"}${Math.abs(val).toLocaleString()}`;
    };

    let text = `[BoxOffice Pro] ${movie.movieNm}\n`;
    text += `누적관객: ${formatNumber(movie.audiAcc)}명\n\n`;

    if (type === 'DAILY') {
        text += `📅 ${targetDate.substring(4,6)}/${targetDate.substring(6,8)} 일별 리포트\n`;
        text += `• 일일관객: ${formatNumber(movie.audiCnt)}명 (${fmtInten(movie.audiInten)})\n`;
        text += `• PSA(효율): 회당 약 ${calculatePSA()}명\n`;
        text += `• 매출액: ${formatKoreanNumber(movie.salesAmt)}원\n`;
        text += `• 스크린: ${formatNumber(movie.scrnCnt)}개 / 상영 ${formatNumber(movie.showCnt)}회\n`;
    } 

    if (realtimeInfo) {
        text += `\n💜 KOBIS 실시간 예매 (${realtimeInfo.crawledTime || '현재'} 기준)\n`;
        text += `• 예매율: ${realtimeInfo.rate} (전체 ${realtimeInfo.rank}위)\n`;
        text += `• 예매관객: ${formatNumber(String(realtimeInfo.audiCnt).replace(/,/g,''))}명\n`;
    }

    const manual = getManualInfo(movie.movieNm);
    if (manual?.productionCost) {
        const sales = realtimeInfo ? parseInt(String(realtimeInfo.salesAcc).replace(/,/g,'')) : parseInt(movie.salesAcc || "0");
        const audi = realtimeInfo ? parseInt(String(realtimeInfo.audiAcc).replace(/,/g,'')) : parseInt(movie.audiAcc || "0");
        const atp = audi > 0 ? sales / audi : 12000;
        const bepAudi = Math.round(manual.productionCost / (atp * 0.4));
        const rate = Math.min((audi / bepAudi) * 100, 100).toFixed(1);
        
        text += `\n💰 손익분기점(BEP) 분석\n`;
        text += `• 목표 관객: 약 ${formatNumber(bepAudi)}명\n`;
        text += `• 현재 달성률: ${rate}%\n`;
    }

    try { 
        await navigator.clipboard.writeText(text); 
        setCopied(true); 
        setTimeout(()=>setCopied(false),2000); 
    } catch {}
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

  const calculatePSA = () => {
      if (!movie) return 0;
      const audi = parseInt(movie.audiCnt || "0");
      const show = parseInt(movie.showCnt || "0");
      return show > 0 ? Math.round(audi / show) : 0;
  };

  const renderBEPSection = () => {
      const manual = getManualInfo(movie?.movieNm || "");
      if (!manual?.productionCost) return null;
      
      const cost = manual.productionCost;
      const sales = realtimeInfo ? parseInt(String(realtimeInfo.salesAcc).replace(/,/g, '')) : parseInt(movie?.salesAcc || "0");
      const audi = realtimeInfo ? parseInt(String(realtimeInfo.audiAcc).replace(/,/g, '')) : parseInt(movie?.audiAcc || "0");
      const atp = audi > 0 ? (sales / audi) : 12000;
      const profitPerTicket = atp * 0.4;
      const bepAudience = Math.round(cost / profitPerTicket);
      const remainAudience = bepAudience - audi;
      const percent = Math.min((audi / bepAudience) * 100, 100);
      const isBreakeven = audi >= bepAudience;

      return (
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm mb-4">
             <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm border-b border-slate-50 pb-2">
                <Coins size={16} className="text-yellow-500"/> 손익분기점(BEP) 분석
             </div>
             <div className="space-y-4">
                 <div>
                    <div className="flex justify-between text-xs mb-1.5 font-medium">
                        <span className="text-slate-500">BEP 달성률</span>
                        <span className={`${isBreakeven ? 'text-red-500' : 'text-blue-500'} font-bold`}>
                            {percent.toFixed(1)}% ({isBreakeven ? '달성 완료' : '진행 중'})
                        </span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-1000 ${isBreakeven ? 'bg-gradient-to-r from-red-400 to-red-500' : 'bg-blue-500'}`} style={{width: `${percent}%`}}></div>
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-3 rounded-lg">
                    <div>
                        <span className="block text-slate-400 mb-0.5">총 제작비</span>
                        <span className="font-bold text-slate-700">{formatKoreanNumber(cost)}원</span>
                    </div>
                    <div>
                        <span className="block text-slate-400 mb-0.5">목표 관객수</span>
                        <span className="font-bold text-slate-700">{formatNumber(bepAudience)}명</span>
                    </div>
                 </div>
                 {!isBreakeven && (
                     <div className="text-xs text-center text-slate-500 bg-slate-50 py-2 rounded-lg">
                         BEP 달성까지 <span className="font-bold text-slate-800">{formatNumber(remainAudience)}명</span> 남았습니다.
                     </div>
                 )}
                 {finalAudiPredict && finalAudiPredict.avg > 0 && (
                     <div className="mt-3 pt-3 border-t border-slate-100">
                         <div className="text-xs font-bold text-purple-600 mb-1 flex items-center gap-1"><Sparkles size={12}/> AI 예측 최종 관객수</div>
                         <div className="text-sm font-black text-slate-800">
                             약 {formatNumber(finalAudiPredict.avg)}명 
                             <span className="text-[10px] font-normal text-slate-400 ml-1">
                                 ({formatNumber(finalAudiPredict.min)} ~ {formatNumber(finalAudiPredict.max)})
                             </span>
                         </div>
                     </div>
                 )}
             </div>
        </div>
      );
  };

  if (!movie) return null;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
      
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
        
        {/* 1. 포스터 & 정보 */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex gap-4">
           <div className="w-24 h-36 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
             {posterUrl ? <img src={posterUrl} alt={movie.movieNm} className="w-full h-full object-cover" /> : <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1"><Film size={24} /><span className="text-[10px]">No Poster</span></div>}
           </div>
           <div className="flex-1 flex flex-col justify-center space-y-2 text-xs text-slate-600">
             <div className="flex gap-2"><Film size={14} className="text-slate-400 shrink-0"/> <span className="text-slate-800 line-clamp-1">{movieDetail?.directors?.map((d: any)=>d.peopleNm).join(', ') || '-'}</span></div>
             <div className="flex gap-2"><User size={14} className="text-slate-400 shrink-0"/> <span className="text-slate-800 line-clamp-2">{movieDetail?.actors?.slice(0,3).map((a: any)=>a.peopleNm).join(', ') || '-'}</span></div>
             <div className="flex gap-2 items-center"><CalendarIcon size={14} className="text-slate-400 shrink-0"/> 
               <span className="text-slate-800 flex items-center">{movieDetail?.openDt || '-'} 
                 {/* [수정] openDt 우선순위: movie.openDt (일별) -> movieDetail.openDt (실시간) */}
                 {getDDayBadge(movie.openDt || movieDetail?.openDt || "")}
               </span>
             </div>
             <div className="flex gap-2 font-bold text-blue-600 pt-2 mt-auto border-t border-slate-50"><Users size={14}/> 누적: {formatNumber(movie.audiAcc)}명</div>
           </div>
        </div>

        {/* ... 이하 동일 ... */}
        {/* ... (생략된 부분은 위에서 제공한 코드와 완벽히 동일합니다) ... */}
        {type === 'DAILY' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1"><div className="flex items-center gap-1.5 text-slate-500"><TrendingUp size={14}/><span className="text-xs">일일 관객</span></div><IntenBadge val={movie.audiInten} /></div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.audiCnt)}명</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1"><div className="flex items-center gap-1.5 text-slate-500"><DollarSign size={14}/><span className="text-xs">매출액</span></div><IntenBadge val={movie.salesInten} /></div>
                <div className="text-lg font-bold text-slate-800">{formatKoreanNumber(movie.salesAmt)}원</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1"><div className="flex items-center gap-1.5 text-slate-500"><Monitor size={14}/><span className="text-xs">스크린수</span></div><IntenBadge val={movie.scrnInten} /></div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.scrnCnt)}개</div>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5 text-slate-500"><PlayCircle size={14}/><span className="text-xs">상영횟수</span></div>
                    <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">PSA {calculatePSA()}명</span>
                </div>
                <div className="text-lg font-bold text-slate-800">{formatNumber(movie.showCnt)}회</div>
            </div>
          </div>
        )}

        {realtimeInfo && (
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-xl shadow-lg text-white">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1"><Sparkles size={10}/> KOBIS 실시간 예매</span>
                    <span className="text-[10px] bg-black/20 px-1.5 py-0.5 rounded flex items-center gap-1"><Clock size={10}/> {realtimeInfo.crawledTime || '실시간'} 기준</span>
                </div>
                <div className="flex items-end gap-2 mb-4">
                    <span className="text-4xl font-black">{realtimeInfo.rate}</span>
                    <span className="text-sm font-medium opacity-80 mb-1">예매율 {realtimeInfo.rank}위</span>
                </div>
                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs border-t border-white/20 pt-3">
                    <div>
                        <div className="opacity-70 mb-0.5">예매 관객수</div>
                        <div className="font-bold text-sm">{formatNumber(String(realtimeInfo.audiCnt).replace(/,/g,''))}명</div>
                    </div>
                    <div>
                        <div className="opacity-70 mb-0.5">누적 관객수</div>
                        <div className="font-bold text-sm">{formatNumber(String(realtimeInfo.audiAcc).replace(/,/g,''))}명</div>
                    </div>
                    <div>
                        <div className="opacity-70 mb-0.5">예매 매출액</div>
                        <div className="font-bold text-sm">{formatKoreanNumber(String(realtimeInfo.salesAmt).replace(/,/g,''))}원</div>
                    </div>
                    <div>
                        <div className="opacity-70 mb-0.5">누적 매출액</div>
                        <div className="font-bold text-sm">{formatKoreanNumber(String(realtimeInfo.salesAcc).replace(/,/g,''))}원</div>
                    </div>
                </div>
            </div>
        )}

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
        </div>

        {renderBEPSection()}

        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-slate-50 pb-2">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                <BrainCircuit size={16} className="text-purple-600"/> AI 심층 분석 리포트
              </div>
            </div>
            
            {!analysis && !isAnalyzing ? (
                <div className="text-center py-6">
                    <p className="text-xs text-slate-400 mb-3">최신 데이터를 기반으로 AI가 흥행 추이를 분석합니다.</p>
                    <button 
                        onClick={handleRunAnalysis}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold px-6 py-2.5 rounded-lg shadow-sm transition-colors flex items-center gap-2 mx-auto"
                    >
                        <Sparkles size={16}/> AI 분석 실행하기
                    </button>
                </div>
            ) : isAnalyzing ? (
                <div className="py-8 flex flex-col items-center justify-center gap-3">
                    <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-xs text-purple-600 font-medium animate-pulse">데이터를 분석하고 있습니다...</span>
                </div>
            ) : (
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line text-justify break-keep animate-fade-in">
                    {analysis}
                </p>
            )}
        </div>

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
