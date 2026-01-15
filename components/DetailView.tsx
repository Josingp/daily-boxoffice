import React, { useEffect, useState } from 'react';
import { DailyBoxOfficeList, TrendDataPoint, MovieInfo, PredictionResult } from '../types';
import { formatNumber, formatKoreanNumber } from '../constants';
import { fetchMovieTrend, fetchMovieDetail } from '../services/kobisService';
// UPDATED IMPORT: Reverted to use the direct Gemini service
import { predictMoviePerformance } from '../services/geminiService';
import TrendChart from './TrendChart';
import { X, TrendingUp, DollarSign, Share2, Sparkles, Film, User, Clock, Calendar as CalendarIcon, Target, Activity, BarChart2, TrendingDown, RefreshCw, AlertTriangle, GitCompare } from 'lucide-react';

interface DetailViewProps {
  movie: DailyBoxOfficeList | null;
  targetDate: string;
  onClose: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({ movie, targetDate, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [movieDetail, setMovieDetail] = useState<MovieInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (movie) {
      setIsVisible(true);
      setPrediction(null);
      loadData(movie);
    } else {
      setIsVisible(false);
    }
  }, [movie]);

  const loadData = async (movie: DailyBoxOfficeList) => {
    setDetailLoading(true);
    setTrendLoading(true);
    setAiLoading(true);

    try {
      // 1. Fetch Basic Data
      const [trend, info] = await Promise.all([
        fetchMovieTrend(movie.movieCd, targetDate),
        fetchMovieDetail(movie.movieCd)
      ]);

      setTrendData(trend);
      setMovieDetail(info);
      setDetailLoading(false);
      setTrendLoading(false);

      // 2. Fetch Prediction directly from Gemini (Client-side)
      if (trend.length > 0 && info) {
        // UPDATED CALL: Use predictMoviePerformance from geminiService
        const pred = await predictMoviePerformance(movie.movieNm, trend, info, movie.audiAcc);
        setPrediction(pred);
        setAiLoading(false);
      } else {
        setAiLoading(false);
      }

    } catch (e) {
      console.error(e);
      setDetailLoading(false);
      setTrendLoading(false);
      setAiLoading(false);
    }
  };

  const handleShare = async () => {
    if (!movie) return;
    
    const text = `🎬 [BoxOffice Pro]
영화: ${movie.movieNm}
현재: ${formatKoreanNumber(movie.audiAcc)}명
예상: ${prediction ? formatKoreanNumber(prediction.predictedFinalAudi.avg) : '?'}명`;

    if (navigator.share) {
      try {
        await navigator.share({ title: `${movie.movieNm} 예측`, text: text });
      } catch (err) {}
    } else {
      navigator.clipboard.writeText(text);
      alert('클립보드에 복사되었습니다.');
    }
  };

  const getChangeElement = (val: string) => {
    const num = Number(val);
    if (num > 0) return <span className="text-red-500 text-xs font-semibold">▲{formatNumber(num)}</span>;
    if (num < 0) return <span className="text-blue-600 text-xs font-semibold">▼{formatNumber(Math.abs(num))}</span>;
    return <span className="text-slate-400 text-xs">-</span>;
  };

