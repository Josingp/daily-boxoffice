import React, { useMemo, useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Brush } from 'recharts';
import { PredictionResult } from '../types';

interface TrendChartProps {
  data: any[];
  type: 'DAILY' | 'REALTIME' | 'DRAMA';
  metric: 'audi' | 'sales' | 'scrn' | 'show' | 'rating';
  loading?: boolean;
  prediction?: PredictionResult | null;
  openDt?: string; // 개봉일 (D-Day 계산용)
}

// 날짜 파싱 헬퍼
const parseDateString = (dateStr: string) => {
    if (!dateStr) return null;
    let y, m, d;
    // YYYYMMDD
    if (dateStr.length === 8 && !dateStr.includes('-')) {
        y = parseInt(dateStr.substring(0, 4), 10);
        m = parseInt(dateStr.substring(4, 6), 10) - 1;
        d = parseInt(dateStr.substring(6, 8), 10);
    } else {
        // YYYY-MM-DD
        const dt = new Date(dateStr);
        y = dt.getFullYear();
        m = dt.getMonth();
        d = dt.getDate();
    }
    if (isNaN(y)) return null;
    return new Date(y, m, d);
};

// 커스텀 X축 틱
const CustomTick = ({ x, y, payload, chartData, isMobile }: any) => {
    const dataItem = chartData[payload.index];
    if (!dataItem) return null; // 방어 코드

    const dDay = dataItem.dDay;
    const label = payload.value;

    return (
        <g transform={`translate(${x},${y})`}>
            {/* D-Day: 모바일에서는 공간 절약을 위해 선택적으로 표시하거나 폰트를 줄임 */}
            {dDay && (
                <text 
                    x={0} 
                    y={-6} 
                    dy={0} 
                    textAnchor="middle" 
                    fill={dDay.includes('D-') || dDay === 'D-Day' ? '#ef4444' : '#3b82f6'} 
                    fontSize={isMobile ? 8 : 10} 
                    fontWeight="bold"
                >
                    {dDay}
                </text>
            )}
            {/* 날짜 */}
            <text 
                x={0} 
                y={10} 
                dy={0} 
                textAnchor="middle" 
                fill="#94a3b8" 
                fontSize={isMobile ? 9 : 10}
            >
                {label}
            </text>
        </g>
    );
};

