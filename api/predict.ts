import { GoogleGenAI } from "@google/genai";

/** -------- utils -------- */
const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/gi, "").replace(/```/g, "").trim();
};

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
  daySinceRelease: number;
  horizon: number;
  multipliers: Record<string, number>;
  decay: {
    slope: number;
    intercept: number;
    r2: number;
    residualStd: number;
    fitWindow: number;
    fitStartIndex: number;
  };
  caps: {
    maxWeekend: number;
    maxWeekday: number;
    medWeekend: number;
    medWeekday: number;
    screenTrend: number;
  };
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

const isWeekend = (ymd: string) => {
  const d = dowNameOf(ymd);
  return d === "Sat" || d === "Sun";
};

const daysBetweenUTC = (ymdA: string, ymdB: string) => {
  // B - A (days)
  if (!ymdA || !ymdB || ymdA.length !== 8 || ymdB.length !== 8) return 0;
  const ya = parseInt(ymdA.slice(0, 4), 10);
  const ma = parseInt(ymdA.slice(4, 6), 10) - 1;
  const da = parseInt(ymdA.slice(6, 8), 10);
  const yb = parseInt(ymdB.slice(0, 4), 10);
  const mb = parseInt(ymdB.slice(4, 6), 10) - 1;
  const db = parseInt(ymdB.slice(6, 8), 10);
  const A = Date.UTC(ya, ma, da);
  const B = Date.UTC(yb, mb, db);
  return Math.round((B - A) / (1000 * 60 * 60 * 24));
};

/** -------- basic stats -------- */
const linearRegression = (xs: number[], ys: number[]) => {
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

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** -------- trend prep -------- */
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

  // dedup by date (keep last)
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

/** -------- DOW multipliers (robust) -------- */
const computeDowMultipliersRobust = (rows: TrendRow[]) => {
  const slice = rows.slice(-28); // 더 안정적으로
  const buckets: Record<string, number[]> = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] };

  for (const r of slice) {
    const dow = dowNameOf(r.date);
    const y = safeNum(r.audiCnt, 0);
    if (y > 0) buckets[dow].push(y);
  }

  // 평균 대신 중앙값 기반(연휴/이상치 저항)
  const basePool = [...buckets.Mon, ...buckets.Tue, ...buckets.Wed, ...buckets.Thu];
  const allPool = Object.values(buckets).flat();
  const baseline = median(basePool) || median(allPool) || 1;

  const mult: Record<string, number> = {};
  for (const k of DOW) {
    const m = median(buckets[k]);
    mult[k] = m > 0 ? m / baseline : 1;
  }

  // 주말 데이터가 거의 없으면 완충
  if ((buckets.Sat.length + buckets.Sun.length) < 2) {
    mult.Sat = Math.max(mult.Sat, 1.45);
    mult.Sun = Math.max(mult.Sun, 1.55);
  }

  // 과도한 배수 방지
  for (const k of DOW) mult[k] = clamp(mult[k], 0.60, 2.60);
  return mult;
};

/** -------- caps (weekend/weekday + screen trend) -------- */
const computeTypeCaps = (rows: TrendRow[]) => {
  const slice = rows.slice(-28);

  const weekend = slice
    .filter((r) => safeNum(r.audiCnt, 0) > 0 && isWeekend(r.date))
    .map((r) => safeNum(r.audiCnt, 0));

  const weekday = slice
    .filter((r) => safeNum(r.audiCnt, 0) > 0 && !isWeekend(r.date))
    .map((r) => safeNum(r.audiCnt, 0));

  const maxWeekend = weekend.length ? Math.max(...weekend) : 0;
  const maxWeekday = weekday.length ? Math.max(...weekday) : 0;
  const medWeekend = median(weekend);
  const medWeekday = median(weekday);

  const scrnA = rows.slice(-14, -7).map(r => safeNum(r.scrnCnt, 0)).filter(v => v > 0);
  const scrnB = rows.slice(-7).map(r => safeNum(r.scrnCnt, 0)).filter(v => v > 0);
  const scrnMedA = median(scrnA) || median(rows.map(r => safeNum(r.scrnCnt, 0)).filter(v => v > 0)) || 1;
  const scrnMedB = median(scrnB) || scrnMedA;
  const screenTrend = clamp(scrnMedB / scrnMedA, 0.65, 1.20);

  return { maxWeekend, maxWeekday, medWeekend, medWeekday, screenTrend };
};

/** -------- robust decay V2 (recent window + weekly slope blend + slope floor) -------- */
const robustLogLinearFit = (xs: number[], ysLog: number[]) => {
  if (xs.length < 4) {
    return { slope: -0.08, intercept: ysLog[0] ?? Math.log(10000), r2: 0, residualStd: 0.35 };
  }

  const fitOnce = (X: number[], Y: number[]) => {
    const { slope, intercept } = linearRegression(X, Y);
    const yhat = X.map((x) => intercept + slope * x);
    return {
      slope,
      intercept,
      yhat,
      r2: rSquared(Y, yhat),
      residualStd: stdResidual(Y, yhat) || 0.35,
      resid: Y.map((y, i) => y - yhat[i]),
    };
  };

  const first = fitOnce(xs, ysLog);

  // MAD 기반 outlier 제거
  const absResid = first.resid.map((r) => Math.abs(r));
  const mad = median(absResid) || 0.0001;
  const thr = 2.8 * mad;

  const keep: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(first.resid[i]) <= thr) keep.push(i);
  }
  if (keep.length < 4) return first;

  const X2 = keep.map((i) => xs[i]);
  const Y2 = keep.map((i) => ysLog[i]);
  return fitOnce(X2, Y2);
};

const estimateWeeklySlope = (norm: number[]) => {
  // slope ≈ ln(최근7합 / 직전7합) / 7
  if (norm.length < 14) return null;
  const a = norm.slice(-7).reduce((s, v) => s + v, 0);
  const b = norm.slice(-14, -7).reduce((s, v) => s + v, 0);
  if (a <= 0 || b <= 0) return null;
  const r = a / b;
  return Math.log(r) / 7;
};

const fitDecayV2 = (rows: TrendRow[], mult: Record<string, number>) => {
  const normAll = rows.map((r) => {
    const y = safeNum(r.audiCnt, 0);
    const m = mult[dowNameOf(r.date)] || 1;
    return y > 0 ? y / m : 0;
  });

  // 최근 21일(없으면 14일) 중심 적합
  const win = Math.min(normAll.length, normAll.length >= 21 ? 21 : 14);
  const start = Math.max(0, normAll.length - win);
  const norm = normAll.slice(start);

  const xs: number[] = [];
  const ysLog: number[] = [];
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] > 0) {
      xs.push(i);
      ysLog.push(Math.log(norm[i]));
    }
  }

  const fit = robustLogLinearFit(xs, ysLog);
  const wkSlope = estimateWeeklySlope(normAll);

  // slope 혼합
  let slope = fit.slope;
  if (wkSlope != null && Number.isFinite(wkSlope)) {
    slope = 0.6 * slope + 0.4 * wkSlope;
  }

  // ✅ 과장 예측 방지 핵심: slope가 너무 완만하면 꼬리 과대 → 강제 교정
  slope = Math.min(slope, -0.001);
  if (slope > -0.02) slope = -0.035;

  // 너무 가파르면 과소예측 → 제한
  slope = clamp(slope, -0.25, -0.02);

  return {
    slope,
    intercept: fit.intercept,
    r2: fit.r2,
    residualStd: fit.residualStd || 0.35,
    fitWindow: win,
    fitStartIndex: start,
    normAll,
  };
};

/** -------- next3 V2 (caps by type + screen trend + clamp) -------- */
const predictNext3V2 = (rows: TrendRow[], mult: Record<string, number>, decay: any, caps: any) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return [0, 0, 0];

  const normAll = decay.normAll as number[];
  const tLast = normAll.length - 1;

  // 최근 실제값 기반 보조 범위
  const recent = rows.slice(-14).map((r) => safeNum(r.audiCnt, 0)).filter((v) => v > 0);
  const recentMax = recent.length ? Math.max(...recent) : 100000;
  const recentMin = recent.length ? Math.min(...recent) : 0;

  const next: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const date = addDaysUTC(lastDate, i);
    const dow = dowNameOf(date);

    // 정규화 예측(로그-선형)
    const logY = decay.intercept + decay.slope * (tLast - (decay.fitStartIndex || 0) + i);
    const yNorm = Math.exp(logY);

    // 요일 multiplier 복원 + 스크린 트렌드 반영(스크린 감소 시 과장 방지)
    let y = yNorm * (mult[dow] || 1) * (caps.screenTrend || 1);

    // 타입(주말/평일) 기반 상한/하한
    const weekend = isWeekend(date);
    const typeMax = weekend ? caps.maxWeekend : caps.maxWeekday;
    const typeMed = weekend ? caps.medWeekend : caps.medWeekday;

    // 상한: 타입Max 기반 + 최근Max 기반 중 더 보수적으로
    const upper1 = typeMax > 0 ? typeMax * (weekend ? 1.15 : 1.10) : recentMax * 1.20;
    const upper2 = recentMax * 1.20;
    const upper = Math.min(upper1, upper2);

    // 하한: 타입Median 기반, 너무 낮게 붕괴하는 과소도 방지
    const lower = Math.max(0, (typeMed > 0 ? typeMed * 0.60 : recentMin * 0.55));

    y = clamp(y, lower, upper);
    next.push(Math.round(y));
  }

  return next;
};

/** -------- final range V2 (finite horizon + tail extra decay + remaining cap) -------- */
const predictFinalRangeV2 = (rows: TrendRow[], mult: Record<string, number>, decay: any, caps: any, currentAcc: number, daySinceRelease: number, horizon: number) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return { min: currentAcc, max: currentAcc, avg: currentAcc };

  const normAll = decay.normAll as number[];
  const tLast = normAll.length - 1;

  const stopThreshold = 800;            // 더 보수적으로
  const stopAfterDays = 14;             // 최소 2주 관측 뒤부터 종료 허용
  const tailBoostStart = 21;            // 꼬리 구간 추가 감쇠 시작
  const tailSlopeBoost = 1.15;          // 꼬리 slope 가속(과장 방지)

  // remaining cap: 개봉 후 경과일이 길수록 남은 관객이 누적 대비 과도해지면 안 됨
  let remainingFactor: number;
  if (daySinceRelease >= 60) remainingFactor = 0.25;
  else if (daySinceRelease >= 28) remainingFactor = 0.55;
  else if (daySinceRelease >= 14) remainingFactor = 0.95;
  else remainingFactor = 2.50; // 초반은 캡을 느슨하게(대신 다른 캡으로 과장 방지)

  // 스크린 하락이면 remaining도 더 보수적으로
  remainingFactor *= clamp(caps.screenTrend || 1, 0.75, 1.10);
  remainingFactor = clamp(remainingFactor, 0.15, 2.50);

  const remainingCap = currentAcc * remainingFactor;

  const simulate = (zLog: number) => {
    let sum = 0;
    let belowCount = 0;

    for (let i = 1; i <= horizon; i++) {
      const date = addDaysUTC(lastDate, i);
      const dow = dowNameOf(date);

      // tail 추가 감쇠
      const tailBoost = (i > tailBoostStart) ? tailSlopeBoost : 1.0;
      const slopeEff = decay.slope * tailBoost;

      const logY = decay.intercept + slopeEff * (tLast - (decay.fitStartIndex || 0) + i) + zLog;
      const yNorm = Math.exp(logY);
      const y = yNorm * (mult[dow] || 1) * (caps.screenTrend || 1);

      const yi = Math.max(0, Math.round(y));
      sum += yi;

      if (yi < stopThreshold && i > stopAfterDays) belowCount += 1;
      else belowCount = 0;

      // 연속으로 낮으면 종료(현실적 상영 종료 반영)
      if (belowCount >= 7) break;

      // 남은 관객이 캡을 넘으면 더 이상 적분하지 않음(과장 방지)
      if (sum >= remainingCap) {
        sum = remainingCap;
        break;
      }
    }

    return sum;
  };

  const std = decay.residualStd || 0.35;

  const extraAvg = simulate(0);
  const extraMin = simulate(-1.0 * std);
  const extraMax = simulate(+1.0 * std);

  const avg = Math.round(currentAcc + extraAvg);
  const min = Math.round(currentAcc + extraMin);
  const max = Math.round(currentAcc + extraMax);

  // 최종 sanity: 항상 현재 누적 이상, 그리고 max는 avg보다 충분히 크되 과도하지 않게
  return {
    min: Math.max(min, currentAcc),
    max: Math.max(max, avg),
    avg: Math.max(avg, currentAcc),
  };
};

/** -------- build model V2 -------- */
const buildModelForecastV2 = (trendData: any[], currentAudiAcc: any, startMode: "ratio" | "first" = "ratio"): ModelForecast => {
  const rowsAll = normalizeTrend(trendData);
  const startIndex = findEffectiveStartIndex(rowsAll, startMode, 0.30);
  const rows = rowsAll.slice(startIndex);

  const effectiveOpenDate = rows[0]?.date || (rowsAll[0]?.date ?? "");
  const lastDate = rows[rows.length - 1]?.date || effectiveOpenDate;

  const daySinceRelease = Math.max(0, daysBetweenUTC(effectiveOpenDate, lastDate));

  // ✅ “개봉일이 무한하지 않다” 반영: 경과일이 길수록 horizon 축소
  // 예) day 0~: 90, day 60~: 60, day 100~: 21 (최소 21일은 남겨 tail 관측)
  const horizon = Math.round(clamp(120 - daySinceRelease, 21, 90));

  const multipliers = computeDowMultipliersRobust(rows);
  const caps = computeTypeCaps(rows);
  const decay = fitDecayV2(rows, multipliers);

  const next3 = predictNext3V2(rows, multipliers, decay, caps);

  const curAcc = safeNum(currentAudiAcc, 0);
  const finalPred = predictFinalRangeV2(rows, multipliers, decay, caps, curAcc, daySinceRelease, horizon);

  return {
    startMode,
    startIndex,
    effectiveOpenDate,
    daySinceRelease,
    horizon,
    multipliers,
    decay: {
      slope: decay.slope,
      intercept: decay.intercept,
      r2: decay.r2,
      residualStd: decay.residualStd,
      fitWindow: decay.fitWindow,
      fitStartIndex: decay.fitStartIndex,
    },
    caps,
    next3,
    finalPred,
    debug: {
      rowsAll: rowsAll.length,
      rowsUsed: rows.length,
      lastDate,
      last7: rows.slice(-7).map((r) => ({ date: r.date, audi: r.audiCnt, scrn: r.scrnCnt })),
    },
  };
};

/** -------- (OPTION) filmography enrichment hook --------
 *  - 실제로 감독/배우 필모를 "근거 있게" 비교하려면 여기에서 KOBIS people API를 붙이면 됩니다.
 *  - 지금은 안전하게 '추가 데이터가 없으면 단정하지 말라'는 프롬프트 가드로 처리합니다.
 */
// const fetchPeopleContext = async (...) => { ... }

/** -------- handler -------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API Key Missing" });

  try {
    const {
      movieName, trendData, movieInfo, currentAudiAcc, type, historyData,
      productionCost, salesAcc, audiAcc, avgTicketPrice,
    } = req.body;

    const ai = new GoogleGenAI({ apiKey });

    // ✅ V2 모델 예측(과장 방지 강화)
    const model = buildModelForecastV2(trendData, currentAudiAcc, "ratio");

    // LLM용 데이터 준비
    const rowsForPrompt = normalizeTrend(trendData).slice(-14);
    const recentTrend = rowsForPrompt.length
      ? rowsForPrompt.map((d: any) => {
          const dayContext = getDayContext(d.date);
          return `[${d.date} ${dayContext}] Audi: ${safeNum(d.audiCnt, 0)}, Sales: ${safeNum(d.salesAmt, 0)}, Scrn: ${safeNum(d.scrnCnt, 0)}, Show: ${safeNum(d.showCnt, 0)}`;
        }).join("\n")
      : "No daily trend data";

    const realtimeTrend = Array.isArray(historyData) && historyData.length
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank: ${d.rank}, Rate: ${d.rate}%, Audi: ${d.val_audi}`).join("\n")
      : "No realtime data";

    // 감독/배우
    const directors = movieInfo?.directors?.map((d: any) => d.peopleNm).join(", ") || "Unknown Director";
    const actors = movieInfo?.actors?.slice(0, 5).map((a: any) => a.peopleNm).join(", ") || "Unknown Actors";

    // BEP
    let bepContext = "Production cost unknown.";
    if (productionCost && Number(productionCost) > 0) {
      const cost = Number(productionCost);
      const atp = Number(avgTicketPrice || 12000);
      const bepAudi = Math.round(cost / (atp * 0.4));
      const percent = bepAudi > 0 ? ((Number(audiAcc) / bepAudi) * 100).toFixed(1) : "0.0";
      bepContext = `Production Cost: ${Math.round(cost)} KRW. Avg Ticket Price: ${Math.round(atp)} KRW. BEP Target: approx ${bepAudi}. Progress: ${percent}%.`;
    }

    const openDateKobis = (movieInfo?.openDt || "").toString();
    const todayKST = getKST_YYYYMMDD();
    const nowKST = new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" });

    // 다음 3일 컨텍스트
    const lastDate = model.debug?.lastDate || todayKST;
    const next3Dates = [1, 2, 3].map((i) => addDaysUTC(lastDate, i));
    const next3Context = next3Dates.map((d) => `${d} ${getDayContext(d)}`).join(" | ");

    // ✅ 개봉 여부 판단(빈 openDt면 effectiveOpenDate 사용)
    const openDate = (openDateKobis && openDateKobis.length === 8) ? openDateKobis : model.effectiveOpenDate;
    const isUnreleased = openDate && openDate.length === 8 ? (openDate > todayKST) : false;

    const prompt = `
Role: Elite Box Office Quant + Senior Data Scientist (Korea Market).

Target Movie: "${movieName}"
Key People:
- Director: ${directors}
- Cast(Top5): ${actors}

Open Date (KOBIS or inferred): ${openDate} (YYYYMMDD)
Today (KST): ${todayKST}
Now (KST): ${nowKST}

Current Status:
- Current Total Audience (audiAcc): ${safeNum(currentAudiAcc, 0)}
- Financial Context: ${bepContext}

Daily Trend (recent 14 days, with DOW context):
${recentTrend}

Realtime Trend (recent 10 points):
${realtimeTrend}

MODEL SIGNALS (computed in code; treat as hard constraints unless you cite a concrete reason from input data):
- Release Status: ${isUnreleased ? "UNRELEASED" : "RELEASED"}
- Effective Open Date (auto): ${model.effectiveOpenDate}
- Days Since Release (based on data): ${model.daySinceRelease} days
- Forecast Horizon is finite: ${model.horizon} days max remaining integration
- DOW Multipliers (robust, median-based): ${JSON.stringify(model.multipliers)}
- Screen Trend (recent vs prior week): ${(model.caps.screenTrend || 1).toFixed(3)}
- Decay Fit (recent-window + weekly-drop blend): slope=${model.decay.slope.toFixed(4)}, r2=${model.decay.r2.toFixed(3)}, residualStd(log)=${model.decay.residualStd.toFixed(3)}
- Next 3 days context: ${next3Context}
- Base Forecast Next3 (AUDI): ${JSON.stringify(model.next3)}
- Base Final Audience Range: ${JSON.stringify(model.finalPred)}

IMPORTANT GUARDRAILS:
- Do NOT invent filmography facts. If you cannot confidently compare director/actors past works, say so explicitly and analyze their influence only in general terms (star power, genre fit, buzz).
- Forecast must stay conservative: each of 3-day forecasts should remain within ±20% of Base Forecast unless you cite a reason from trendData (e.g., sudden screen collapse, steep rank shock).
- Predicted final audience must be within the Base Final Audience Range unless you justify with trendData evidence.

TASK:
1) Write 3 short paragraphs in Korean with emojis.
   - Para 1: Momentum (use 2+ concrete numbers + weekday/weekend effect).
   - Para 2: People Analysis (director/actor influence; avoid hallucinating filmography).
   - Para 3: Strategy & Final Prediction (include min/max/avg).

2) Output STRICT JSON:
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
        temperature: 0.15,
        topP: 0.9
      }
    });

    let text = "{}";
    if (response?.candidates?.length) {
      text = response.candidates[0]?.content?.parts?.[0]?.text || "{}";
    }

    let result: any;
    try { result = JSON.parse(cleanJsonString(text)); } catch { result = null; }

    // 폴백(LLM이 깨져도 과장 없는 모델 출력 보장)
    const fallbackAnalysis =
      `📌 현재 누적 관객은 ${safeNum(currentAudiAcc, 0).toLocaleString()}명입니다.\n` +
      `📈 (보정 모델 V2) 다음 3일 예측은 ${model.next3.map(n => n.toLocaleString()).join(" / ")}명이며, 요일·주말 효과 + 스크린 변화 + 최근 드롭률로 과장을 억제했습니다.\n` +
      `🎯 최종 관객수는 ${model.finalPred.min.toLocaleString()}~${model.finalPred.max.toLocaleString()}명(중앙 ${model.finalPred.avg.toLocaleString()}명) 범위로 추정됩니다.`;

    const analysis = result?.analysis || fallbackAnalysis;

    // forecast clamp: base 대비 ±20% (더 보수적으로)
    const forecast = Array.isArray(result?.forecast) && result.forecast.length === 3
      ? result.forecast.map((x: any, i: number) =>
          Math.round(clamp(
            safeNum(x, model.next3[i]),
            model.next3[i] * 0.80,
            model.next3[i] * 1.20
          ))
        )
      : model.next3;

    // final clamp: 기본 범위 밖으로 못 나가게(근거 없는 과장 방지)
    const baseMin = model.finalPred.min;
    const baseMax = model.finalPred.max;
    const baseAvg = model.finalPred.avg;

    const predictedFinalAudi = result?.predictedFinalAudi?.avg
      ? {
          min: Math.round(clamp(safeNum(result.predictedFinalAudi.min, baseMin), baseMin, baseMax)),
          max: Math.round(clamp(safeNum(result.predictedFinalAudi.max, baseMax), baseMin, baseMax)),
          avg: Math.round(clamp(safeNum(result.predictedFinalAudi.avg, baseAvg), baseMin, baseMax)),
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
      modelSignals: {
        effectiveOpenDate: model.effectiveOpenDate,
        daySinceRelease: model.daySinceRelease,
        horizon: model.horizon,
        multipliers: model.multipliers,
        screenTrend: model.caps.screenTrend,
        decay: model.decay,
        caps: model.caps,
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
