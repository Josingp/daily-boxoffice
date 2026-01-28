import { GoogleGenAI } from "@google/genai";

/** =========================================================
 * CONFIG
 * ========================================================= */
const CFG = {
  USE_LLM_DEFAULT: true,

  // LLM이 숫자를 바꾸더라도 이 범위 밖으로 못 나가게 강제
  LLM_ADJUST: { lo: 0.78, hi: 1.22, temperature: 0.12, topP: 0.9 },

  // 개봉 전(예매 기반) 가정
  ASSUMED_RESERVED_MARKET: { weekday: 420_000, weekend: 600_000 },
  OPENING_CAP: { min: 40_000, max: 3_200_000 },
  
  // 평균 상영 기간 (보수적 판단 기준점)
  AVG_RUN_DAYS: 60,

  // 개봉 전: legs prior (최종 / 오프닝3일)
  LEGS_PRIOR: {
    horror: { min: 2.0, avg: 2.6, max: 3.4 },
    animation: { min: 4.0, avg: 5.8, max: 8.2 },
    drama: { min: 3.2, avg: 4.7, max: 6.6 },
    action: { min: 2.9, avg: 4.1, max: 6.0 },
    default: { min: 3.0, avg: 4.4, max: 6.6 },
  },

  // 개봉 전: 현장수요(walk-up) 계수
  WALKUP: {
    weekdayBase: 0.95,
    weekendBase: 1.20,
    momentumAdjScale: 0.22,
    clamp: { lo: 0.55, hi: 1.65 },
  },

  // DOW priors (데이터 부족 시)
  DOW_PRIOR: { Mon: 1.0, Tue: 1.0, Wed: 1.03, Thu: 1.09, Fri: 1.33, Sat: 1.92, Sun: 1.70 },

  // Released: daySince 구간별 "상승 허용치"
  LOCKS: {
    phaseCapFactor(daySince: number, weekend: boolean) {
      if (daySince < 7) return weekend ? 2.4 : 1.8;
      if (daySince < 14) return weekend ? 1.9 : 1.5;
      if (daySince < 28) return weekend ? 1.55 : 1.25;
      if (daySince < 60) return weekend ? 1.35 : 1.15;
      return weekend ? 1.22 : 1.10;
    },
    growthCap(daySince: number, weekend: boolean) {
      if (daySince < 7) return weekend ? 2.2 : 1.7;
      if (daySince < 14) return weekend ? 1.8 : 1.45;
      if (daySince < 28) return weekend ? 1.55 : 1.25;
      return weekend ? 1.35 : 1.15;
    },
  },

  // Released: tail(잔여 관객) 유한성 캡
  REMAINING_CAP: {
    byAccFactor(daySince: number) {
      if (daySince < 7) return 18.0;
      if (daySince < 14) return 13.0;
      if (daySince < 28) return 7.0;
      if (daySince < 60) return 3.0;
      return 1.1;
    },
    byRunRateWeeks(daySince: number) {
      if (daySince < 7) return 24;
      if (daySince < 14) return 18;
      if (daySince < 28) return 13;
      if (daySince < 60) return 10;
      return 6;
    },
  },

  // Bass 폭주 방지: m(잠재시장) 상한 = 누적 × 배수
  BASS_M_CAP(daySince: number) {
    if (daySince < 7) return 40;
    if (daySince < 14) return 20;
    return 10;
  },

  // 앙상블 가중치(단순/안정형) – 백캐스트로 흔들지 않음
  WEIGHTS(daySince: number, bassOk: boolean) {
    // early: 구조모델+칼만 중심, bass는 약하게
    if (daySince < 7) return bassOk ? [0.55, 0.10, 0.35] : [0.62, 0.00, 0.38];
    // mid: bass 약간 증가
    if (daySince < 21) return bassOk ? [0.55, 0.15, 0.30] : [0.65, 0.00, 0.35];
    // late: tail은 구조모델/칼만 중심
    return bassOk ? [0.60, 0.10, 0.30] : [0.68, 0.00, 0.32];
  },
} as const;

/** =========================================================
 * utils
 * ========================================================= */
const cleanJsonString = (str: string) => (str || "{}").replace(/```json/gi, "").replace(/```/g, "").trim();
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const safeNum = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const percentile = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (s.length - 1) * clamp(p, 0, 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
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

const daysBetweenUTC = (ymdA: string, ymdB: string) => {
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

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type DowName = (typeof DOW)[number];

const dowNameOf = (ymd: string): DowName => {
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

const getDayContext = (ymd: string) => {
  if (!ymd || ymd.length !== 8) return "";
  const dn = dowNameOf(ymd);
  return `(${dn}, ${dn === "Sat" || dn === "Sun" ? "Weekend" : "Weekday"})`;
};

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
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - yhat[i]) ** 2;
  }
  return ssTot <= 1e-9 ? 0 : 1 - ssRes / ssTot;
};

const stdResidual = (ys: number[], yhat: number[]) => {
  const n = ys.length;
  if (n < 3) return 0.35;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - yhat[i]) ** 2;
  return Math.sqrt(ss / (n - 2)) || 0.35;
};

/** =========================================================
 * data normalization
 * ========================================================= */