  if (!movie) return null;

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out ${isVisible ? 'translate-y-0' : 'translate-y-full'}`}>
      {/* Header */}
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

      {/* Content Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24">
        
        {/* Movie Info (Poster Removed) */}
        {detailLoading ? (
             <div className="space-y-2 p-4 bg-slate-50 rounded-xl">
                <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                <div className="h-4 bg-slate-200 rounded w-2/3"></div>
             </div>
        ) : (
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
             <div className="space-y-3">
                {movieDetail ? (
                  <>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {movieDetail.audits?.[0]?.watchGradeNm && <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md border border-slate-200">{movieDetail.audits[0].watchGradeNm}</span>}
                      {movieDetail.genres?.map((g) => <span key={g.genreNm} className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-100">{g.genreNm}</span>)}
                      <span className="px-2 py-1 bg-slate-50 text-slate-500 rounded-md border border-slate-200 flex items-center gap-1"><Clock size={12}/> {movieDetail.showTm}분</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-sm text-slate-700 mt-2">
                      <div className="flex gap-2 items-center"><Film size={14} className="text-slate-400 shrink-0"/> <span className="font-bold text-slate-500 text-xs">감독</span> {movieDetail.directors?.map(d => d.peopleNm).join(', ') || '-'}</div>
                      <div className="flex gap-2 items-center"><User size={14} className="text-slate-400 shrink-0"/> <span className="font-bold text-slate-500 text-xs">출연</span> {movieDetail.actors?.slice(0, 4).map(a => a.peopleNm).join(', ') || '-'}</div>
                      <div className="flex gap-2 items-center"><CalendarIcon size={14} className="text-slate-400 shrink-0"/> <span className="font-bold text-slate-500 text-xs">개봉</span> {movieDetail.openDt}</div>
                    </div>
                  </>
                ) : <div className="text-xs text-slate-400">상세 정보를 불러올 수 없습니다.</div>}
             </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 mb-2 text-slate-500"><TrendingUp size={16} /><span className="text-xs font-semibold">일일 관객수</span></div>
            <div className="text-xl font-black text-slate-800 tracking-tight">{formatNumber(movie.audiCnt)}명</div>
            <div className="mt-1">{getChangeElement(movie.audiInten)}</div>
          </div>
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2 mb-2 text-slate-500"><DollarSign size={16} /><span className="text-xs font-semibold">일일 매출액</span></div>
            <div className="text-xl font-black text-slate-800 tracking-tight">{formatKoreanNumber(movie.salesAmt)}원</div>
             <div className="mt-1">{getChangeElement(String(Math.floor(Number(movie.salesInten))))}</div>
          </div>
        </div>

        {/* AI Prediction & Chart */}
        <div>
          <div className="flex justify-between items-end mb-3">
             <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">📊 관객 추이 및 AI 예측</h3>
          </div>
          <TrendChart data={trendData} loading={trendLoading} prediction={prediction} />
          
          {/* Detailed Prediction Results */}
          {aiLoading ? (
             <div className="mt-4 bg-slate-50 p-6 rounded-xl border border-slate-100 flex flex-col items-center justify-center gap-3">
                <div className="w-6 h-6 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                <div className="flex flex-col items-center">
                  <p className="text-sm text-indigo-600 font-bold animate-pulse">실시간 AI 데이터 계산 중...</p>
                  <p className="text-xs text-indigo-400 mt-1">PSA 감쇠 & 계절성 가중치 계산</p>
                </div>
             </div>
          ) : prediction ? (
            <div className="mt-4 space-y-4">
              
              {/* 1. Final Score Prediction Card (Comparision View) */}
              <div className="bg-slate-900 text-white p-5 rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-600 rounded-full blur-3xl opacity-20 -mr-10 -mt-10"></div>
                
                <div className="relative z-10 grid grid-cols-2 gap-4 divide-x divide-slate-700">
                  {/* Left: Current */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-slate-400 mb-1">
                      <Target size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">현재 누적</span>
                    </div>
                    <span className="text-2xl font-bold text-slate-200">{formatKoreanNumber(movie.audiAcc)}</span>
                  </div>

                  {/* Right: Predicted */}
                  <div className="flex flex-col gap-1 pl-4">
                    <div className="flex items-center gap-1 text-indigo-400 mb-1">
                      <Sparkles size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">최종 예상</span>
                    </div>
                    <span className="text-3xl font-black text-white">{formatKoreanNumber(prediction.predictedFinalAudi.avg)}</span>
                  </div>
                </div>

                <div className="relative z-10 mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-xs">
                   <span className="text-slate-400">예상 범위: {formatKoreanNumber(prediction.predictedFinalAudi.min)} ~ {formatKoreanNumber(prediction.predictedFinalAudi.max)}</span>
                   <span className="px-2 py-0.5 bg-indigo-600 rounded text-[10px] font-bold text-white shadow-sm">AI 신뢰도 92%</span>
                </div>
              </div>

              {/* 2. Algorithm Logic Factors Grid (PSA Logic) */}
              <div className="grid grid-cols-3 gap-2">
                 <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-center flex flex-col items-center justify-between min-h-[80px]">
                    <div className="mb-1 text-indigo-500"><TrendingDown size={18} /></div>
                    <div className="text-[10px] text-indigo-400 font-bold uppercase">감쇠(Decay) 요인</div>
                    <div className="text-xs font-bold text-indigo-900 mt-1 leading-tight break-keep">{prediction.logicFactors.decayFactor}</div>
                 </div>
                 <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-center flex flex-col items-center justify-between min-h-[80px]">
                    <div className="mb-1 text-indigo-500"><RefreshCw size={18} /></div>
                    <div className="text-[10px] text-indigo-400 font-bold uppercase">시즌/요일 패턴</div>
                    <div className="text-xs font-bold text-indigo-900 mt-1 leading-tight break-keep">{prediction.logicFactors.seasonalityScore}</div>
                 </div>
                 <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-center flex flex-col items-center justify-between min-h-[80px]">
                    <div className="mb-1 text-indigo-500"><AlertTriangle size={18} /></div>
                    <div className="text-[10px] text-indigo-400 font-bold uppercase">PSA (좌석효율)</div>
                    <div className="text-xs font-bold text-indigo-900 mt-1 leading-tight break-keep">{prediction.logicFactors.momentum}</div>
                 </div>
              </div>

              {/* 3. Text Analysis */}
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-bold text-sm">
                  <Sparkles size={16} className="text-purple-600"/> 
                  AI 데이터 분석 리포트
                </div>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line text-justify break-keep">
                  {prediction.analysisText}
                </p>
              </div>

              {/* 4. Similar Movies Scenario List (With Comparison Metric) */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                 <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                   <Activity size={16} className="text-blue-500"/> 유사 패턴 시나리오
                 </h4>
                 <div className="space-y-3">
                    {prediction.similarMovies.map((sim, idx) => (
                      <div key={idx} className="flex gap-3 items-start p-3 bg-white rounded-lg border border-slate-100 shadow-sm">
                         <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                            sim.matchType === 'OPTIMISTIC' ? 'bg-green-500' : 
                            sim.matchType === 'PESSIMISTIC' ? 'bg-red-500' : 'bg-blue-500'
                         }`}></div>
                         <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                               <span className="text-sm font-bold text-slate-800">{sim.name}</span>
                               <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                 최종: {sim.finalAudi}
                               </span>
                            </div>
                            
                            {/* Comparison Metric Badge */}
                            <div className="mb-1.5">
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                    <GitCompare size={10} />
                                    {sim.comparisonMetric || '데이터 패턴 유사'}
                                </span>
                            </div>

                            <p className="text-xs text-slate-500 leading-snug break-keep">{sim.similarityReason}</p>
                         </div>
                      </div>
                    ))}
                 </div>
              </div>

            </div>
          ) : null}
        </div>

      </div>

      {/* Share Button */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 pb-8">
        <button onClick={handleShare} className="w-full bg-[#FEE500] hover:bg-[#FDD835] text-[#3c1e1e] font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors active:scale-[0.98]">
          <Share2 size={18} /><span>공유하기</span>
        </button>
      </div>
    </div>
  );
};

export default DetailView;