const TrendChart: React.FC<TrendChartProps> = ({ data, type, metric, loading, prediction, openDt }) => {
  // 모바일 감지 State
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
        setIsMobile(window.innerWidth < 768);
    };
    
    // 초기 실행 및 리스너 등록
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getUnit = () => {
      if (type === 'REALTIME') return '명'; 
      if (type === 'DRAMA' || metric === 'rating') return '%';
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

    const openDateObj = openDt ? parseDateString(openDt) : null;

    // 데이터 가공 함수
    const enrichData = (item: any, dateStr: string) => {
        const dateObj = parseDateString(dateStr);
        let label = item.label || dateStr;
        let dDay = null;

        if (dateObj) {
            // 요일 추가
            const dayName = ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()];
            
            // 라벨 포맷팅
            if (item.dateDisplay) {
                // 모바일이면 요일 제거하여 짧게 표시
                label = isMobile ? item.dateDisplay : `${item.dateDisplay}(${dayName})`;
            } else if (dateStr.length === 8) {
                const md = `${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}`;
                label = isMobile ? md : `${md}(${dayName})`;
            } else {
                const md = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}`;
                label = isMobile ? md : `${md}(${dayName})`;
            }

            // D-Day 계산
            if (openDateObj) {
                const diffTime = dateObj.getTime() - openDateObj.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 0) dDay = "D-Day";
                else if (diffDays > 0) dDay = `D+${diffDays}`;
                else dDay = `D${diffDays}`;
            }
        }
        return { label, dDay };
    };

    // 1. 드라마
    if (type === 'DRAMA') {
        return data.map((item) => {
            const { label } = enrichData(item, item.date);
            return {
                ...item,
                label,
                value: item.rating, 
                date: item.date
            };
        });
    }

    // 2. 일별 박스오피스
    if (type === 'DAILY') {
        const recentData = data.map((item) => {
            const { label, dDay } = enrichData(item, item.date);
            return {
              ...item,
              value: metric === 'audi' ? item.audiCnt :
                     metric === 'sales' ? item.salesAmt :
                     metric === 'scrn' ? item.scrnCnt : item.showCnt,
              label,
              dDay,
              predict: null
            };
        });

        // AI 예측 데이터 추가
        if (metric === 'audi' && prediction && prediction.predictionSeries) {
            const today = new Date();
            prediction.predictionSeries.forEach((val, i) => {
                const nextDate = new Date(today);
                nextDate.setDate(today.getDate() + (i + 1));
                const dateStr = nextDate.toISOString().slice(0, 10).replace(/-/g, "");
                const { label, dDay } = enrichData({}, dateStr);
                
                recentData.push({
                    date: nextDate.toISOString(), 
                    label, 
                    value: null, 
                    audiCnt: 0, salesAmt: 0, scrnCnt: 0, showCnt: 0,
                    predict: val,
                    dDay
                });
            });
        }
        return recentData;
    }
    
    // 3. 실시간
    return data.map(item => ({
        label: item.time.split(' ')[1], // 시간만 표시 (예: 14:30)
        value: item.val_audi || 0,
        rate: item.rate
    }));
  }, [data, prediction, type, metric, openDt, isMobile]); // isMobile 변경 시 재계산

  if (loading) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터 로딩 중...</div>;
  if (!chartData.length) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터가 없습니다.</div>;

  const color = type === 'REALTIME' ? '#8b5cf6' : 
                type === 'DRAMA' ? '#9333ea' : 
                metric === 'audi' ? '#3b82f6' : 
                metric === 'sales' ? '#10b981' : '#f59e0b';

  // 쉼표 포맷팅
  const formatYAxis = (val: number) => {
      if (type === 'DRAMA' || metric === 'rating') return `${val}%`; 
      if (val >= 100000000) return `${(val/100000000).toFixed(0)}억`;
      if (val >= 10000) return `${(val/10000).toFixed(0)}만`;
      return val.toLocaleString(); 
  };

  // 초기 범위: 최근 14개
  const startIndex = Math.max(0, chartData.length - 14);
  const endIndex = Math.max(0, chartData.length - 1);

  return (
    <div className="w-full h-64 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 20, right: 0, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          
          <XAxis 
            dataKey="label" 
            axisLine={false} 
            tickLine={false} 
            // 모바일일 때는 자동 간격 조정(겹침 방지), PC일 때는 모든 라벨 표시(Brush 사용)
            interval={isMobile ? 'preserveStartEnd' : 0}
            minTickGap={isMobile ? 15 : 0} // 모바일에서 최소 간격 확보
            height={50} // D-Day 공간
            tick={<CustomTick chartData={chartData} isMobile={isMobile} />}
          />
          
          <YAxis 
            tick={{fontSize: isMobile ? 9 : 10, fill: '#94a3b8'}} 
            axisLine={false} 
            tickLine={false} 
            tickFormatter={formatYAxis} 
            domain={type === 'DRAMA' ? ['auto', 'auto'] : [0, 'auto']} 
            width={isMobile ? 35 : 40}
          />
          
          <Tooltip 
              contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}
              formatter={(val: number, name) => [
                  type === 'DRAMA' || metric === 'rating' ? `${val}%` : `${val.toLocaleString()}${unit}`, 
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
            isAnimationActive={false} 
          />
          
          {metric === 'audi' && <Line type="monotone" dataKey="predict" stroke="#10b981" strokeDasharray="5 5" dot={{r:3}} connectNulls />}
          
          {/* 스크롤/줌 기능 */}
          <Brush 
            dataKey="label" 
            height={20} 
            stroke="#cbd5e1" 
            fill="#f8fafc"
            tickFormatter={() => ""} 
            startIndex={startIndex}
            endIndex={endIndex}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendChart;