type TrendRow = {
  date: string;
  dateDisplay?: string;
  audiCnt?: number;
  salesAmt?: number;
  scrnCnt?: number;
  showCnt?: number;
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

  const dedup: Record<string, TrendRow> = {};
  for (const r of rows) dedup[r.date] = r;
  return Object.values(dedup).sort((a, b) => (a.date < b.date ? -1 : 1));
};

const fillMissingDates = (rows: TrendRow[]) => {
  if (rows.length < 2) return rows;
  const out: TrendRow[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    out.push(rows[i]);
    const cur = rows[i].date;
    const nxt = rows[i + 1].date;
    const gap = daysBetweenUTC(cur, nxt);
    if (gap > 1) {
      for (let k = 1; k < gap; k++) {
        const d = addDaysUTC(cur, k);
        out.push({ date: d, audiCnt: 0, salesAmt: 0, scrnCnt: rows[i].scrnCnt, showCnt: rows[i].showCnt });
      }
    }
  }
  out.push(rows[rows.length - 1]);
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
};

const findEffectiveStartIndex = (rows: TrendRow[], ratio = 0.30) => {
  const scrns = rows.map((r) => r.scrnCnt ?? 0);
  const maxScrn = Math.max(...scrns, 0);
  if (maxScrn <= 0) return 0;
  const thr = Math.floor(maxScrn * ratio);
  const idx = rows.findIndex((r) => (r.scrnCnt ?? 0) >= thr);
  return idx >= 0 ? idx : 0;
};

/** =========================================================
 * DOW multipliers
 * ========================================================= */
const computeDowMultipliers = (rows: TrendRow[]) => {
  const slice = rows.slice(-28);
  const buckets: Record<DowName, number[]> = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] };

  for (const r of slice) {
    const y = safeNum(r.audiCnt, 0);
    if (y <= 0) continue;
    buckets[dowNameOf(r.date)].push(y);
  }

  const basePool = [...buckets.Mon, ...buckets.Tue, ...buckets.Wed, ...buckets.Thu];
  const allPool = Object.values(buckets).flat();
  const baseline = median(basePool) || median(allPool) || 1;

  const mult: Record<DowName, number> = { Sun: 1, Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1, Sat: 1 };
  for (const k of DOW) {
    const dataMed = median(buckets[k]);
    const dataMult = dataMed > 0 ? dataMed / baseline : 1;
    const prior = (CFG.DOW_PRIOR as any)[k] ?? 1;

    // 데이터가 적으면 prior 쪽으로 더 끌림
    const w = clamp(buckets[k].length / 4, 0, 1);
    mult[k] = clamp(w * dataMult + (1 - w) * prior, 0.60, 2.80);
  }

  // 주말 데이터 부족 시 최소 보정
  if ((buckets.Sat.length + buckets.Sun.length) < 2) {
    mult.Sat = Math.max(mult.Sat, 1.45);
    mult.Sun = Math.max(mult.Sun, 1.55);
  }

  return mult;
};

const deSeasonalize = (rows: TrendRow[], mult: Record<DowName, number>) => {
  return rows.map((r) => {
    const y = safeNum(r.audiCnt, 0);
    const m = mult[dowNameOf(r.date)] || 1;
    return y > 0 ? y / m : 0;
  });
};

/** =========================================================
 * Model A: Screen × APS (structural)
 * ========================================================= */
const computeApsSeries = (rows: TrendRow[]) => {
  return rows.map((r) => {
    const audi = safeNum(r.audiCnt, 0);
    const scrn = safeNum(r.scrnCnt, 0);
    if (audi <= 0) return 0;
    if (scrn > 0) return audi / scrn;
    return audi;
  });
};

const computeScreenTrend = (rows: TrendRow[]) => {
  const A = rows.slice(-14, -7).map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0);
  const B = rows.slice(-7).map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0);
  const medA = median(A) || median(rows.map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0)) || 1;
  const medB = median(B) || medA;
  return clamp(medB / medA, 0.58, 1.55);
};

const fitApsDecay_LogLinear = (rows: TrendRow[], mult: Record<DowName, number>) => {
  const aps = computeApsSeries(rows);
  const apsNorm = rows.map((r, i) => {
    const m = mult[dowNameOf(r.date)] || 1;
    return aps[i] > 0 ? aps[i] / m : 0;
  });

  const win = Math.min(apsNorm.length, apsNorm.length >= 21 ? 21 : 14);
  const start = Math.max(0, apsNorm.length - win);
  const recent = apsNorm.slice(start);

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i] > 0) {
      xs.push(i);
      ys.push(Math.log(recent[i]));
    }
  }

  if (xs.length < 4) {
    const base = Math.log(recent.find((v) => v > 0) || 120);
    return { slope: -0.03, intercept: base, r2: 0, residualStd: 0.35, fitStartIndex: start };
  }

  const { slope, intercept } = linearRegression(xs, ys);
  const yhat = xs.map((x) => intercept + slope * x);
  const r2 = rSquared(ys, yhat);
  const residualStd = stdResidual(ys, yhat);

  const safeSlope = clamp(slope, -0.20, -0.001);
  return { slope: safeSlope, intercept, r2, residualStd, fitStartIndex: start };
};

