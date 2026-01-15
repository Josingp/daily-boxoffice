import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line } from 'recharts';
import { TrendDataPoint, PredictionResult } from '../types';

interface TrendChartProps {
  data: TrendDataPoint[];
  loading: boolean;
  prediction?: PredictionResult | null;
}

const TrendChart: React.FC<TrendChartProps> = ({ data, loading, prediction }) => {
  
  const chartData = useMemo(() => {
    if (!data.length) return [];

    // 1. Map existing 7 days
    const baseData = data.map((item, index) => ({
      ...item,
      // Use the realistic match series for the chart
      similarCnt: prediction?.similarMovieSeries?.[index] ?? null,
      predictCnt: null as number | null,
      isFuture: false,
    }));

    if (!prediction) return baseData;

    // 2. Add next 3 days for prediction
    const lastDateStr = data[data.length - 1].date; // YYYYMMDD
    const futureData = [];
    
    const lastDate = new Date(
      parseInt(lastDateStr.substring(0, 4)),
      parseInt(lastDateStr.substring(4, 6)) - 1,
      parseInt(lastDateStr.substring(6, 8))
    );

    for (let i = 0; i < 3; i++) {
      const nextDate = new Date(lastDate);
      nextDate.setDate(lastDate.getDate() + (i + 1));
      
      const m = (nextDate.getMonth() + 1).toString().padStart(2, '0');
      const d = nextDate.getDate().toString().padStart(2, '0');
      
      futureData.push({
        date: nextDate.toISOString(), 
        dateDisplay: `${m}/${d}`,
        audiCnt: null as number | null,
        similarCnt: null,
        predictCnt: prediction.predictionSeries[i],
        isFuture: true,
      });
    }

    return [...baseData, ...futureData];
  }, [data, prediction]);

  if (loading) {
    return (
      <div className="h-[240px] w-full flex items-center justify-center bg-slate-50 rounded-xl border border-slate-100">
        <div className="animate-pulse text-slate-400 text-sm">데이터 분석 중...</div>
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

  // Find the realistic match name for the legend
  const realisticMatch = prediction?.similarMovies.find(m => m.matchType === 'REALISTIC')?.name || '유사 패턴';

  return (
    <div className="w-full bg-white p-2 rounded-xl border border-slate-100">
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorAudi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
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
              tickFormatter={(value) => `${(value / 10000).toFixed(0)}만`}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              labelStyle={{ color: '#64748b', marginBottom: '4px', fontSize: '12px' }}
              formatter={(value: number, name: string) => {
                if (value === null) return [];
                const label = name === 'audiCnt' ? '현재 영화' : 
                              name === 'similarCnt' ? '비슷한 영화' : 
                              name === 'predictCnt' ? 'AI 예측' : name;
                return [`${value.toLocaleString()}명`, label];
              }}
            />
            
            {/* Similar Movie Comparison Line */}
            {prediction && (
              <Line 
                type="monotone" 
                dataKey="similarCnt" 
                stroke="#94a3b8" 
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                name="similarCnt"
              />
            )}

            {/* Current Movie Area */}
            <Area 
              type="monotone" 
              dataKey="audiCnt" 
              stroke="#3b82f6" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorAudi)" 
              name="audiCnt"
            />

            {/* Future Prediction Line */}
            {prediction && (
               <Line 
                type="monotone" 
                dataKey="predictCnt" 
                stroke="#8b5cf6" 
                strokeWidth={2}
                strokeDasharray="2 2"
                dot={{ r: 4, strokeWidth: 2, fill: "#fff", stroke: "#8b5cf6" }}
                name="predictCnt"
                connectNulls
              />
            )}

          </AreaChart>
        </ResponsiveContainer>
      </div>

      {prediction && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[10px] text-slate-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-500/30 border border-blue-500 rounded-sm"></div>
            <span>현재 영화</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-slate-400 border-t-2 border-slate-400 border-dashed"></div>
            <span>{realisticMatch} (유사)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-purple-500 border-t-2 border-purple-500 border-dashed"></div>
            <span>미래 예측</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrendChart;