import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo, ReservationData } from '../types';
import { ExtendedPredictionResult } from '../services/geminiService';
import { formatNumber } from '../constants';
import { fetchMovieTrend, fetchMovieDetail, fetchRealtimeReservation, fetchMovieNews, NewsItem } from '../services/kobisService';
import { predictMoviePerformance } from '../services/geminiService';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, Ticket, RefreshCw, AlertTriangle, ExternalLink, Newspaper, ChevronRight } from 'lucide-react';

interface DetailViewProps {
  movie: DailyBoxOfficeList | null;
  targetDate: string;
  onClose: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({ movie, targetDate, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [prediction, setPrediction] = useState<ExtendedPredictionResult | null>(null);
  const [reservation, setReservation] = useState<ReservationData | null>(null);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [resError, setResError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (movie) {
      setIsVisible(true);
      setPrediction(null);
      setReservation(null);
      setNewsList([]); 
      setResError(null);
      loadData(movie);
    } else {
      setIsVisible(false);
    }
  }, [movie]);

  const loadData = async (movie: DailyBoxOfficeList) => {
    setLoading(true);
    setAiLoading(true);
    setResError(null);

    try {
      const [trend, info] = await Promise.all([
        fetchMovieTrend(movie.movieCd, targetDate),
        fetchMovieDetail(movie.movieCd)
      ]);
      setMovieDetail(info);

      // [뉴스 로드 시도]
      try {
        const items = await fetchMovieNews(movie.movieNm);
        if (items && items.length > 0) {
            setNewsList(items);
        } else {
            // 실패 시 '영화' 키워드 붙여서 재시도
            const retryItems = await fetchMovieNews(movie.movieNm + " 영화");
            setNewsList(retryItems || []);
        }
      } catch (e) {
        console.error("News Load Error:", e);
        setNewsList([]); // 실패 시 빈 배열
      }

      let updatedTrend = [...trend];
      let comparisonInfo = null;

      try {
        const resResult = await fetchRealtimeReservation(movie.movieNm, movie.movieCd);
        if (resResult && resResult.data) {
          setReservation(resResult.data);
          const todayAudi = parseInt(resResult.data.audiCnt.replace(/,/g, ''), 10) || 0;
          const todayDate = new Date().toISOString().slice(0,10).replace(/-/g,"");
          
          updatedTrend.push({
            date: todayDate, dateDisplay: '오늘', audiCnt: todayAudi, scrnCnt: 0
          });

          if (trend.length > 0) {
            const yesterdayAudi = trend[trend.length - 1].audiCnt;
            const diff = todayAudi - yesterdayAudi;
            const rate = yesterdayAudi > 0 ? ((diff / yesterdayAudi) * 100).toFixed(1) : "0";
            comparisonInfo = { today: todayAudi, yesterday: yesterdayAudi, diff, rate };
          }
        } else {
          setReservation(null);
          setResError(resResult?.error || "데이터 없음");
        }
      } catch (err) { setReservation(null); }
      
      setTrendData(updatedTrend);
      setLoading(false);

      if (info) {
        try {
          const pred = await predictMoviePerformance(movie.movieNm, updatedTrend, info, movie.audiAcc, comparisonInfo);
          setPrediction(pred);
        } catch (err) { console.error("AI Error:", err); }
      }
      setAiLoading(false);

    } catch (e: any) {
      setLoading(false);
      setAiLoading(false);
    }
  };

  const handleShare = async () => {
    if (!movie) return;
    const text = `🎬 ${movie.movieNm} AI 분석`;
    if (navigator.share) { try { await navigator.share({ title: movie.movieNm, text }); } catch {} } 
    else { alert('복사되었습니다.'); }
  };

  const openNewsSearch = (engine: 'naver' | 'google') => {
    if (!movie) return;
    const keyword = prediction?.searchKeywords?.[0] || movie.movieNm;
    const query = encodeURIComponent(keyword + " 영화 반응");
    let url = engine === 'naver' 
      ? `https://search.naver.com/search.naver?where=news&query=${query}`
      : `https://www.google.com/search?q=${query}&tbm=nws`;
    window.open(url, '_blank');
  };

  const safeNum = (val: any): number => {
    if (!val) return 0;
    const str = String(val).replace(/,/g, '');
    const parsed = parseInt(str, 10);
    return isNaN(parsed) ? 0 : parsed;
  };

  if (!movie) return null;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full w-fit mb-1">
             BoxOffice Rank #{movie.rank}
          </span>
          <h2 className="text-xl font-bold text-slate-800 leading-tight pr-4">{movie.movieNm}</h2>
        </div>
        <button onClick={onClose} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors">
          <X size={20} className="text-slate-600" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 bg-slate-50/30">
        
        {/* 실시간 예매 정보 */}
        {reservation ? (
          <div className="bg-gradient-to-br from-violet-600 to-indigo-700 p-5 rounded-2xl text-white shadow-xl shadow-indigo-200 relative overflow-hidden">
             <div className="absolute top-0 right-0 -mt-2 -mr-2 w-24 h-24 bg-white opacity-10 rounded-full blur-xl"></div>
             <div className="flex justify-between items-start mb-4 relative z-10">
              <div className="flex items-center gap-2">
                <Ticket size={18} className="text-indigo-200" />
                <span className="font-bold text-sm tracking-wide">KOBIS 실시간 예매</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] bg-black/20 backdrop-blur-sm px-2 py-1 rounded-full text-indigo-100">
                <RefreshCw size={10} />
                <span>{reservation.crawledTime ? `${reservation.crawledTime} 기준` : '실시간'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-2 relative z-10">
              <div className="col-span-2 flex items-baseline gap-2 pb-2 border-b border-white/10">
                 <span className="text-4xl font-black tracking-tight">{reservation.rate || '-'}</span>
                 <span className="text-lg font-medium text-indigo-200">예매 {reservation.rank || '-'}위</span>
              </div>
              <div><p className="text-[10px] text-indigo-200 mb-0.5">예매 관객수</p><p className="font-bold text-lg">{formatNumber(safeNum(reservation.audiCnt))}명</p></div>
              <div><p className="text-[10px] text-indigo-200 mb-0.5">누적 관객수</p><p className="font-bold text-lg">{formatNumber(safeNum(reservation.audiAcc))}명</p></div>
              <div><p className="text-[10px] text-indigo-200 mb-0.5">예매 매출액</p><p className="font-medium text-sm text-indigo-100">{formatNumber(safeNum(reservation.salesAmt))}원</p></div>
              <div><p className="text-[10px] text-indigo-200 mb-0.5">누적 매출액</p><p className="font-medium text-sm text-indigo-100">{formatNumber(safeNum(reservation.salesAcc))}원</p></div>
            </div>
          </div>
        ) : (
           loading ? <div className="h-48 bg-slate-100 rounded-2xl animate-pulse"></div> : 
           <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center py-6">
              <p className="text-xs font-bold text-red-600 mb-1">실시간 정보 없음</p>
              <p className="text-[10px] text-red-500">{resError || "서버 응답 없음"}</p>
           </div>
        )}

        {/* 영화 기본 정보 */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
           {movieDetail ? (
             <div className="grid grid-cols-1 gap-2 text-sm text-slate-700">
               <div className="flex gap-2 items-center"><Film size={14} className="text-slate-400"/> 감독: {movieDetail.directors?.map(d => d.peopleNm).join(', ') || '-'}</div>
               <div className="flex gap-2 items-center"><User size={14} className="text-slate-400"/> 출연: {movieDetail.actors?.slice(0, 3).map(a => a.peopleNm).join(', ') || '-'}</div>
               <div className="flex gap-2 items-center"><CalendarIcon size={14} className="text-slate-400"/> 개봉: {movieDetail.openDt || '-'}</div>
             </div>
           ) : (<div className="text-center text-slate-400 text-xs py-2">상세 정보를 불러오는 중...</div>)}
        </div>

        <TrendChart data={trendData} loading={loading} prediction={prediction} />

        {/* AI 분석 리포트 */}
        {prediction && !aiLoading && (
          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm mt-4">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm border-b border-slate-50 pb-2">
              <Sparkles size={16} className="text-purple-600"/> 
              AI 상세 분석
            </div>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line text-justify break-keep">
              {prediction.analysisText}
            </p>
          </div>
        )}

        {/* [NEW] 관련 기사 (리스트형 + 폴백 버튼) */}
        {newsList.length > 0 ? (
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm">
              <Newspaper size={16} className="text-blue-500"/> 
              관련 최신 기사 (네이버)
            </div>
            <div className="space-y-3">
              {newsList.map((news, idx) => (
                <a key={idx} href={news.link} target="_blank" rel="noopener noreferrer" className="block group">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 line-clamp-1 group-hover:text-blue-600 transition-colors"
                          dangerouslySetInnerHTML={{ __html: news.title }} />
                      <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-snug"
                         dangerouslySetInnerHTML={{ __html: news.desc }} />
                      <span className="text-[10px] text-slate-400 mt-1.5 block">{news.press}</span>
                    </div>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 shrink-0 mt-1 ml-2" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        ) : (
          /* 뉴스가 없거나 실패했을 때 보여줄 버튼 (빈 화면 방지) */
          <div className="flex gap-2 mt-4">
             <button 
               onClick={() => openNewsSearch('naver')}
               className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-[#03C75A] text-white rounded-lg text-xs font-bold hover:bg-[#02b351] transition-all shadow-sm active:scale-95"
             >
               <Newspaper size={14} /> 네이버 검색
             </button>
             <button 
               onClick={() => openNewsSearch('google')}
               className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 transition-all shadow-sm active:scale-95"
             >
               <ExternalLink size={14} /> 구글 검색
             </button>
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 pb-8">
        <button onClick={handleShare} className="w-full bg-[#FEE500] hover:bg-[#FDD835] text-[#3c1e1e] font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-[0.98]">
          <Share2 size={18} /><span>공유하기</span>
        </button>
      </div>
    </div>
  );
};

export default DetailView;