const predictNext3_ScreenAPS = (
  rows: TrendRow[],
  mult: Record<DowName, number>,
  apsDecay: any,
  screenTrend: number
) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return [0, 0, 0];

  const apsRaw = computeApsSeries(rows).slice(-21).filter((v) => v > 0);
  const aps95 = percentile(apsRaw, 0.95) || (apsRaw.length ? Math.max(...apsRaw) : 0);

  const scrnLast = safeNum(rows[rows.length - 1].scrnCnt, 0);
  const scrnBase = scrnLast > 0 ? scrnLast : (median(rows.map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0)) || 1);

  const out: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const date = addDaysUTC(lastDate, i);
    const dow = dowNameOf(date);

    const x = (rows.length - 1 - (apsDecay.fitStartIndex || 0)) + i;
    const logAps = apsDecay.intercept + apsDecay.slope * x;
    const apsNorm = Math.exp(logAps);
    const apsPred = apsNorm * (mult[dow] || 1);

    const scrnPred = scrnBase * Math.pow(screenTrend, i / 3);
    let y = apsPred * scrnPred;

    // 물리 상한(APS95)
    if (aps95 > 0) y = Math.min(y, scrnPred * aps95 * 1.15);

    out.push(Math.round(Math.max(0, y)));
  }
  return out;
};

/** =========================================================
 * Model B: Bass diffusion (가능할 때만)
 * ========================================================= */
const solveBassParams = (a: number, b: number, c: number) => {
  const disc = b * b - 4 * c * a;
  if (!Number.isFinite(disc) || disc <= 0 || Math.abs(c) < 1e-12) return null;
  const sqrt = Math.sqrt(disc);
  const m1 = (-b + sqrt) / (2 * c);
  const m2 = (-b - sqrt) / (2 * c);
  const candidates = [m1, m2].filter((m) => Number.isFinite(m) && m > 0);
  if (!candidates.length) return null;

  const m = Math.max(...candidates);
  const p = a / m;
  const q = -c * m;
  if (!(p > 0 && q > 0 && m > 0)) return null;

  return { p: clamp(p, 1e-6, 0.12), q: clamp(q, 1e-6, 1.20), m };
};

const fitBassOnSeries = (rows: TrendRow[], mult: Record<DowName, number>) => {
  const y = deSeasonalize(rows, mult);
  const N: number[] = [];
  let cum = 0;
  for (let i = 0; i < y.length; i++) {
    N.push(cum);
    cum += y[i];
  }

  const X1: number[] = [];
  const X2: number[] = [];
  const Y: number[] = [];
  for (let t = 1; t < y.length; t++) {
    if (y[t] <= 0) continue;
    const n = N[t];
    X1.push(n);
    X2.push(n * n);
    Y.push(y[t]);
  }
  if (Y.length < 10) return { ok: false as const, reason: "too_few_points" as const };

  // OLS 3변수(상수 포함) – 정규방정식
  let s1 = 0, sX = 0, sX2 = 0, sXX = 0, sXX2 = 0, sX2X2 = 0;
  let sY = 0, sXY = 0, sX2Y = 0;
  const n = Y.length;

  for (let i = 0; i < n; i++) {
    const x = X1[i];
    const x2 = X2[i];
    const yy = Y[i];
    s1 += 1; sX += x; sX2 += x2;
    sXX += x * x; sXX2 += x * x2; sX2X2 += x2 * x2;
    sY += yy; sXY += x * yy; sX2Y += x2 * yy;
  }

  const A = [
    [s1, sX, sX2],
    [sX, sXX, sXX2],
    [sX2, sXX2, sX2X2],
  ];
  const B = [sY, sXY, sX2Y];

  const det3 = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

  const detA = det3(A);
  if (Math.abs(detA) < 1e-12) return { ok: false as const, reason: "singular" as const };

  const replaceCol = (col: number) => {
    const M = A.map((row) => [...row]);
    for (let i = 0; i < 3; i++) M[i][col] = B[i];
    return M;
  };

  const a = det3(replaceCol(0)) / detA;
  const b = det3(replaceCol(1)) / detA;
  const c = det3(replaceCol(2)) / detA;

  const params = solveBassParams(a, b, c);
  if (!params) return { ok: false as const, reason: "invalid_params" as const };

  // 간단 적합도 (선택)
  const yhat: number[] = [];
  const yobs: number[] = [];
  for (let t = 1; t < y.length; t++) {
    if (y[t] <= 0) continue;
    const nPrev = N[t];
    yhat.push(a + b * nPrev + c * nPrev * nPrev);
    yobs.push(y[t]);
  }

  return {
    ok: true as const,
    p: params.p,
    q: params.q,
    m: params.m,
    r2: rSquared(yobs, yhat),
  };
};

const predictNext3_Bass = (rows: TrendRow[], mult: Record<DowName, number>, bassFit: any) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate || !bassFit?.ok) return [0, 0, 0];

  const { p, q, m } = bassFit;

  const y = deSeasonalize(rows, mult);
  let N = y.reduce((s, v) => s + v, 0);

  const out: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const date = addDaysUTC(lastDate, i);
    const dow = dowNameOf(date);
    const adoption = (p + (q * (N / m))) * (m - N);
    const yDeseason = Math.max(0, adoption);
    out.push(Math.round(yDeseason * (mult[dow] || 1)));
    N += yDeseason;
  }
  return out;
};

