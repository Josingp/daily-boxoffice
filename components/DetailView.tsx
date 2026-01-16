import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo, PredictionResult, ReservationData } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieTrend, fetchMovieDetail, fetchRealtimeReservation } from '../services/kobisService';
import { predictMoviePerformance } from '../services/geminiService';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Calendar as CalendarIcon, Ticket, RefreshCw, AlertTriangle } from 'lucide-react';

interface DetailViewProps {
  movie: DailyBoxOfficeList | null;
  targetDate: string;
  onClose: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({ movie, targetDate, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [reservation, setReservation] = useState<ReservationData | null>(null);
  const [resError, setResError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (movie) {
      setIsVisible(true);
      setPrediction(null);
      setReservation(null);
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
      const trend = await fetchMovieTrend(movie.movieCd, targetDate);
      const info = await fetchMovieDetail(movie.movieCd);
      const resResult = await fetchRealtimeReservation(movie.movieNm);

      setTrendData(trend);
      setMovieDetail(info);

      if (resResult && resResult.data) {
        setReservation(resResult.data);
      } else {
        setReservation(null);
        setResError(resResult?.error || "데이터 없음");
      }
      
      setLoading(false);

      if (trend.length > 0 && info) {
        const pred = await predictMoviePerformance(movie.movieNm, trend, info, movie.audiAcc);
        setPrediction(pred);
      }
      setAiLoading(false);

    } catch (e: any) {
      console.error(e);
      setResError(e.message);
      setLoading(false);
      setAiLoading(false);
    }
  };

  const handleShare = async () => {
    if (!movie) return;
    const text = `🎬 ${movie.movieNm} AI 분석 리포트 확인하기`;
    if (navigator.share) {
      try { await navigator.share({ title: movie.movieNm, text }); } catch {}
    } else {
      navigator.clipboard.writeText(text);
      alert('복사되었습니다.');
    }
  };

  const getChangeElement = (val: string) => {
    const num = Number(val);
    if (num > 0) return <span className="text-red-500 text-xs font-semibold">▲{formatNumber(num)}</span>;
    if (num < 0) return <span className="text-blue-600 text-xs font-semibold">▼{formatNumber(Math.abs(num))}</span>;
    return <span className="text-slate-400 text-xs">-</span>;
  };

  if (!movie) return null;

  // 안전한 숫자 변환 헬퍼 (replace 에러 방지)
  const safeParse = (val: string | undefined) => parseInt((val || '0').replace(/,/g, ''));

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
                <span>실시간</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-y-4 gap-x-2 relative z-10">
              <div className="col-span-2 flex items-baseline gap-2 pb-2 border-b border-white/10">
                 <span className="text-4xl font-black tracking-tight">{reservation.rate}</span>
                 <span className="text-lg font-medium text-indigo-200">예매 {reservation.rank}위</span>
              </div>
              <div>
                <p className="text-[10px] text-indigo-200 mb-0.5">예매 관객수</p>
                <p className="font-bold text-lg">{formatNumber(safeParse(reservation.audiCnt))}명</p>
              </div>
              <div>
                <p className="text-[10px] text-indigo-200 mb-0.5">누적 관객수</p>
                <p className="font-bold text-lg">{formatNumber(safeParse(reservation.audiAcc))}명</p>
              </div>
              <div>
                <p className="text-[10px] text-indigo-200 mb-0.5">예매 매출액</p>
                <p className="font-medium text-sm text-indigo-100">{formatKoreanNumber(safeParse(reservation.salesAmt))}원</p>
              </div>
               <div>
                <p className="text-[10px] text-indigo-200 mb-0.5">누적 매출액</p>
                <p className="font-medium text-sm text-indigo-100">{formatKoreanNumber(safeParse(reservation.salesAcc))}원</p>
              </div>
            </div>
          </div>
        ) : (
           loading ? (
             <div className="h-48 bg-slate-100 rounded-2xl animate-pulse"></div>
           ) : (
             <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center py-6">
                <div className="flex justify-center mb-2 text-red-400"><AlertTriangle size={24}/></div>
                <p className="text-xs font-bold text-red-600 mb-1">예매 정보 없음</p>
                <p className="text-[10px] text-red-500 bg-white p-2 rounded border border-red-100 font-mono break-all">
                  {resError || "API 응답 없음"}
                </p>
             </div>
           )
        )}

        {/* 영화 기본 정보 */}
        {loading ? (
             <div className="space-y-2 p-4 bg-slate-50 rounded-xl">
                <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                <div className="h-4 bg-slate-200 rounded w-2/3"></div>
             </div>
        ) : (
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
             {movieDetail && (
               <div className="grid grid-cols-1 gap-2 text-sm text-slate-700">
                 <div className="flex gap-2 items-center"><Film size={14} className="text-slate-400"/> 감독: {movieDetail.directors?.map(d => d.peopleNm).join(', ')}</div>
                 <div className="flex gap-2 items-center"><User size={14} className="text-slate-400"/> 출연: {movieDetail.actors?.slice(0, 3).map(a => a.peopleNm).join(', ')}</div>
                 <div className="flex gap-2 items-center"><CalendarIcon size={14} className="text-slate-400"/> 개봉: {movieDetail.openDt}</div>
               </div>
             )}
          </div>
        )}

        {/* 일별 통계 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-slate-500"><TrendingUp size={16} /><span className="text-xs font-semibold">일일 관객수</span></div>
            <div className="text-xl font-black text-slate-800 tracking-tight">{formatNumber(movie.audiCnt)}명</div>
            <div className="mt-1">{getChangeElement(movie.audiInten)}</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-slate-500"><DollarSign size={16} /><span className="text-xs font-semibold">일일 매출액</span></div>
            <div className="text-xl font-black text-slate-800 tracking-tight">{formatKoreanNumber(movie.salesAmt)}원</div>
             <div className="mt-1">{getChangeElement(String(Math.floor(Number(movie.salesInten))))}</div>
          </div>
        </div>

        {/* 차트 */}
        <TrendChart data={trendData} loading={loading} prediction={prediction} />

        {/* AI 분석 리포트 (복구됨) */}
        {prediction && !aiLoading && (
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
            <div className="flex items-center gap-2 mb-2 text-slate-800 font-bold text-sm">
              <Sparkles size={16} className="text-purple-600"/> 
              AI 데이터 분석 리포트
            </div>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line text-justify break-keep">
              {prediction.analysisText}
            </p>
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
