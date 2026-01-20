import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line } from 'recharts';
import { PredictionResult } from '../types';

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

    // 1. 기존 데이터 매핑
    let baseData = [];
    
    if (type === 'DAILY') {
        baseData = data.map((item) => ({
          ...item,
          value: metric === 'audi' ? item.audiCnt :
                 metric === 'sales' ? item.salesAmt :
                 metric === 'scrn' ? item.scrnCnt : item.showCnt,
          label: item.dateDisplay,
          predict: null
        }));
    } else {
        // REALTIME
        baseData = data.map(item => ({
            label: item.time.split(' ')[1], // HH:MM
            value: item.val_audi || 0,
            rate: item.rate,
            predict: null
        }));
    }

    // 2. 예측 데이터 병합 (점선 표시용)
    if (metric === 'audi' && prediction && prediction.predictionSeries && prediction.predictionSeries.length > 0) {
        const lastItem = baseData[baseData.length - 1];
        
        // 그래프 끊김 방지를 위해 마지막 실제 데이터를 예측 시작점으로 추가
        // (Recharts에서 Line을 이어주기 위함, 실제 값엔 null, predict엔 실제값 넣어서 연결)
        // 단, 여기서는 간단하게 예측 데이터만 붙입니다.
        
        prediction.predictionSeries.forEach((val, i) => {
            let nextLabel = '';
            
            if (type === 'DAILY') {
                // 내일, 모레, 글피
                const today = new Date();
                const nextDate = new Date(today);
                nextDate.setDate(today.getDate() + (i + 1));
                nextLabel = `${(nextDate.getMonth()+1).toString().padStart(2,'0')}/${nextDate.getDate().toString().padStart(2,'0')}(예측)`;
            } else {
                // 다음 시간대 (임의로 1시간 간격 표시)
                const lastTimeParts = lastItem.label.split(':');
                let hour = parseInt(lastTimeParts[0]) + (i + 1);
                if (hour >= 24) hour -= 24;
                nextLabel = `${hour.toString().padStart(2,'0')}:00(예측)`;
            }

            baseData.push({
                label: nextLabel,
                value: null, // 실제 값 없음 (영역 그래프 끊김)
                predict: val // 예측 값 (선 그래프 연결)
            });
        });
    }

    return baseData;
  }, [data, prediction, type, metric]);

  if (loading) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터 로딩 중...</div>;
  if (!chartData.length) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터가 없습니다.</div>;

  const color = type === 'REALTIME' ? '#8b5cf6' : 
                metric === 'audi' ? '#3b82f6' : 
                metric === 'sales' ? '#10b981' : '#f59e0b';

  return (
    <div className="w-full h-48 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
            interval={type === 'DAILY' ? 'preserveStartEnd' : 4}
          />
          <YAxis 
            tick={{fontSize: 10, fill: '#94a3b8'}} 
            axisLine={false} 
            tickLine={false}
            tickFormatter={(val) => val >= 10000 ? `${(val/10000).toFixed(0)}만` : val.toLocaleString()}
          />
          <Tooltip 
              contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}
              formatter={(val: number, name, props) => [
                  `${val.toLocaleString()}명`, 
                  name === 'predict' ? 'AI 예측' : (type==='REALTIME' ? `예매관객` : '관객수')
              ]}
          />
          {/* 실제 데이터 (영역 그래프) */}
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#colorGradient)" />
          
          {/* 예측 데이터 (점선 그래프) */}
          <Line 
            type="monotone" 
            dataKey="predict" 
            stroke="#10b981" 
            strokeWidth={2} 
            strokeDasharray="5 5" 
            dot={{r:4, fill:"#10b981"}} 
            activeDot={{r:6}}
            connectNulls // 끊어진 점들을 연결
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendChart;
