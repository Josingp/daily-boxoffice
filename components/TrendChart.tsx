import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, Brush } from 'recharts';
import { PredictionResult } from '../types';

interface TrendChartProps {
  data: any[];
  type: 'DAILY' | 'REALTIME' | 'DRAMA';
  metric: 'audi' | 'sales' | 'scrn' | 'show' | 'rating';
  loading?: boolean;
  prediction?: PredictionResult | null;
  openDt?: string; // 개봉일 정보 (D-Day 계산용)
}

// 날짜 파싱 헬퍼 (YYYYMMDD 또는 YYYY-MM-DD)
const parseDateString = (dateStr: string) => {
    if (!dateStr) return null;
    let y, m, d;
    if (dateStr.length === 8 && !dateStr.includes('-')) {
        y = parseInt(dateStr.substring(0, 4), 10);
        m = parseInt(dateStr.substring(4, 6), 10) - 1;
        d = parseInt(dateStr.substring(6, 8), 10);
    } else {
        const dt = new Date(dateStr);
        y = dt.getFullYear();
        m = dt.getMonth();
        d = dt.getDate();
    }
    if (isNaN(y)) return null;
    return new Date(y, m, d);
};

// 커스텀 X축 틱 (날짜 + D-Day)
const CustomTick = ({ x, y, payload, chartData }: any) => {
    // payload.index가 가끔 범위를 벗어날 수 있어 방어 코드 추가
    const dataItem = chartData[payload.index];
    const dDay = dataItem?.dDay;
    const label = payload.value; // 날짜(요일)

    return (
        <g transform={`translate(${x},${y})`}>
            {/* D-Day (날짜 위) */}
            {dDay && (
                <text x={0} y={-4} dy={0} textAnchor="middle" fill={dDay.includes('D-') || dDay === 'D-Day' ? '#ef4444' : '#3b82f6'} fontSize={10} fontWeight="bold">
                    {dDay}
                </text>
            )}
            {/* 날짜 (요일 포함) */}
            <text x={0} y={12} dy={0} textAnchor="middle" fill="#94a3b8" fontSize={10}>
                {label}
            </text>
        </g>
    );
};

const TrendChart: React.FC<TrendChartProps> = ({ data, type, metric, loading, prediction, openDt }) => {
  
  // 단위 결정 함수
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

    // 개봉일 객체 생성
    const openDateObj = openDt ? parseDateString(openDt) : null;

    // 공통 D-Day 및 요일 계산 함수
    const enrichData = (item: any, dateStr: string) => {
        const dateObj = parseDateString(dateStr);
        let label = item.label || dateStr;
        let dDay = null;

        if (dateObj) {
            // 요일 추가
            const dayName = ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()];
            // YYYYMMDD -> MM/DD 형태로 변환된 라벨이 있으면 그 뒤에 요일 붙임
            if (item.dateDisplay) {
                label = `${item.dateDisplay}(${dayName})`;
            } else if (dateStr.length === 8) {
                label = `${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}(${dayName})`;
            } else {
                label = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}(${dayName})`;
            }

            // D-Day 계산
            if (openDateObj) {
                const diffTime = dateObj.getTime() - openDateObj.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 0) dDay = "D-Day";
                else if (diffDays > 0) dDay = `D+${diffDays}`;
                else dDay = `D${diffDays}`; // diffDays가 음수이므로 -가 포함됨
            }
        }
        return { label, dDay };
    };

    if (type === 'DRAMA') {
        return data.map((item) => {
            const { label } = enrichData(item, item.date); // 드라마는 D-Day 굳이 안 써도 되지만 로직은 공유
            return {
                ...item,
                label, // 요일 포함된 라벨
                value: item.rating, // ratingVal
                date: item.date
            };
        });
    }

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
    
    // REALTIME
    return data.map(item => ({
        label: item.time.split(' ')[1], // 시간만 표시 (예: 14:30)
        value: item.val_audi || 0,
        rate: item.rate
    }));
  }, [data, prediction, type, metric, openDt]);

  if (loading) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터 로딩 중...</div>;
  if (!chartData.length) return <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl text-xs text-slate-400">데이터가 없습니다.</div>;

  const color = type === 'REALTIME' ? '#8b5cf6' : 
                type === 'DRAMA' ? '#9333ea' : 
                metric === 'audi' ? '#3b82f6' : 
                metric === 'sales' ? '#10b981' : '#f59e0b';

  // [수정] 쉼표 추가 및 포맷팅
  const formatYAxis = (val: number) => {
      if (type === 'DRAMA' || metric === 'rating') return `${val}%`; 
      if (val >= 100000000) return `${(val/100000000).toFixed(0)}억`;
      if (val >= 10000) return `${(val/10000).toFixed(0)}만`;
      return val.toLocaleString(); // 쉼표 추가
  };

  // Brush 초기 범위 설정 (최근 14개 데이터만 보이게)
  const startIndex = Math.max(0, chartData.length - 14);
  const endIndex = Math.max(0, chartData.length - 1);

  return (
    <div className="w-full h-64 mt-2"> {/* 높이를 조금 늘림 (h-48 -> h-64) */}
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
            interval={0} // 모든 틱 표시 시도 (Brush로 조절하므로)
            height={50} // D-Day 표시를 위한 공간 확보
            tick={<CustomTick chartData={chartData} />} // 커스텀 틱 적용
          />
          
          <YAxis 
            tick={{fontSize: 10, fill: '#94a3b8'}} 
            axisLine={false} 
            tickLine={false} 
            tickFormatter={formatYAxis} 
            domain={type === 'DRAMA' ? ['auto', 'auto'] : [0, 'auto']} 
            width={40}
          />
          
          <Tooltip 
              contentStyle={{borderRadius:'8px', border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}
              formatter={(val: number, name) => [
                  type === 'DRAMA' || metric === 'rating' ? `${val}%` : `${val.toLocaleString()}${unit}`, // 툴팁에도 쉼표 적용
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
            isAnimationActive={false} // Brush 사용 시 애니메이션이 튀는 경우 방지
          />
          
          {metric === 'audi' && <Line type="monotone" dataKey="predict" stroke="#10b981" strokeDasharray="5 5" dot={{r:3}} connectNulls />}
          
          {/* 전체 데이터 탐색을 위한 Brush 추가 */}
          <Brush 
            dataKey="label" 
            height={20} 
            stroke="#cbd5e1" 
            fill="#f8fafc"
            tickFormatter={() => ""} // Brush 내부 텍스트 숨김
            startIndex={startIndex}
            endIndex={endIndex}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendChart;