/** =========================================================
 * Model C: Kalman (local linear on log(y+1))
 * ========================================================= */
const kalmanLocalLinear = (z: number[]) => {
  let level = z[0] ?? 0;
  let slope = (z.length >= 2) ? (z[1] - z[0]) : 0;

  let P00 = 1, P01 = 0, P10 = 0, P11 = 1;

  const diffs = z.slice(1).map((v, i) => v - z[i]);
  const obsVar = Math.max(0.10, (median(diffs.map((d) => d * d)) || 0.25));
  const qLevel = obsVar * 0.15;
  const qSlope = obsVar * 0.02;

  for (let t = 1; t < z.length; t++) {
    const levelPred = level + slope;
    const slopePred = slope;

    const P00p = P00 + P01 + P10 + P11 + qLevel;
    const P01p = P01 + P11;
    const P10p = P10 + P11;
    const P11p = P11 + qSlope;

    const S = P00p + obsVar;
    const K0 = P00p / S;
    const K1 = P10p / S;

    const y = z[t] - levelPred;
    level = levelPred + K0 * y;
    slope = slopePred + K1 * y;

    P00 = (1 - K0) * P00p;
    P01 = (1 - K0) * P01p;
    P10 = P10p - K1 * P00p;
    P11 = P11p - K1 * P01p;
  }

  return { level, slope };
};

const predictNext3_Kalman = (rows: TrendRow[], mult: Record<DowName, number>) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return [0, 0, 0];

  const yDeseason = deSeasonalize(rows, mult);
  const z = yDeseason.map((v) => Math.log(v + 1));
  const fit = kalmanLocalLinear(z);

  const out: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const date = addDaysUTC(lastDate, i);
    const dow = dowNameOf(date);

    const zPred = fit.level + fit.slope * i;
    const yDeseasonPred = Math.max(0, Math.exp(zPred) - 1);
    out.push(Math.round(yDeseasonPred * (mult[dow] || 1)));
  }
  return out;
};

/** =========================================================
 * daySince 기반 폭주 방지 (3중 락)
 * ========================================================= */
const sameDowMedian = (rows: TrendRow[], targetDow: DowName, lookbackDays = 28) => {
  const slice = rows.slice(-lookbackDays);
  const vals = slice
    .filter(r => dowNameOf(r.date) === targetDow)
    .map(r => safeNum(r.audiCnt, 0))
    .filter(v => v > 0);
  return median(vals) || 0;
};

const applyDaySinceLocks = (
  rows: TrendRow[],
  next3: number[],
  daySince: number,
  mult: Record<DowName, number>,
  screenTrend: number
) => {
  if (!rows.length) return next3;

  const last = rows[rows.length - 1];
  const lastDate = last.date;

  const last1 = safeNum(last.audiCnt, 0);
  const recent = rows.slice(-7).map(r => safeNum(r.audiCnt, 0)).filter(v => v > 0);
  const recentMax = recent.length ? Math.max(...recent) : 0;
  const recentMin = recent.length ? Math.min(...recent) : 0;

  // 물리 캡: scrnPred × APS95
  const aps = rows.map(r => {
    const a = safeNum(r.audiCnt, 0);
    const s = safeNum(r.scrnCnt, 0);
    return (a > 0 && s > 0) ? (a / s) : 0;
  }).filter(v => v > 0);
  const aps95 = percentile(aps.slice(-21), 0.95) || percentile(aps, 0.95) || 0;

  const scrnBase =
    safeNum(last.scrnCnt, 0) ||
    median(rows.map(r => safeNum(r.scrnCnt, 0)).filter(v => v > 0)) ||
    1;

  const out: number[] = [];
  let prev = last1;

  for (let i = 1; i <= 3; i++) {
    const date = addDaysUTC(lastDate, i);
    const dow = dowNameOf(date);
    const wk = isWeekend(date);

    // [보수적 예측 적용] 평균 상영일(AVG_RUN_DAYS)에 가까워질수록 감소폭 확대
    // daySince가 35일 이상이거나, 스크린이 급격히 줄면(0.85 미만) 강한 감소 적용
    let decayFactor = 1.0;
    if (daySince > CFG.AVG_RUN_DAYS * 0.6) decayFactor *= 0.9; // 후반부 진입
    if (daySince > CFG.AVG_RUN_DAYS * 0.9) decayFactor *= 0.8; // 종영 임박
    if (screenTrend < 0.85) decayFactor *= 0.85; // 스크린 급감은 종영 신호

    // 1) 같은 요일 중앙값 캡
    const sameMed = sameDowMedian(rows, dow, 28);
    const capSameDow = sameMed > 0 ? sameMed * CFG.LOCKS.phaseCapFactor(daySince, wk) * decayFactor : Infinity;

    // 2) 전일 대비 성장률 캡
    const capGrowth = prev > 0 ? prev * CFG.LOCKS.growthCap(daySince, wk) * decayFactor : Infinity;

    // 3) 물리 캡
    const scrnPred = scrnBase * Math.pow(clamp(screenTrend, 0.75, 1.25), i / 7);
    const capPhysical = (aps95 > 0) ? (scrnPred * aps95 * 1.15) : Infinity;

    // 4) 후반부 추가: 최근 최대치 기반
    const capRecent =
      daySince >= 14 && recentMax > 0
        ? recentMax * (wk ? 1.25 : 1.10) * decayFactor
        : Infinity;

    const hardCap = Math.min(capSameDow, capGrowth, capPhysical, capRecent);
    const floor = Math.max(0, recentMin * 0.55 * decayFactor); // 바닥도 같이 낮춤

    let y = Math.round(clamp(next3[i - 1] * decayFactor, floor, Number.isFinite(hardCap) ? hardCap : next3[i - 1]));
    
    // 최종 보정
    y = Math.round(y * decayFactor);
    out.push(y);
    prev = y;
  }

  return out;
};

