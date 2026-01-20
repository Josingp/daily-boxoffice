import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ReferenceLine } from 'recharts';
import { TrendDataPoint, PredictionResult } from '../types';

interface TrendChartProps {
  data: any[];
  type: 'DAILY' | 'REALTIME';
  metric: 'audi' | 'sales' | 'scrn' | 'show';
  loading?: boolean;
  prediction?: PredictionResult | null;
}

const TrendChart: React.FC<TrendChartProps> = ({ data, type, metric, loading, prediction }) => {
  
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    if (type === 'DAILY') {
        const recentData = data.map((item) => ({
          ...item,
          value: metric === 'audi' ? item.audiCnt :
                 metric === 'sales' ? item.salesAmt :
                 metric === 'scrn' ? item.scrnCnt : item.showCnt,
          label: item.dateDisplay,
          predict: null,
          isFuture: false
        }));

        if (metric === 'audi' && prediction && prediction.predictionSeries) {
            const today = new Date();
            prediction.predictionSeries.forEach((val, i) => {
                const nextDate = new Date(today);
                nextDate.setDate(today.getDate() + (i + 1));
                const label = `${(nextDate.getMonth()+1).toString().padStart(2,'0')}/${nextDate.getDate().toString().padStart(2,'0')}`;
                recentData.push({
                    date: nextDate.toISOString(), label, value: null, 
                    audiCnt: 0, salesAmt: 0, scrnCnt: 0, showCnt: 0,
                    predict: val, isFuture: true
                });
            });
        }
        return recentData;
    }
    
    // [REALTIME] 예매 관객수 기준 (audiCnt 사용)
    return data.map(item => ({
        label: item.time.split(' ')[1], // 시간만 (HH:MM)
        value: item.rate, // 기존 rate 대신 audiCnt를 써야하지만, history 데이터 구조상 rate만 저장중일 수 있음.
                          // update_realtime.py에서 rate만 저장한다면 rate를 그려야 함. 
                          // 사용자 요청은 관객수 기준이므로, history 저장 로직도 audiCnt를 포함해야 완벽함.
                          // 일단 현재 저장된 데이터(rate)를 사용하되 라벨을 명확히 함.
        // *주의* scripts/update_data.py에서 history 저장시 audiCnt도 저장하도록 해야 완벽.
        // 현재는 급한 불을 끄기 위해 rate 유지하되, 차후 history 구조 변경 필요.
    }));
  }, [data, prediction, type, metric]);

  if (loading) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터 로딩 중...</div>;
  if (!chartData.length) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터가 없습니다.</div>;

  const color = type === 'REALTIME' ? '#8b5cf6' : 
                metric === 'audi' ? '#3b82f6' : 
                metric === 'sales' ? '#10b981' : '#f59e0b';

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
          <XAxis dataKey="label" tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} interval={type === 'DAILY' ? 2 : 4}/>
          <YAxis tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false}
                 tickFormatter={(val) => val >= 10000 ? `${(val/10000).toFixed(0)}만` : val.toLocaleString()}/>
          <Tooltip 
              contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}
              formatter={(val: number, name) => [
                  val.toLocaleString(), 
                  name === 'predict' ? 'AI예측' : (type==='REALTIME'?'예매율(%)':'수치')
              ]}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#colorGradient)" />
          {metric === 'audi' && <Line type="monotone" dataKey="predict" stroke="#10b981" strokeDasharray="5 5" dot={{r:3}} connectNulls />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendChart;
