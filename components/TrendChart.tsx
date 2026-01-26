import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line } from 'recharts';
import { PredictionResult } from '../types';

interface TrendChartProps {
  data: any[];
  type: 'DAILY' | 'REALTIME' | 'DRAMA'; // DRAMA 추가
  metric: 'audi' | 'sales' | 'scrn' | 'show' | 'rating'; // rating 추가
  loading?: boolean;
  prediction?: PredictionResult | null;
}

const TrendChart: React.FC<TrendChartProps> = ({ data, type, metric, loading, prediction }) => {
  
  // 단위 결정 함수
  const getUnit = () => {
      if (type === 'REALTIME') return '명'; 
      if (type === 'DRAMA' || metric === 'rating') return '%'; // 시청률은 %
      switch(metric) {
          case 'sales': return '원';
          case 'scrn': return '개';
          case 'show': return '회';
          default: return '명';
      }
  };

  const unit = getUnit();

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    if (type === 'DRAMA') {
        // 드라마 데이터 매핑
        return data.map((item) => {
             // date: 20260126 -> 01/26 변환
            let label = item.date;
            if (label && label.length === 8) {
                label = `${label.substring(4,6)}/${label.substring(6,8)}`;
            }
            return {
                label,
                value: item.rating, // 숫자형 시청률 (예: 17.1)
                date: item.date
            };
        });
    }

    if (type === 'DAILY') {
        const recentData = data.map((item) => {
            let label = item.dateDisplay;
            if (!label && item.date && item.date.length === 8) {
                label = `${item.date.substring(4,6)}/${item.date.substring(6,8)}`;
            }
            return {
              ...item,
              value: metric === 'audi' ? item.audiCnt :
                     metric === 'sales' ? item.salesAmt :
                     metric === 'scrn' ? item.scrnCnt : item.showCnt,
              label: label || item.date,
              predict: null
            };
        });

        if (metric === 'audi' && prediction && prediction.predictionSeries) {
            const today = new Date();
            prediction.predictionSeries.forEach((val, i) => {
                const nextDate = new Date(today);
                nextDate.setDate(today.getDate() + (i + 1));
                const label = `${(nextDate.getMonth()+1).toString().padStart(2,'0')}/${nextDate.getDate().toString().padStart(2,'0')}`;
                recentData.push({
                    date: nextDate.toISOString(), label, value: null, 
                    audiCnt: 0, salesAmt: 0, scrnCnt: 0, showCnt: 0,
                    predict: val
                });
            });
        }
        return recentData;
    }
    
    // REALTIME
    return data.map(item => ({
        label: item.time.split(' ')[1],
        value: item.val_audi || 0,
        rate: item.rate
    }));
  }, [data, prediction, type, metric]);

  if (loading) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터 로딩 중...</div>;
  if (!chartData.length) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터가 없습니다.</div>;

  const color = type === 'REALTIME' ? '#8b5cf6' : 
                type === 'DRAMA' ? '#9333ea' : // 드라마는 보라색
                metric === 'audi' ? '#3b82f6' : 
                metric === 'sales' ? '#10b981' : '#f59e0b';

  // Y축 포맷팅 (시청률은 소수점 유지)
  const formatYAxis = (val: number) => {
      if (type === 'DRAMA' || metric === 'rating') return `${val}%`; 
      if (val >= 100000000) return `${(val/100000000).toFixed(0)}억`;
      if (val >= 10000) return `${(val/10000).toFixed(0)}만`;
      return val.toLocaleString();
  };

  return (
    <div className="w-full h-48 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis 
            dataKey="label" 
            tick={{fontSize: 10, fill: '#94a3b8'}} 
            axisLine={false} 
            tickLine={false} 
            interval={type === 'DAILY' ? 2 : 'preserveStartEnd'}
          />
          <YAxis 
            tick={{fontSize: 10, fill: '#94a3b8'}} 
            axisLine={false} 
            tickLine={false} 
            tickFormatter={formatYAxis} 
            domain={type === 'DRAMA' ? ['auto', 'auto'] : [0, 'auto']} // 시청률은 변화폭이 중요하므로 auto
            width={35}
          />
          <Tooltip 
              contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}
              formatter={(val: number, name) => [
                  `${val}${unit}`, 
                  name === 'predict' ? 'AI예측' : (type==='REALTIME' ? `예매관객` : type==='DRAMA' ? '시청률' : '수치')
              ]}
              labelStyle={{ color: '#64748b', fontSize: '12px', marginBottom: '4px' }}
          />
          <Area 
            type="monotone" 
            dataKey="value" 
            stroke={color} 
            strokeWidth={2} 
            fill="url(#colorGradient)" 
            animationDuration={1000}
          />
          {metric === 'audi' && <Line type="monotone" dataKey="predict" stroke="#10b981" strokeDasharray="5 5" dot={{r:3}} connectNulls />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendChart;
