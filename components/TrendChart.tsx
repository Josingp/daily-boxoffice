import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ReferenceLine } from 'recharts';
import { TrendDataPoint, PredictionResult } from '../types';

interface TrendChartProps {
  data: any[]; // 유연하게 받음
  type: 'DAILY' | 'REALTIME'; // 차트 타입
  loading?: boolean;
  prediction?: PredictionResult | null;
}

const TrendChart: React.FC<TrendChartProps> = ({ data, type, loading, prediction }) => {
  
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // [DAILY] 일별 관객수 데이터
    if (type === 'DAILY') {
        const recentData = data.slice(-14).map((item) => ({
          ...item,
          value: item.audiCnt, // Y축 값 통일
          label: item.dateDisplay, // X축 값 통일
          predict: null,
          isFuture: false
        }));

        if (prediction && prediction.predictionSeries) {
            const today = new Date();
            prediction.predictionSeries.forEach((val, i) => {
                const nextDate = new Date(today);
                nextDate.setDate(today.getDate() + (i + 1));
                const label = `${(nextDate.getMonth()+1).toString().padStart(2,'0')}/${nextDate.getDate().toString().padStart(2,'0')}`;
                recentData.push({
                    date: nextDate.toISOString(), label, value: null, predict: val, isFuture: true
                });
            });
        }
        return recentData;
    }
    
    // [REALTIME] 실시간 예매율 히스토리
    if (type === 'REALTIME') {
        // history 데이터 포맷: { time: "YYYY-MM-DD HH:MM", rate: 15.5, rank: 1 }
        // 너무 많으면 최근 24개만
        return data.slice(-24).map(item => ({
            label: item.time.split(' ')[1], // 시간만 표시
            value: item.rate,
            rank: item.rank
        }));
    }
    return [];
  }, [data, prediction, type]);

  if (loading) {
    return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-slate-400 text-xs animate-pulse">데이터 로딩 중...</div>;
  }

  if (!chartData.length) {
    return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-slate-400 text-xs">데이터가 없습니다.</div>;
  }

  const isDaily = type === 'DAILY';
  const color = isDaily ? "#3b82f6" : "#6366f1"; // Blue vs Indigo

  return (
    <div className="w-full bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
      <h3 className={`text-sm font-bold mb-4 flex items-center gap-2 ${isDaily ? 'text-blue-600' : 'text-indigo-600'}`}>
        {isDaily ? '📊 관객수 추이 및 예측' : '📈 실시간 예매율 추이'}
      </h3>
      <div style={{ width: '100%', height: '200px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={color} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} interval={isDaily ? 2 : 4}/>
            <YAxis tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false}
                   tickFormatter={(val) => isDaily ? `${(val/1000).toFixed(0)}k` : `${val}%`}/>
            <Tooltip 
                contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}
                labelStyle={{color:'#64748b', fontSize:'11px', marginBottom:'4px'}}
                formatter={(val: number, name) => [
                    isDaily ? `${val.toLocaleString()}명` : `${val}%`, 
                    name === 'predict' ? 'AI 예측' : (isDaily ? '관객수' : '예매율')
                ]}
            />
            
            {/* 메인 데이터 Area */}
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#colorGradient)" />
            
            {/* [DAILY] 미래 예측 점선 */}
            {isDaily && (
               <Line type="monotone" dataKey="predict" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={{r:3, fill:"#fff", stroke:"#10b981"}} connectNulls />
            )}
            
            {/* [DAILY] 오늘 기준선 */}
            {isDaily && <ReferenceLine x={chartData.find(d => !d.isFuture && chartData[chartData.indexOf(d)+1]?.isFuture)?.label} stroke="#ef4444" strokeDasharray="3 3" />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TrendChart;