/** =========================================================
 * Final range (finite tail + remaining cap)
 * ========================================================= */
const predictFinalRange_StructuralTail = (
  rows: TrendRow[],
  mult: Record<DowName, number>,
  currentAcc: number,
  daySince: number,
  screenTrend: number,
  apsDecay: any
) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return { min: currentAcc, avg: currentAcc, max: currentAcc };

  const last7Sum = rows.slice(-7).map(r => safeNum(r.audiCnt, 0)).reduce((a, b) => a + b, 0);
  const capByAcc = currentAcc * CFG.REMAINING_CAP.byAccFactor(daySince);
  const capByRun = last7Sum * CFG.REMAINING_CAP.byRunRateWeeks(daySince);
  const remainingCap = Math.max(capByAcc, capByRun) * clamp(screenTrend, 0.80, 1.20);

  const horizon = Math.round(clamp(180 - daySince, 40, 120));
  const stopThreshold = 650;

  const apsRaw = computeApsSeries(rows).slice(-21).filter((v) => v > 0);
  const aps95 = percentile(apsRaw, 0.95) || (apsRaw.length ? Math.max(...apsRaw) : 0);

  const scrnLast = safeNum(rows[rows.length - 1].scrnCnt, 0);
  const scrnBase = scrnLast > 0 ? scrnLast : (median(rows.map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0)) || 1);

  const residualStd = clamp(apsDecay?.residualStd ?? 0.35, 0.18, 0.80);

  const simulate = (z: number) => {
    let sum = 0;
    for (let i = 1; i <= horizon; i++) {
      const date = addDaysUTC(lastDate, i);
      const dow = dowNameOf(date);

      const x = (rows.length - 1 - (apsDecay.fitStartIndex || 0)) + i;
      const logAps = apsDecay.intercept + apsDecay.slope * x + z;
      const apsNorm = Math.exp(logAps);
      const apsPred = apsNorm * (mult[dow] || 1);

      const scrnPred = scrnBase * Math.pow(screenTrend, i / 7);
      let yi = apsPred * scrnPred;

      if (aps95 > 0) yi = Math.min(yi, scrnPred * aps95 * 1.15);

      yi = Math.max(0, Math.round(yi));
      sum += yi;

      if (i > 14 && yi < stopThreshold) break;
      if (sum >= remainingCap) { sum = remainingCap; break; }
    }
    return sum;
  };

  const extraAvg = simulate(0);
  const extraMin = simulate(-1.0 * residualStd);
  const extraMax = simulate(+1.0 * residualStd);

  return {
    min: Math.max(currentAcc + Math.round(extraMin), currentAcc),
    avg: Math.max(currentAcc + Math.round(extraAvg), currentAcc),
    max: Math.max(currentAcc + Math.round(extraMax), currentAcc),
  };
};

/** =========================================================
 * Unreleased (reservation-only)
 * ========================================================= */
const computeMomentum = (arr: number[]) => {
  if (arr.length < 3) return 0;
  const xs = arr.map((_, i) => i);
  const { slope } = linearRegression(xs, arr);
  return slope;
};

const inferLegsByGenre = (movieInfo: any) => {
  const genreText =
    (movieInfo?.genreAlt) ||
    (Array.isArray(movieInfo?.genres) ? movieInfo.genres.map((g: any) => g.genreNm).join(", ") : "") ||
    "";
  const g = (genreText || "").toLowerCase();
  if (g.includes("공포") || g.includes("horror") || g.includes("thriller") || g.includes("스릴러")) return { legs: CFG.LEGS_PRIOR.horror, genreText };
  if (g.includes("애니") || g.includes("animation") || g.includes("가족") || g.includes("family")) return { legs: CFG.LEGS_PRIOR.animation, genreText };
  if (g.includes("드라마") || g.includes("drama")) return { legs: CFG.LEGS_PRIOR.drama, genreText };
  if (g.includes("액션") || g.includes("action") || g.includes("범죄") || g.includes("crime")) return { legs: CFG.LEGS_PRIOR.action, genreText };
  return { legs: CFG.LEGS_PRIOR.default, genreText };
};

