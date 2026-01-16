import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ReferenceLine } from 'recharts';
import { TrendDataPoint, PredictionResult, MovieInfo } from '../types';

interface TrendChartProps {
  data: TrendDataPoint[];
  loading: boolean;
  prediction?: PredictionResult | null;
  movieInfo?: MovieInfo | null;
}

const TrendChart: React.FC<TrendChartProps> = ({ data, loading, prediction }) => {
  
  const chartData = useMemo(() => {
    if (!data.length) return [];

    // 1. 과거 데이터 매핑
    const baseData = data.map((item, index) => ({
      ...item,
      // 유사 영화 패턴 (AI 예측 결과에 포함된 경우)
      similarCnt: prediction?.similarMovieSeries?.[index] ?? null,
      predictCnt: null as number | null,
      isFuture: false,
    }));

    if (!prediction) return baseData;

    // 2. 미래 예측 데이터 추가 (3일치)
    const lastDateStr = data[data.length - 1].date; // YYYYMMDD
    const futureData = [];
    
    // 날짜 파싱 (YYYYMMDD -> Date 객체)
    const lastDate = new Date(
      parseInt(lastDateStr.substring(0, 4)),
      parseInt(lastDateStr.substring(4, 6)) - 1,
      parseInt(lastDateStr.substring(6, 8))
    );

    for (let i = 0; i < prediction.predictionSeries.length; i++) {
      const nextDate = new Date(lastDate);
      nextDate.setDate(lastDate.getDate() + (i + 1));
      
      const m = (nextDate.getMonth() + 1).toString().padStart(2, '0');
      const d = nextDate.getDate().toString().padStart(2, '0');
      
      futureData.push({
        date: nextDate.toISOString(), 
        dateDisplay: `${m}/${d}`,
        audiCnt: null as number | null,
        similarCnt: null,
        predictCnt: prediction.predictionSeries[i], // 예측값
        isFuture: true,
      });
    }

    return [...baseData, ...futureData];
  }, [data, prediction]);

  if (loading) {
    return (
      <div className="h-[240px] w-full flex items-center justify-center bg-slate-50 rounded-xl border border-slate-100 animate-pulse">
        <div className="text-slate-400 text-sm">데이터 분석 중...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[240px] w-full flex items-center justify-center bg-slate-50 rounded-xl border border-slate-100">
        <span className="text-slate-400 text-sm">데이터가 없습니다.</span>
      </div>
    );
  }

  return (
    <div className="w-full bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        📊 관객수 추이 및 예측
      </h3>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorAudi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorPred" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis 
              dataKey="dateDisplay" 
              tick={{fontSize: 11, fill: '#94a3b8'}} 
              axisLine={false}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis 
              tick={{fontSize: 11, fill: '#94a3b8'}} 
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              labelStyle={{ color: '#64748b', marginBottom: '4px', fontSize: '12px' }}
              formatter={(value: number, name: string) => {
                if (value === null) return [];
                let label = name;
                if (name === 'audiCnt') label = '실제 관객수';
                if (name === 'predictCnt') label = 'AI 예측';
                if (name === 'similarCnt') label = '유사 패턴';
                return [`${value.toLocaleString()}명`, label];
              }}
            />
            
            {/* 1. 실제 관객수 (Area) */}
            <Area 
              type="monotone" 
              dataKey="audiCnt" 
              stroke="#6366f1" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorAudi)" 
              name="audiCnt"
              animationDuration={1000}
            />

            {/* 2. AI 예측 (Line - Dotted) */}
            {prediction && (
               <Line 
                type="monotone" 
                dataKey="predictCnt" 
                stroke="#10b981" 
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: "#10b981" }}
                name="predictCnt"
                connectNulls
              />
            )}

            {/* 3. 오늘 날짜 기준선 */}
            {prediction && (
              <ReferenceLine x={data[data.length - 1]?.dateDisplay} stroke="#cbd5e1" strokeDasharray="3 3" label={{ value: "오늘", fontSize: 10, fill: "#94a3b8", position: "insideTopRight" }} />
            )}

          </AreaChart>
        </ResponsiveContainer>
      </div>

      {prediction && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-[10px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-indigo-500/30 border border-indigo-500 rounded-sm"></div>
            <span>실제 추이</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 bg-emerald-500 border-t-2 border-emerald-500 border-dashed"></div>
            <span>AI 예측</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrendChart;
