import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo, DramaItem } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieDetail, fetchMovieNews, fetchMoviePoster, fetchRealtimeReservation, NewsItem } from '../services/kobisService';
import manualDataJson from '../manual_data.json';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, ExternalLink, Newspaper, Monitor, PlayCircle, Users, Check, Clock, Coins, BrainCircuit, Tv, Search } from 'lucide-react';

const MANUAL_JSON = manualDataJson as Record<string, { posterUrl?: string, productionCost?: number }>;

interface DetailViewProps {
  movie: DailyBoxOfficeList | null;
  drama?: DramaItem | null; 
  targetDate: string;
  type: 'DAILY' | 'REALTIME' | 'DRAMA';
  onClose: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({ movie, drama, targetDate, type, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [chartMetric, setChartMetric] = useState<'audi' | 'sales' | 'scrn' | 'show'>('audi');
  
  // 영화용 State
  const [trendData, setTrendData] = useState<any[]>([]);
  const [realtimeInfo, setRealtimeInfo] = useState<any>(null);
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [posterUrl, setPosterUrl] = useState<string>('');
  
  // 드라마용 State
  const [dramaTrend, setDramaTrend] = useState<any[]>([]);

  // AI 분석 State
  const [analysis, setAnalysis] = useState<string>('');
  const [predictionSeries, setPredictionSeries] = useState<number[]>([]);
  const [finalAudiPredict, setFinalAudiPredict] = useState<{min:number, max:number, avg:number} | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Helper 함수들
  const getManualInfo = (title: string) => { 
    if(!title) return null; 
    const clean=title.replace(/\s+/g,''); 
    const k=Object.keys(MANUAL_JSON).find(k=>k.replace(/\s+/g,'')===clean); 
    return k?MANUAL_JSON[k]:null; 
  };
  
  const parseDate = (str: string) => { 
    if(!str) return null; 
    let d=String(str).replace(/-/g,'/'); 
    if(!d.includes('/')&&d.length===8) d=`${d.substring(0,4)}/${d.substring(4,6)}/${d.substring(6,8)}`; 
    return new Date(d); 
  };
  
  const getDDayBadge = (openDt: string) => {
      const start = parseDate(openDt);
      if (!start || isNaN(start.getTime())) return null;
      const now = new Date(); start.setHours(0,0,0,0); now.setHours(0,0,0,0);
      const diffDays = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 0) return <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-red-100 text-red-600 text-[10px] font-bold border border-red-200">D-{diffDays}</span>;
      else if (diffDays === 0) return <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold animate-pulse">D-Day</span>;
      else return <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-medium border border-slate-200">개봉 {Math.abs(diffDays) + 1}일차</span>;
  };

  const calculatePSA = () => { 
    if(!movie) return 0; 
    const a=parseInt(movie.audiCnt||"0"); 
    const s=parseInt(movie.showCnt||"0"); 
    return s>0?Math.round(a/s):0; 
  };

  const IntenBadge = ({ val }: { val?: string | number }) => {
      const v = typeof val === 'string' ? parseInt(val) : (val || 0);
      if (v === 0) return <span className="text-slate-400 text-[10px]">-</span>;
      const isUp = v > 0;
      return <span className={`text-[10px] ${isUp ? 'text-red-500' : 'text-blue-500'} font-medium`}>{isUp ? '▲' : '▼'} {Math.abs(v).toLocaleString()}</span>;
  };

  const openNewsLink = (url: string) => window.open(url, '_blank');

  useEffect(() => {
    if (movie || drama) {
      setIsVisible(true);
      if (type === 'DRAMA' && drama) {
          loadDramaData(drama);
      } else if (movie) {
          loadMovieData(movie);
      }
    } else {
      setIsVisible(false);
    }
  }, [movie, drama]);

  const loadDramaData = (item: DramaItem) => {
      setDramaTrend(item.trend || []);
      setPosterUrl(item.posterUrl || ''); 
      setNewsList([]);
      setAnalysis(''); 
      setIsAnalyzing(false);
      setPredictionSeries([]);
      setFinalAudiPredict(null);
  };

  const loadMovieData = async (movie: DailyBoxOfficeList) => {
    setLoading(true); 
    setAnalysis(''); setPredictionSeries([]); setFinalAudiPredict(null); setIsAnalyzing(false);
    setTrendData(movie.trend || []); 
    setRealtimeInfo(movie.realtime || null); 
    setNewsList([]); setPosterUrl(''); setMovieDetail(null); setChartMetric('audi');
    
    try {
      // 1. [핵심] 실시간 모드일 때 그래프 데이터 로드
      if (type === 'REALTIME') {
          try {
             const res = await fetch(`/realtime_data.json?t=${Date.now()}`);
             if (res.ok) {
                 const json = await res.json();
                 // 제목 매칭 (공백 제거)
                 const searchTitle = movie.movieNm.replace(/\s+/g, '');
                 const key = Object.keys(json).find(k => k.replace(/\s+/g, '') === searchTitle);
                 
                 // 키를 찾았고 배열 데이터가 있다면 설정
                 if (key && Array.isArray(json[key])) {
                     setTrendData(json[key]);
                 }
             }
          } catch (e) { 
              console.error("Realtime history load failed", e); 
          }
      }

      // 2. 상세 정보 로드
      let info = (movie as any).detail;
      if (!info && movie.movieCd && movie.movieCd !== "0") info = await fetchMovieDetail(movie.movieCd);
      setMovieDetail(info);
      
      const manual = getManualInfo(movie.movieNm);
      if (manual?.posterUrl) { setPosterUrl(manual.posterUrl); fetchMovieNews(movie.movieNm).then(setNewsList); }
      else { const [p, n] = await Promise.all([fetchMoviePoster(movie.movieNm), fetchMovieNews(movie.movieNm)]); setPosterUrl(p); setNewsList(n); }
      
      // 3. 실시간 정보 (보라색 카드) 로드
      let rt = movie.realtime;
      if(!rt) { 
          const l = await fetchRealtimeReservation(movie.movieNm, movie.movieCd); 
          if(l.data) { rt={...l.data, crawledTime:l.crawledTime}; setRealtimeInfo(rt); }
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleRunAnalysis = async () => {
      if (!movie) return; 
      setIsAnalyzing(true);
      try {
        const manual = getManualInfo(movie.movieNm);
        const cost = manual?.productionCost || 0;
        
        // [수정] 현재 화면에 로드된 realtimeInfo를 우선 사용하여 5대 지표 추출
        const currentRt = realtimeInfo;
        const parseVal = (v: any) => parseInt(String(v||0).replace(/,/g,'')) || 0;
        const parseFloatVal = (v: any) => parseFloat(String(v||0).replace(/,/g,'')) || 0;

        // 5대 지표 추출 (없으면 0)
        const rate = currentRt ? parseFloatVal(currentRt.rate) : 0;           // 예매율
        const rtAudiCnt = currentRt ? parseVal(currentRt.audiCnt) : 0;        // 예매 관객수
        const rtSalesAmt = currentRt ? parseVal(currentRt.salesAmt) : 0;      // 예매 매출액
        const currentAudiAcc = currentRt ? parseVal(currentRt.audiAcc) : parseVal(movie.audiAcc); // 누적 관객수
        const currentSalesAcc = currentRt ? parseVal(currentRt.salesAcc) : parseVal(movie.salesAcc); // 누적 매출액
        
        const atp = currentAudiAcc > 0 ? (currentSalesAcc / currentAudiAcc) : 12000;
        
        // AI 분석에 사용할 히스토리 데이터 선택
        const history = type === 'REALTIME' ? trendData : null; 
        const trend = type === 'DAILY' ? trendData : [];

        const res = await fetch('/api/predict', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                movieName: movie.movieNm, 
                trendData: trend, 
                movieInfo: movieDetail, 
                // [중요] 5대 지표를 명시적으로 모두 전달
                reservationRate: rate,
                reservationAudi: rtAudiCnt,
                reservationSales: rtSalesAmt,
                currentAudiAcc: currentAudiAcc, 
                currentSalesAcc: currentSalesAcc,
                
                type, 
                historyData: history,
                productionCost: cost, 
                audiAcc: currentAudiAcc, // 호환성을 위해 유지
                salesAcc: currentSalesAcc,
                avgTicketPrice: atp
            })
        });
        const data = await res.json();
        if(data.analysisText) setAnalysis(data.analysisText);
        if(data.predictionSeries) setPredictionSeries(data.predictionSeries);
        if(data.predictedFinalAudi) setFinalAudiPredict(data.predictedFinalAudi);
      } catch(e) {
          console.error(e);
          setAnalysis("분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
          setIsAnalyzing(false);
      }
  };

  const handleShare = async () => {
    if (movie) {
        let text = `[BoxOffice Pro] ${movie.movieNm}\n누적관객: ${formatNumber(movie.audiAcc)}명`;
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {}
    }
  };

  const renderBEPSection = () => {
      const manual = getManualInfo(movie?.movieNm || "");
      if (!manual?.productionCost || !movie) return null;
      
      const cost = manual.productionCost;
      const sales = realtimeInfo ? parseInt(String(realtimeInfo.salesAcc).replace(/,/g, '')) : parseInt(movie.salesAcc || "0");
      const audi = realtimeInfo ? parseInt(String(realtimeInfo.audiAcc).replace(/,/g, '')) : parseInt(movie.audiAcc || "0");
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

  if (!movie && !drama) return null;
  const title = type === 'DRAMA' ? drama?.title : movie?.movieNm;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
      
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
        <div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${type === 'DRAMA' ? 'bg-purple-100 text-purple-600' : type === 'DAILY' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600'}`}>
             {type === 'DRAMA' ? 'TV 시청률' : type === 'DAILY' ? '일별 박스오피스' : '실시간 예매율'}
          </span>
          <h2 className="text-xl font-bold text-slate-800 leading-tight mt-1 pr-4 line-clamp-1">{title}</h2>
        </div>
        <button onClick={onClose} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full shrink-0"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 bg-slate-50/30">
        
        {/* === 드라마 모드 === */}
        {type === 'DRAMA' && drama && (
            <>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex gap-4">
                   {/* 포스터 영역 */}
                   <div className="w-24 h-32 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
                     {posterUrl ? (
                        <img src={posterUrl} alt={drama.title} className="w-full h-full object-cover" />
                     ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1">
                            <Tv size={24} />
                            <span className="text-[10px]">No Image</span>
                        </div>
                     )}
                   </div>
                   
                   {/* 정보 영역 */}
                   <div className="flex-1 flex flex-col justify-center space-y-2 text-xs text-slate-600">
                     <div className="flex gap-2 items-start">
                        <Monitor size={14} className="text-purple-500 shrink-0 mt-0.5"/> 
                        <span className="text-slate-800 font-medium leading-snug">{drama.broadcaster || drama.channel}</span>
                     </div>
                     {drama.cast && (
                         <div className="flex gap-2 items-start">
                            <User size={14} className="text-slate-400 shrink-0 mt-0.5"/> 
                            <span className="text-slate-600 line-clamp-2 leading-snug">{drama.cast}</span>
                         </div>
                     )}
                     <div className="mt-auto pt-2 border-t border-slate-50 flex items-center justify-between">
                        <span className="text-slate-400">{drama.area} 기준</span>
                        <span className="text-lg font-black text-purple-600">{drama.rating}%</span>
                     </div>
                   </div>
                </div>

                {drama.summary && (
                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <div className="text-xs font-bold text-slate-800 mb-1">줄거리</div>
                        <p className="text-xs text-slate-500 leading-relaxed">{drama.summary}</p>
                    </div>
                )}

                {/* 네이버 검색 버튼 */}
                <div className="flex justify-end mb-4">
                    <button 
                        onClick={() => window.open(`https://search.naver.com/search.naver?query=드라마 ${drama.title}`, '_blank')}
                        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-purple-600 bg-white px-3 py-1.5 rounded-full border border-slate-100 shadow-sm transition-colors"
                    >
                        <Search size={12} /> 네이버 상세 검색
                    </button>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-50 pb-2">
                         <TrendingUp size={16} className="text-purple-600"/>
                         <span className="text-sm font-bold text-slate-800">최근 30일 시청률 추이</span>
                    </div>
                    {dramaTrend.length > 0 ? (
                        <TrendChart 
                            data={dramaTrend} 
                            type="DRAMA" 
                            metric="rating" 
                        />
                    ) : (
                        <div className="h-32 flex items-center justify-center text-xs text-slate-400">
                            이전 데이터가 부족하여 그래프를 표시할 수 없습니다.
                        </div>
                    )}
                </div>
            </>
        )}

        {/* === 영화 모드 === */}
        {type !== 'DRAMA' && movie && (
            <>
                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex gap-4">
                   <div className="w-24 h-36 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
                     {posterUrl ? <img src={posterUrl} alt={movie.movieNm} className="w-full h-full object-cover" /> : <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1"><Film size={24} /><span className="text-[10px]">No Poster</span></div>}
                   </div>
                   <div className="flex-1 flex flex-col justify-center space-y-2 text-xs text-slate-600">
                     <div className="flex gap-2"><Film size={14} className="text-slate-400 shrink-0"/> <span className="text-slate-800 line-clamp-1">{movieDetail?.directors?.map((d: any)=>d.peopleNm).join(', ') || '-'}</span></div>
                     <div className="flex gap-2"><User size={14} className="text-slate-400 shrink-0"/> <span className="text-slate-800 line-clamp-2">{movieDetail?.actors?.slice(0,3).map((a: any)=>a.peopleNm).join(', ') || '-'}</span></div>
                     <div className="flex gap-2 items-center"><CalendarIcon size={14} className="text-slate-400 shrink-0"/> 
                       <span className="text-slate-800 flex items-center">{movieDetail?.openDt || '-'} 
                         {getDDayBadge(movie.openDt || movieDetail?.openDt || "")}
                       </span>
                     </div>
                     <div className="flex gap-2 font-bold text-blue-600 pt-2 mt-auto border-t border-slate-50"><Users size={14}/> 누적: {formatNumber(movie.audiAcc)}명</div>
                   </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    {type === 'DAILY' && (
                        <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
                            {[{id:'audi',l:'관객수'},{id:'sales',l:'매출액'},{id:'scrn',l:'스크린'},{id:'show',l:'상영수'}].map(m=>(
                                <button key={m.id} onClick={()=>setChartMetric(m.id as any)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${chartMetric===m.id?'bg-blue-100 text-blue-600':'bg-slate-50 text-slate-500'}`}>{m.l}</button>
                            ))}
                        </div>
                    )}
                    <TrendChart 
                        data={trendData} 
                        type={type} 
                        metric={chartMetric}
                        loading={loading}
                        prediction={predictionSeries.length > 0 ? { predictionSeries, analysisText: '', predictedFinalAudi: {min:0,max:0,avg:0} } : null} 
                        openDt={movie.openDt || movieDetail?.openDt}
                    />
                </div>

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
                        </div>
                    </div>
                )}

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
            </>
        )}
      </div>
    </div>
  );
};

export default DetailView;