const buildUnreleasedNumbers = (openDate: string, historyData: any[], movieInfo: any) => {
  const today = getKST_YYYYMMDD();
  const daysToOpen = openDate && openDate.length === 8 ? daysBetweenUTC(today, openDate) : 0;

  const series = Array.isArray(historyData) ? historyData.slice(-24) : [];
  const rates = series.map((d: any) => safeNum(d.rate, 0));
  const cnts  = series.map((d: any) => safeNum(d.val_audi, 0));

  const latestRate = rates.length ? rates[rates.length - 1] : 0;
  const latestCntRaw = cnts.length ? cnts[cnts.length - 1] : 0;
  const rateMomentum = computeMomentum(rates);

  const weekendOpen = isWeekend(openDate);

  let latestCnt = 0;
  let inferredFrom: "val_audi" | "rate_assumption" | "fallback_min" = "fallback_min";

  if (latestCntRaw > 0) {
    latestCnt = latestCntRaw;
    inferredFrom = "val_audi";
  } else if (latestRate > 0) {
    const pool = weekendOpen ? CFG.ASSUMED_RESERVED_MARKET.weekend : CFG.ASSUMED_RESERVED_MARKET.weekday;
    latestCnt = Math.round(pool * (latestRate / 100));
    inferredFrom = "rate_assumption";
  } else {
    latestCnt = CFG.OPENING_CAP.min;
    inferredFrom = "fallback_min";
  }

  const baseWalkup = weekendOpen ? CFG.WALKUP.weekendBase : CFG.WALKUP.weekdayBase;
  const momentumAdj = clamp(rateMomentum * CFG.WALKUP.momentumAdjScale, -0.20, 0.28);
  const walkup = clamp(baseWalkup + momentumAdj, CFG.WALKUP.clamp.lo, CFG.WALKUP.clamp.hi);

  let openDay = Math.round(latestCnt * (1 + walkup));
  openDay = clamp(openDay, CFG.OPENING_CAP.min, CFG.OPENING_CAP.max);

  // 오프닝 3일 요일 프로파일(상식적 범위)
  const dowMult: Record<DowName, number> = { Mon: 1.00, Tue: 1.00, Wed: 1.05, Thu: 1.12, Fri: 1.45, Sat: 2.05, Sun: 1.80 };
  const d0 = openDate;
  const d1 = addDaysUTC(d0, 1);
  const d2 = addDaysUTC(d0, 2);
  const base = openDay / (dowMult[dowNameOf(d0)] || 1);
  const o0 = Math.round(base * (dowMult[dowNameOf(d0)] || 1));
  const o1 = Math.round(base * (dowMult[dowNameOf(d1)] || 1));
  const o2 = Math.round(base * (dowMult[dowNameOf(d2)] || 1));

  const opener3 = o0 + o1 + o2;

  const { legs, genreText } = inferLegsByGenre(movieInfo);

  const rateAdj =
    latestRate >= 20 ? 1.22 :
    latestRate >= 10 ? 1.10 :
    latestRate >= 5  ? 1.02 :
    latestRate > 0   ? 0.94 : 0.98;

  const distanceAdj =
    daysToOpen >= 30 ? 0.94 :
    daysToOpen >= 14 ? 0.98 : 1.00;

  const avg = Math.round(opener3 * legs.avg * rateAdj * distanceAdj);
  const min = Math.round(opener3 * legs.min * clamp(rateAdj - 0.06, 0.80, 1.30) * distanceAdj);
  const max = Math.round(opener3 * legs.max * clamp(rateAdj + 0.06, 0.80, 1.40) * distanceAdj);

  return {
    opening3: [o0, o1, o2],
    finalPred: { min: Math.min(min, avg), avg, max: Math.max(max, avg) },
    signals: {
      mode: "UNRELEASED",
      openDate,
      daysToOpen,
      reservation: { latestRate, latestCnt, rateMomentum, inferredFrom },
      genreText,
      walkup,
      rateAdj,
      distanceAdj,
      forecastDates: `${d0} ${getDayContext(d0)} | ${d1} ${getDayContext(d1)} | ${d2} ${getDayContext(d2)}`,
    }
  };
};

