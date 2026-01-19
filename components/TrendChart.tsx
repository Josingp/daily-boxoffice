import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ReferenceLine } from 'recharts';
import { TrendDataPoint, PredictionResult } from '../types';

interface TrendChartProps {
  data: TrendDataPoint[];
  loading: boolean;
  prediction?: PredictionResult | null;
}

const TrendChart: React.FC<TrendChartProps> = ({ data, loading, prediction }) => {
  
  const chartData = useMemo(() => {
    if (!data.length) return [];

    // [핵심] "오늘"을 기준으로 그래프 중심을 맞추기 위해
    // 과거 데이터 중 최근 7일치만 잘라서 보여줌
    const recentData = data.slice(-8).map((item) => ({
      ...item,
      predictCnt: null as number | null,
      isFuture: false,
      isToday: item.dateDisplay === '오늘' // 오늘 여부 플래그
    }));

    if (!prediction || !prediction.predictionSeries) return recentData;

    // 미래 예측 데이터 생성
    const futureData = [];
    const today = new Date(); // 오늘부터 시작

    for (let i = 0; i < prediction.predictionSeries.length; i++) {
      const nextDate = new Date(today);
      nextDate.setDate(today.getDate() + (i + 1));
      
      const m = (nextDate.getMonth() + 1).toString().padStart(2, '0');
      const d = nextDate.getDate().toString().padStart(2, '0');
      
      futureData.push({
        date: nextDate.toISOString(), 
        dateDisplay: `${m}/${d}`,
        audiCnt: null as number | null,
        scrnCnt: 0,
        predictCnt: prediction.predictionSeries[i],
        isFuture: true,
        isToday: false
      });
    }

    // 과거(7일) + 오늘 + 미래(3일) 연결
    return [...recentData, ...futureData];
  }, [data, prediction]);

  if (loading) {
    return (
      <div className="flex items-center justify-center bg-slate-50 rounded-xl border border-slate-100 animate-pulse" style={{ height: '240px', width: '100%' }}>
        <div className="text-slate-400 text-sm">데이터 분석 중...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center bg-slate-50 rounded-xl border border-slate-100" style={{ height: '240px', width: '100%' }}>
        <span className="text-slate-400 text-sm">데이터가 없습니다.</span>
      </div>
    );
  }

  return (
    <div className="w-full bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        📊 관객수 추이 및 예측 (Today 중심)
      </h3>
      <div style={{ width: '100%', height: '220px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorAudi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis 
              dataKey="dateDisplay" 
              tick={{fontSize: 11, fill: '#94a3b8'}} 
              axisLine={false} tickLine={false} tickMargin={8}
            />
            <YAxis 
              tick={{fontSize: 11, fill: '#94a3b8'}} 
              axisLine={false} tickLine={false}
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              formatter={(value: number, name: string) => {
                if (value === null) return [];
                const label = name === 'predictCnt' ? 'AI 예측' : '관객수';
                return [`${value.toLocaleString()}명`, label];
              }}
            />
            {/* 실제 데이터 영역 */}
            <Area 
              type="monotone" 
              dataKey="audiCnt" 
              stroke="#6366f1" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorAudi)" 
            />
            {/* 미래 예측 라인 */}
            {prediction && (
               <Line 
                type="monotone" 
                dataKey="predictCnt" 
                stroke="#10b981" 
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: "#10b981" }}
                connectNulls
              />
            )}
            {/* 오늘 날짜 표시선 */}
            <ReferenceLine x="오늘" stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'top', value: 'Today', fill: '#ef4444', fontSize: 10 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TrendChart;
