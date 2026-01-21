import { GoogleGenAI } from "@google/genai";

/** -------- utils -------- */
const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/gi, "").replace(/```/g, "").trim();
};

// YYYYMMDD -> (DOW, Weekend/Weekday)  ※서버 타임존 영향 제거(UTC 기반)
const getDayContext = (dateStr: string) => {
  if (!dateStr || dateStr.length !== 8) return "";
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(4, 6), 10) - 1;
  const d = parseInt(dateStr.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[dt.getUTCDay()];
  const type = dayName === "Sat" || dayName === "Sun" ? "Weekend" : "Weekday";
  return `(${dayName}, ${type})`;
};

const ymdFromUTCDate = (dt: Date) => {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

const addDaysUTC = (ymd: string, plus: number) => {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(4, 6), 10) - 1;
  const d = parseInt(ymd.slice(6, 8), 10);
  const base = new Date(Date.UTC(y, m, d));
  base.setUTCDate(base.getUTCDate() + plus);
  return ymdFromUTCDate(base);
};

const getKST_YYYYMMDD = () => {
  // "en-CA" -> YYYY-MM-DD 포맷 보장
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return s.replace(/-/g, "");
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const safeNum = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

type TrendRow = {
  date: string;        // YYYYMMDD
  dateDisplay?: string;
  audiCnt?: number;
  salesAmt?: number;
  scrnCnt?: number;
  showCnt?: number;
};

type ModelForecast = {
  startMode: "ratio" | "first";
  startIndex: number;
  effectiveOpenDate: string;
  multipliers: Record<string, number>; // Mon..Sun
  decay: { slope: number; intercept: number; r2: number; residualStd: number; peakIndex: number };
  next3: number[];
  finalPred: { min: number; max: number; avg: number };
  debug: Record<string, any>;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dowNameOf = (ymd: string) => {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(4, 6), 10) - 1;
  const d = parseInt(ymd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d));
  return DOW[dt.getUTCDay()];
};

const linearRegression = (xs: number[], ys: number[]) => {
  // 최소제곱(가중치 없음)
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
};

const rSquared = (ys: number[], yhat: number[]) => {
  const n = ys.length;
  if (n < 2) return 0;
  const mean = ys.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - mean) ** 2;
    ssRes += (ys[i] - yhat[i]) ** 2;
  }
  return ssTot <= 1e-9 ? 0 : 1 - ssRes / ssTot;
};

const stdResidual = (ys: number[], yhat: number[]) => {
  const n = ys.length;
  if (n < 3) return 0;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - yhat[i]) ** 2;
  return Math.sqrt(ss / (n - 2));
};

const normalizeTrend = (trendData: any[]): TrendRow[] => {
  if (!Array.isArray(trendData)) return [];
  const rows: TrendRow[] = trendData
    .filter((d) => d && typeof d.date === "string" && d.date.length === 8)
    .map((d) => ({
      date: d.date,
      dateDisplay: d.dateDisplay,
      audiCnt: safeNum(d.audiCnt, 0),
      salesAmt: safeNum(d.salesAmt, 0),
      scrnCnt: d.scrnCnt == null ? undefined : safeNum(d.scrnCnt, 0),
      showCnt: d.showCnt == null ? undefined : safeNum(d.showCnt, 0),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // 같은 date 중복 제거(마지막 값 우선)
  const dedup: Record<string, TrendRow> = {};
  for (const r of rows) dedup[r.date] = r;
  return Object.values(dedup).sort((a, b) => (a.date < b.date ? -1 : 1));
};

const findEffectiveStartIndex = (rows: TrendRow[], mode: "ratio" | "first", ratio = 0.30) => {
  if (mode === "first") return 0;
  const scrns = rows.map((r) => r.scrnCnt ?? 0);
  const maxScrn = Math.max(...scrns, 0);
  if (maxScrn <= 0) return 0;
  const thr = Math.floor(maxScrn * ratio);
  const idx = rows.findIndex((r) => (r.scrnCnt ?? 0) >= thr);
  return idx >= 0 ? idx : 0;
};

const computeDowMultipliers = (rows: TrendRow[]) => {
  // 요일별 평균(최근 21일만 쓰면 더 안정적)
  const slice = rows.slice(-21);
  const buckets: Record<string, number[]> = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] };
  for (const r of slice) {
    const dow = dowNameOf(r.date);
    const y = safeNum(r.audiCnt, 0);
    if (y > 0) buckets[dow].push(y);
  }

  const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  // weekday baseline(월~목 평균) 없으면 전체 평균
  const weekdayPool = [...buckets.Mon, ...buckets.Tue, ...buckets.Wed, ...buckets.Thu];
  const allPool = Object.values(buckets).flat();
  const baseline = mean(weekdayPool) || mean(allPool) || 1;

  const mult: Record<string, number> = {};
  for (const k of DOW) {
    const m = mean(buckets[k]);
    mult[k] = m > 0 ? m / baseline : 1;
  }

  // 주말 데이터가 부족하면 “학습 실패” 방지용 완만한 기본값 적용
  // (너무 공격적인 2~3배 강제는 금지. 데이터가 없을 때만 ‘완충’)
  if ((buckets.Sat.length + buckets.Sun.length) < 2) {
    mult.Sat = Math.max(mult.Sat, 1.5);
    mult.Sun = Math.max(mult.Sun, 1.6);
  }

  // 지나치게 큰/작은 multiplier 제한
  for (const k of DOW) mult[k] = clamp(mult[k], 0.55, 2.8);

  return mult;
};

const fitExponentialDecayOnNormalized = (rows: TrendRow[], mult: Record<string, number>) => {
  // normalizedAudi = audiCnt / multiplier[dow]
  const norm = rows.map((r) => {
    const dow = dowNameOf(r.date);
    const y = safeNum(r.audiCnt, 0);
    return y > 0 ? y / (mult[dow] || 1) : 0;
  });

  // 피크 찾기(정규화 기준)
  let peakIndex = 0;
  for (let i = 1; i < norm.length; i++) {
    if (norm[i] > norm[peakIndex]) peakIndex = i;
  }

  // 피크 이후 구간만 적합(legs)
  const xs: number[] = [];
  const ysLog: number[] = [];
  for (let i = peakIndex; i < norm.length; i++) {
    const y = norm[i];
    if (y > 0) {
      xs.push(i - peakIndex);
      ysLog.push(Math.log(y));
    }
  }

  // 데이터 부족하면 완만한 감쇠 가정
  if (xs.length < 4) {
    return {
      slope: -0.08,
      intercept: Math.log(norm[peakIndex] || 10000),
      r2: 0,
      residualStd: 0.35,
      peakIndex,
    };
  }

  const { slope, intercept } = linearRegression(xs, ysLog);
  const yhat = xs.map((x) => intercept + slope * x);
  const r2 = rSquared(ysLog, yhat);
  const residualStd = stdResidual(ysLog, yhat);

  // slope가 양수로 나오는 경우(이상 케이스) 방지
  const safeSlope = Math.min(slope, -0.001);

  return {
    slope: safeSlope,
    intercept,
    r2,
    residualStd,
    peakIndex,
  };
};

const predictNext3 = (rows: TrendRow[], mult: Record<string, number>, decay: any) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return [0, 0, 0];

  const { slope, intercept, residualStd, peakIndex } = decay;

  // 현재가 피크 이후 몇 일인지
  const tLast = (rows.length - 1) - peakIndex;

  // 최근 실제치 기반 클램프(급등/급락 방지)
  const recent = rows.slice(-7).map((r) => safeNum(r.audiCnt, 0)).filter((v) => v > 0);
  const recentMax = recent.length ? Math.max(...recent) : 100000;
  const recentMin = recent.length ? Math.min(...recent) : 0;

  const next: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const date = addDaysUTC(lastDate, i);
    const dow = dowNameOf(date);

    // 정규화 예측(로그 공간)
    const t = tLast + i;
    const logY = intercept + slope * t;

    // 불확실성 완충(너무 자신만만한 값 방지)
    const adjLogY = logY; // avg 예측은 그대로
    const yNorm = Math.exp(adjLogY);

    // 요일 multiplier 복원
    let y = yNorm * (mult[dow] || 1);

    // 클램프(최근 추세 범위에 합리적으로)
    // 상한은 최근Max의 1.35배 정도(주말 상향 포함)
    const upper = recentMax * 1.35;
    // 하한은 최근Min의 0.55배 (0 근처로 과도 추락 방지)
    const lower = Math.max(0, recentMin * 0.55);

    y = clamp(y, lower, upper);

    next.push(Math.round(y));
  }
  return next;
};

const predictFinalRange = (rows: TrendRow[], mult: Record<string, number>, decay: any, currentAcc: number) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) {
    return { min: currentAcc, max: currentAcc, avg: currentAcc };
  }

  const { slope, intercept, residualStd, peakIndex } = decay;
  const tLast = (rows.length - 1) - peakIndex;

  // 미래 적분(최대 120일 또는 일관객 1,000 이하로 떨어질 때 종료)
  const horizon = 120;
  const stopThreshold = 1000;

  const simulate = (z: number) => {
    // z는 log-space 변동(±k*std)
    let sum = 0;
    for (let i = 1; i <= horizon; i++) {
      const date = addDaysUTC(lastDate, i);
      const dow = dowNameOf(date);
      const t = tLast + i;

      const logY = intercept + slope * t + z;
      const yNorm = Math.exp(logY);
      const y = yNorm * (mult[dow] || 1);

      const yi = Math.max(0, Math.round(y));
      sum += yi;
      if (yi < stopThreshold && i > 14) break; // 초반은 멈추지 않게(주말 스파이크 가능)
    }
    return sum;
  };

  // 불확실성 밴드(로그 공간 ±1.0*std)
  const extraAvg = simulate(0);
  const extraMin = simulate(-1.0 * (residualStd || 0.35));
  const extraMax = simulate(+1.0 * (residualStd || 0.35));

  return {
    min: Math.round(currentAcc + extraMin),
    max: Math.round(currentAcc + extraMax),
    avg: Math.round(currentAcc + extraAvg),
  };
};

const buildModelForecast = (trendData: any[], currentAudiAcc: any, startMode: "ratio" | "first" = "ratio"): ModelForecast => {
  const rowsAll = normalizeTrend(trendData);
  const startIndex = findEffectiveStartIndex(rowsAll, startMode, 0.30);
  const rows = rowsAll.slice(startIndex);

  const effectiveOpenDate = rows[0]?.date || (rowsAll[0]?.date ?? "");
  const multipliers = computeDowMultipliers(rows);
  const decay = fitExponentialDecayOnNormalized(rows, multipliers);

  const next3 = predictNext3(rows, multipliers, decay);

  const curAcc = safeNum(currentAudiAcc, 0);
  const finalPred = predictFinalRange(rows, multipliers, decay, curAcc);

  return {
    startMode,
    startIndex,
    effectiveOpenDate,
    multipliers,
    decay,
    next3,
    finalPred,
    debug: {
      rowsAll: rowsAll.length,
      rowsUsed: rows.length,
      lastDate: rows[rows.length - 1]?.date,
      last7: rows.slice(-7).map(r => ({ date: r.date, audi: r.audiCnt, scrn: r.scrnCnt })),
    }
  };
};

/** -------- handler -------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API Key Missing" });

  try {
    const {
      movieName,
      trendData,
      movieInfo,
      currentAudiAcc,
      type,
      historyData,
      productionCost,
      salesAcc,
      audiAcc,
      avgTicketPrice,
    } = req.body;

    const ai = new GoogleGenAI({ apiKey });

    // ---- (1) 코드 기반 예측(LLM 이전) ----
    const model = buildModelForecast(trendData, currentAudiAcc, "ratio");

    // 최근 추이(요일 컨텍스트 주입) – LLM이 ‘주말-평일’을 헷갈리지 않게
    const rowsForPrompt = normalizeTrend(trendData).slice(-14);
    const recentTrend = rowsForPrompt.length
      ? rowsForPrompt.map((d: any) => {
          const dayContext = getDayContext(d.date);
          return `[${d.date} ${dayContext}] Audi: ${safeNum(d.audiCnt, 0)}, Sales: ${safeNum(d.salesAmt, 0)}, Scrn: ${safeNum(d.scrnCnt, 0)}`;
        }).join("\n")
      : "No daily trend data";

    const realtimeTrend = Array.isArray(historyData) && historyData.length
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank: ${d.rank}, Rate: ${d.rate}%, Audi: ${d.val_audi}`).join("\n")
      : "No realtime data";

    // BEP
    let bepContext = "Production cost unknown.";
    if (productionCost && Number(productionCost) > 0) {
      const cost = Number(productionCost);
      const atp = Number(avgTicketPrice || 12000);
      const bepAudi = Math.round(cost / (atp * 0.4));
      const percent = bepAudi > 0 ? ((Number(audiAcc) / bepAudi) * 100).toFixed(1) : "0.0";
      bepContext = `Production Cost: ${Math.round(cost)} KRW. Avg Ticket Price: ${Math.round(atp)} KRW. BEP Target: approx ${bepAudi}. Progress: ${percent}%.`;
    }

    const openDate = (movieInfo?.openDt || "").toString();
    const todayKST = getKST_YYYYMMDD();
    const nowKST = new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" });

    // 다음 3일 요일 컨텍스트(LLM이 ‘내일이 토요일’ 같은 실수 방지)
    const lastDate = model.debug?.lastDate || todayKST;
    const next3Dates = [1,2,3].map(i => addDaysUTC(lastDate, i));
    const next3Context = next3Dates.map(d => `${d} ${getDayContext(d)}`).join(" | ");

    // ---- (2) LLM은 ‘보고서/보정’만 ----
    const prompt = `
Role: Elite Box Office Quant + Senior Data Scientist.

Target Movie: "${movieName}"
Open Date (KOBIS): ${openDate} (YYYYMMDD)
Today (KST): ${todayKST}
Now (KST): ${nowKST}

Current Status:
- Current Total Audience (audiAcc): ${safeNum(currentAudiAcc, 0)}
- Financial Context: ${bepContext}

Daily Trend (recent 14 days, with DOW context):
${recentTrend}

Realtime Trend (recent 10 points):
${realtimeTrend}

MODEL SIGNALS (computed in code; do NOT contradict these without explicit reason):
- Effective Open Date (auto-detected): ${model.effectiveOpenDate}
- DOW Multipliers (learned): ${JSON.stringify(model.multipliers)}
- Decay Fit (normalized legs): slope=${model.decay.slope.toFixed(4)}, r2=${model.decay.r2.toFixed(3)}, residualStd(log)=${model.decay.residualStd.toFixed(3)}
- Next 3 days context: ${next3Context}
- Base Forecast Next3 (AUDI): ${JSON.stringify(model.next3)}
- Base Final Audience Range: ${JSON.stringify(model.finalPred)}

TASK:
1) Release Status:
   - If Open Date > Today: treat as UNRELEASED. Focus on pre-release signal & reservation momentum.
   - Else: treat as RELEASED. Analyze momentum with weekday/weekend seasonality.

2) Forecast:
   - Use Base Forecast Next3 as anchor.
   - You may adjust but keep each day within ±25% unless you cite a concrete reason from input data (e.g., sudden scrn collapse, rank shock).

3) Final Prediction:
   - Use Base Final Audience Range as anchor.
   - You may widen/narrow but keep realistic (avoid fantasy jumps).

4) Report:
   - Write 3 short paragraphs in Korean with emojis.
   - Must reference: (a) at least 2 concrete numbers from data, (b) weekday/weekend effect, (c) 1 strategic suggestion.

Output STRICT JSON only:
{
  "analysis": "Korean string",
  "forecast": [Number, Number, Number],
  "keywords": ["String", "String"],
  "predictedFinalAudi": { "min": Number, "max": Number, "avg": Number }
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
        topP: 0.9
      }
    });

    let text = "{}";
    if (response?.candidates?.length) {
      text = response.candidates[0]?.content?.parts?.[0]?.text || "{}";
    }

    let result: any;
    try {
      result = JSON.parse(cleanJsonString(text));
    } catch {
      result = null;
    }

    // ---- (3) 실패 시 폴백(코드 예측으로 보장) ----
    const fallbackAnalysis =
      `📌 현재 누적 관객은 ${safeNum(currentAudiAcc, 0).toLocaleString()}명입니다.\n` +
      `📈 모델 기준 다음 3일 예측 관객은 ${model.next3.map(n => n.toLocaleString()).join(" / ")}명이며, ` +
      `요일·주말 효과를 학습한 감쇠(legs) 모델로 계산했습니다.\n` +
      `🎯 최종 관객수는 ${model.finalPred.min.toLocaleString()}~${model.finalPred.max.toLocaleString()}명(중앙 ${model.finalPred.avg.toLocaleString()}명) 범위로 추정됩니다.`;

    const analysis = result?.analysis || fallbackAnalysis;
    const forecast = Array.isArray(result?.forecast) && result.forecast.length === 3
      ? result.forecast.map((x: any, i: number) => Math.round(clamp(safeNum(x, model.next3[i]), model.next3[i]*0.75, model.next3[i]*1.25)))
      : model.next3;

    const predictedFinalAudi = result?.predictedFinalAudi?.avg
      ? {
          min: Math.round(safeNum(result.predictedFinalAudi.min, model.finalPred.min)),
          max: Math.round(safeNum(result.predictedFinalAudi.max, model.finalPred.max)),
          avg: Math.round(safeNum(result.predictedFinalAudi.avg, model.finalPred.avg)),
        }
      : model.finalPred;

    const keywords = Array.isArray(result?.keywords) && result.keywords.length
      ? result.keywords.slice(0, 2)
      : [movieName, "박스오피스"];

    return res.status(200).json({
      analysisText: analysis,
      predictionSeries: forecast,
      searchKeywords: keywords,
      predictedFinalAudi,
      // 디버그가 필요하면 아래를 프론트에서 꺼내 볼 수 있게 유지
      modelSignals: {
        effectiveOpenDate: model.effectiveOpenDate,
        multipliers: model.multipliers,
        decay: model.decay,
        baseForecast: model.next3,
        baseFinal: model.finalPred,
      }
    });

  } catch (error: any) {
    console.error("AI Error:", error);
    return res.status(200).json({
      analysisText: `오류: ${error?.message || "unknown"}`,
      predictionSeries: [0, 0, 0],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 }
    });
  }
}