/** =========================================================
 * Main handler
 * ========================================================= */
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
      // 5대 지표 수신
      reservationRate,
      reservationAudi,
      reservationSales,
      currentAudiAcc,
      currentSalesAcc,
      
      historyData,
      productionCost,
      avgTicketPrice,
      peopleContext,
      useLLM,        
    } = req.body;

    const todayKST = getKST_YYYYMMDD();
    const nowKST = new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" });

    const openDateRaw = (movieInfo?.openDt || "").toString();
    const openDate = (openDateRaw && openDateRaw.length === 8) ? openDateRaw : "";

    const directors = movieInfo?.directors?.map((d: any) => d.peopleNm).join(", ") || "Unknown Director";
    const actors = movieInfo?.actors?.slice(0, 5).map((a: any) => a.peopleNm).join(", ") || "Unknown Actors";

    // BEP Context 생성
    let bepContext = "Production cost unknown.";
    if (productionCost && Number(productionCost) > 0) {
      const cost = Number(productionCost);
      const atp = Number(avgTicketPrice || 12000);
      const bepAudi = Math.round(cost / (atp * 0.4));
      const percent = bepAudi > 0 ? ((Number(currentAudiAcc) / bepAudi) * 100).toFixed(1) : "0.0";
      bepContext = `Production Cost: ${Math.round(cost)} KRW. Avg Ticket Price: ${Math.round(atp)} KRW. BEP Target: approx ${bepAudi}. Progress: ${percent}%.`;
    }

    // 실시간 예매 정보 텍스트 생성
    let realtimeStatsContext = "No Realtime Data.";
    if (reservationRate || reservationAudi) {
        realtimeStatsContext = 
            `Current Realtime Stats (KOBIS): ` +
            `Reservation Rate: ${reservationRate || 0}%, ` +
            `Pre-sales Audi: ${safeNum(reservationAudi, 0).toLocaleString()} people, ` +
            `Pre-sales Sales: ${safeNum(reservationSales, 0).toLocaleString()} KRW, ` +
            `Total Audi Acc: ${safeNum(currentAudiAcc, 0).toLocaleString()} people, ` +
            `Total Sales Acc: ${safeNum(currentSalesAcc, 0).toLocaleString()} KRW.`;
    }

    let rowsAll = normalizeTrend(trendData);
    rowsAll = fillMissingDates(rowsAll);

    const hasDaily = rowsAll.length >= 6;
    const isUnreleased = openDate ? (openDate > todayKST) : (!hasDaily);

    let baseForecast3: number[] = [0, 0, 0];
    let baseFinal = { min: 0, max: 0, avg: 0 };
    let modelSignals: any = {};
    let forecastDates = "";

    if (isUnreleased) {
      const inferredOpen = openDate || todayKST;
      const pre = buildUnreleasedNumbers(inferredOpen, historyData, movieInfo);

      baseForecast3 = pre.opening3;
      baseFinal = pre.finalPred;
      modelSignals = pre.signals;
      forecastDates = pre.signals.forecastDates;

    } else {
      const startIndex = findEffectiveStartIndex(rowsAll, 0.30);
      const rows = rowsAll.slice(startIndex);

      const effectiveOpenDate = rows[0]?.date || rowsAll[0]?.date || todayKST;
      const lastDate = rows[rows.length - 1]?.date || todayKST;
      const daySince = Math.max(0, daysBetweenUTC(effectiveOpenDate, lastDate));

      const mult = computeDowMultipliers(rows);

      const screenTrend = computeScreenTrend(rows);
      const apsDecay = fitApsDecay_LogLinear(rows, mult);

      const nextA = predictNext3_ScreenAPS(rows, mult, apsDecay, screenTrend);
      const nextC = predictNext3_Kalman(rows, mult);

      const bassFit0 = fitBassOnSeries(rows, mult);
      const curAcc = safeNum(currentAudiAcc, 0);

      let bassFit = bassFit0;
      if (bassFit.ok && curAcc > 0) {
        const mCap = curAcc * CFG.BASS_M_CAP(daySince);
        bassFit = { ...bassFit, m: Math.min(bassFit.m, mCap) };
      }

      const nextB = bassFit.ok ? predictNext3_Bass(rows, mult, bassFit) : [0, 0, 0];

      const w = CFG.WEIGHTS(daySince, bassFit.ok);
      const ensemble = [0, 0, 0].map((_, i) =>
        Math.round(w[0] * nextA[i] + w[1] * nextB[i] + w[2] * nextC[i])
      );

      // ✅ 폭주 방지 3중 락 적용 (보수적 판단 포함)
      baseForecast3 = applyDaySinceLocks(rows, ensemble, daySince, mult, screenTrend);

      // ✅ 유한 tail + remaining cap
      const final = predictFinalRange_StructuralTail(rows, mult, curAcc, daySince, screenTrend, apsDecay);
      baseFinal = { min: final.min, max: final.max, avg: final.avg };

      const d1 = addDaysUTC(lastDate, 1);
      const d2 = addDaysUTC(lastDate, 2);
      const d3 = addDaysUTC(lastDate, 3);
      forecastDates = `${d1} ${getDayContext(d1)} | ${d2} ${getDayContext(d2)} | ${d3} ${getDayContext(d3)}`;

      modelSignals = {
        mode: "RELEASED_ENSEMBLE_LOCKED",
        effectiveOpenDate,
        lastDate,
        daySince,
        weights: { screenAPS: w[0], bass: w[1], kalman: w[2] },
        next3_byModel: { screenAPS: nextA, bass: nextB, kalman: nextC },
        next3_locked: baseForecast3,
        bassFit: bassFit.ok ? { p: bassFit.p, q: bassFit.q, m: Math.round(bassFit.m), r2: bassFit.r2 } : { ok: false, reason: bassFit.reason },
        apsDecay: { slope: apsDecay.slope, r2: apsDecay.r2, residualStd: apsDecay.residualStd },
        screenTrend,
      };
    }

    // 기본 리포트(LLM 없이)
    const analysisFallback = isUnreleased
      ? `🎟️ 개봉 전(개봉일: ${openDate || "미상"})으로 판단되어 예매/실시간 지표 기반으로 오프닝을 산출했습니다.\n` +
        `📅 오프닝 3일(개봉일~+2일): ${forecastDates}\n` +
        `📈 관객 예측: ${baseForecast3.map(n => n.toLocaleString()).join(" / ")}명\n` +
        `🎯 최종 관객수: ${baseFinal.min.toLocaleString()}~${baseFinal.max.toLocaleString()}명(중앙 ${baseFinal.avg.toLocaleString()}명)`
      : `📌 현재 누적 관객: ${safeNum(currentAudiAcc, 0).toLocaleString()}명\n` +
        `📅 예측 3일: ${forecastDates}\n` +
        `📈 다음 3일 예측: ${baseForecast3.map(n => n.toLocaleString()).join(" / ")}명\n` +
        `🎯 최종 관객수: ${baseFinal.min.toLocaleString()}~${baseFinal.max.toLocaleString()}명(중앙 ${baseFinal.avg.toLocaleString()}명)`;

    const useLLMFinal = (typeof useLLM === "boolean") ? useLLM : CFG.USE_LLM_DEFAULT;

    // LLM 미사용(기본)
    if (!useLLMFinal) {
      return res.status(200).json({
        analysisText: analysisFallback,
        predictionSeries: baseForecast3,
        searchKeywords: [movieName, isUnreleased ? "예매율" : "박스오피스"],
        predictedFinalAudi: baseFinal,
        forecastDates,
        modelSignals,
      });
    }

    // LLM 사용(문장만 보강, 숫자는 앵커 범위)
    const rowsForPrompt = rowsAll.slice(-14);
    const recentTrend = rowsForPrompt.length
      ? rowsForPrompt.map((d: any) => `[${d.date} ${getDayContext(d.date)}] Audi:${safeNum(d.audiCnt, 0)}, Sales:${safeNum(d.salesAmt, 0)}, Scrn:${safeNum(d.scrnCnt, 0)}, Show:${safeNum(d.showCnt, 0)}`).join("\n")
      : "No daily trend data";

    const realtimeTrend = Array.isArray(historyData) && historyData.length
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank:${d.rank}, Rate:${d.rate}%, Audi:${d.val_audi}`).join("\n")
      : "No realtime history";

    const prompt = `
Role: Elite Box Office Analyst (Korea). Write concise Korean.

Target Movie: "${movieName}"
Director: ${directors}
Cast(Top5): ${actors}
${peopleContext ? `\nVerified People Context (provided by user; do not invent beyond this):\n${peopleContext}\n` : ""}

Open Date(KOBIS): ${openDate || "Unknown"}
Today(KST): ${todayKST}
Now(KST): ${nowKST}
Financial Context: ${bepContext}
Realtime Stats: ${realtimeStatsContext}

Recent Daily Trend:
${recentTrend}

Realtime/Reservation History:
${realtimeTrend}

ANCHOR (do not deviate much):
- Forecast Dates: ${forecastDates}
- Base Forecast(3): ${JSON.stringify(baseForecast3)}
- Base Final Range: ${JSON.stringify(baseFinal)}
- Model Signals: ${JSON.stringify(modelSignals)}

RULES:
- Do not invent filmography facts.
- Forecast must remain within [base*${CFG.LLM_ADJUST.lo}, base*${CFG.LLM_ADJUST.hi}] for each day.
- Final must stay inside baseFinal range.

Output STRICT JSON only:
{
  "analysis": "Korean string (3 short paragraphs with emojis)",
  "forecast": [Number, Number, Number],
  "keywords": ["String", "String"],
  "predictedFinalAudi": { "min": Number, "max": Number, "avg": Number }
}
`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", temperature: CFG.LLM_ADJUST.temperature, topP: CFG.LLM_ADJUST.topP }
    });

    let text = "{}";
    if (response?.candidates?.length) text = response.candidates[0]?.content?.parts?.[0]?.text || "{}";

    let result: any = null;
    try { result = JSON.parse(cleanJsonString(text)); } catch { result = null; }

    const forecast = Array.isArray(result?.forecast) && result.forecast.length === 3
      ? result.forecast.map((x: any, i: number) => Math.round(clamp(
          safeNum(x, baseForecast3[i]),
          baseForecast3[i] * CFG.LLM_ADJUST.lo,
          baseForecast3[i] * CFG.LLM_ADJUST.hi
        )))
      : baseForecast3;

    const predictedFinalAudi = result?.predictedFinalAudi?.avg
      ? {
          min: Math.round(clamp(safeNum(result.predictedFinalAudi.min, baseFinal.min), baseFinal.min, baseFinal.max)),
          max: Math.round(clamp(safeNum(result.predictedFinalAudi.max, baseFinal.max), baseFinal.min, baseFinal.max)),
          avg: Math.round(clamp(safeNum(result.predictedFinalAudi.avg, baseFinal.avg), baseFinal.min, baseFinal.max)),
        }
      : baseFinal;

    const analysisText = result?.analysis || analysisFallback;
    const keywords = Array.isArray(result?.keywords) && result.keywords.length ? result.keywords.slice(0, 2) : [movieName, "박스오피스"];

    return res.status(200).json({
      analysisText,
      predictionSeries: forecast,
      searchKeywords: keywords,
      predictedFinalAudi,
      forecastDates,
      modelSignals,
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
