import { GoogleGenAI } from "@google/genai";

/** =========================
 *  CONFIG (튜닝 포인트)
 *  ========================= */
const CFG = {
  // Released: 다음 3일 과소예측을 막는 최소 앵커(지난주 같은 요일 대비)
  ANCHOR_BLEND: 0.45, // 0~1 (높을수록 "지난주 같은 요일"을 더 믿음)

  // Released: APS(스크린당 관객) 감쇠 slope 범위 (개봉 경과일에 따라 floor 자동 완화)
  APS_SLOPE: {
    floorD0_6: -0.006,  // day<7: 과소예측 방지 (완만 허용)
    floorD7_13: -0.010,
    floorD14_27: -0.016,
    floorD28_59: -0.024,
    floorD60p: -0.032,
    ceil: -0.001,       // 너무 완만하면 꼬리 과대 → 최소한 이 정도는 감쇠
    hardMin: -0.20,
  },

  // Released: 다음 3일 상한 캡 (개봉 초반 확장 가능성 반영)
  NEXT3_UPPER: {
    d0_6: { weekend: 1.85, weekday: 1.40 },
    d7_13: { weekend: 1.55, weekday: 1.28 },
    d14_27: { weekend: 1.35, weekday: 1.18 },
    d28p: { weekend: 1.20, weekday: 1.12 },
  },

  // Released: 최종 잔여(remaining) 상한 (너무 낮게 잡히면 과소예측)
  REMAINING_CAP: {
    // currentAcc * factor 와 last7Sum * weeks 를 비교해 큰 값 채택
    byAccFactor: (daySince: number) => {
      if (daySince < 7) return 14.0;
      if (daySince < 14) return 10.0;
      if (daySince < 28) return 5.5;
      if (daySince < 60) return 2.4;
      return 0.9;
    },
    byRunRateWeeks: (daySince: number) => {
      if (daySince < 7) return 22;
      if (daySince < 14) return 16;
      if (daySince < 28) return 12;
      if (daySince < 60) return 9;
      return 6;
    },
  },

  // DOW priors (데이터가 부족할 때 사용)
  DOW_PRIOR: { Mon: 1.00, Tue: 1.00, Wed: 1.03, Thu: 1.08, Fri: 1.30, Sat: 1.85, Sun: 1.65 },

  // Unreleased: historyData에 예매량(val_audi)이 없을 때 rate(%)를 "가정 시장 예매풀"로 환산
  // (외부 API 없이 최소한의 숫자 리포팅을 위해 둔 내부 가정치)
  ASSUMED_RESERVED_MARKET: {
    weekday: 380_000,
    weekend: 520_000,
  },

  // Unreleased: 예매 → 오프닝 day walk-up(현장/당일) 계수
  WALKUP: {
    weekdayBase: 0.85,
    weekendBase: 1.10,
    momentumAdjScale: 0.22, // rateMomentum에 곱해서 walkup에 더함
    clamp: { lo: 0.55, hi: 1.55 },
  },

  // Unreleased: 오프닝 최소/최대 캡(0 근처 방지 + 과장 방지)
  OPENING_CAP: { min: 25_000, max: 2_800_000 },

  // Unreleased: 장르 기반 legs prior (최종/오프닝3일 배수)
  // (없으면 default)
  LEGS_PRIOR: {
    horror: { min: 2.1, avg: 2.7, max: 3.6 },
    animation: { min: 4.0, avg: 5.8, max: 8.2 },
    drama: { min: 3.2, avg: 4.6, max: 6.5 },
    action: { min: 2.9, avg: 4.0, max: 5.9 },
    default: { min: 3.0, avg: 4.3, max: 6.4 },
  },

  // LLM은 “문장”만 다듬고, 숫자는 코드 예측에 최대한 붙게 제한
  LLM: { temperature: 0.12, maxAdjust: 0.25, minAdjust: 0.70 },
};

/** =========================
 *  Small utils
 *  ========================= */
const cleanJsonString = (str: string) => {
  if (!str) return "{}";
  return str.replace(/```json/gi, "").replace(/```/g, "").trim();
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const safeNum = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

const getDayContext = (dateStr: string) => {
  if (!dateStr || dateStr.length !== 8) return "";
  const dn = dowNameOf(dateStr);
  const type = (dn === "Sat" || dn === "Sun") ? "Weekend" : "Weekday";
  return `(${dn}, ${type})`;
};

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** =========================
 *  Simple stats
 *  ========================= */
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

const robustLogLinearFit = (xs: number[], ysLog: number[]) => {
  if (xs.length < 4) {
    return { slope: -0.03, intercept: ysLog[0] ?? Math.log(100), r2: 0, residualStd: 0.35 };
  }
  const fitOnce = (X: number[], Y: number[]) => {
    const { slope, intercept } = linearRegression(X, Y);
    const yhat = X.map((x) => intercept + slope * x);
    return {
      slope,
      intercept,
      yhat,
      r2: rSquared(Y, yhat),
      residualStd: stdResidual(Y, yhat),
      resid: Y.map((y, i) => y - yhat[i]),
    };
  };
  const first = fitOnce(xs, ysLog);
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

const estimateWeeklySlope = (series: number[]) => {
  if (series.length < 14) return null;
  const a = series.slice(-7).reduce((s, v) => s + v, 0);
  const b = series.slice(-14, -7).reduce((s, v) => s + v, 0);
  if (a <= 0 || b <= 0) return null;
  return Math.log(a / b) / 7;
};

/** =========================
 *  Trend normalize
 *  ========================= */
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

const findEffectiveStartIndex = (rows: TrendRow[], ratio = 0.30) => {
  const scrns = rows.map((r) => r.scrnCnt ?? 0);
  const maxScrn = Math.max(...scrns, 0);
  if (maxScrn <= 0) return 0;
  const thr = Math.floor(maxScrn * ratio);
  const idx = rows.findIndex((r) => (r.scrnCnt ?? 0) >= thr);
  return idx >= 0 ? idx : 0;
};

/** =========================
 *  DOW multipliers (data-driven + prior blend)
 *  ========================= */
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

  const mult: Record<DowName, number> = {} as any;
  let dataCount = 0;
  for (const k of DOW) {
    const m = median(buckets[k]);
    if (m > 0) dataCount += 1;
    const dataMult = m > 0 ? m / baseline : 1;
    // 데이터가 적으면 prior를 더 섞음
    const w = clamp(buckets[k].length / 4, 0, 1); // 0~1
    const prior = (CFG.DOW_PRIOR as any)[k] ?? 1;
    mult[k] = clamp((w * dataMult + (1 - w) * prior), 0.60, 2.70);
  }

  // 주말 데이터 거의 없으면 최소 보장
  if ((buckets.Sat.length + buckets.Sun.length) < 2) {
    mult.Sat = Math.max(mult.Sat, 1.45);
    mult.Sun = Math.max(mult.Sun, 1.55);
  }

  return { mult, dataCount };
};

/** =========================
 *  Released model: Screen + APS + Anchor ensemble
 *  ========================= */
const computeScreenTrend = (rows: TrendRow[]) => {
  const A = rows.slice(-14, -7).map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0);
  const B = rows.slice(-7).map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0);
  const medA = median(A) || median(rows.map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0)) || 1;
  const medB = median(B) || medA;
  return clamp(medB / medA, 0.60, 1.45);
};

const computeApsSeries = (rows: TrendRow[]) => {
  return rows.map((r) => {
    const audi = safeNum(r.audiCnt, 0);
    const scrn = safeNum(r.scrnCnt, 0);
    if (audi <= 0) return 0;
    if (scrn > 0) return audi / scrn;
    return audi;
  });
};

const fitApsDecay = (rows: TrendRow[], mult: Record<DowName, number>, daySinceRelease: number) => {
  const aps = computeApsSeries(rows);
  const apsNormAll = rows.map((r, i) => {
    const m = mult[dowNameOf(r.date)] || 1;
    return aps[i] > 0 ? aps[i] / m : 0;
  });

  const win = Math.min(apsNormAll.length, apsNormAll.length >= 21 ? 21 : 14);
  const start = Math.max(0, apsNormAll.length - win);
  const recent = apsNormAll.slice(start);

  const xs: number[] = [];
  const ysLog: number[] = [];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i] > 0) {
      xs.push(i);
      ysLog.push(Math.log(recent[i]));
    }
  }

  const fit = robustLogLinearFit(xs, ysLog);
  const wkSlope = estimateWeeklySlope(apsNormAll);

  let slope = fit.slope;
  if (wkSlope != null && Number.isFinite(wkSlope)) slope = 0.65 * slope + 0.35 * wkSlope;

  const floor =
    daySinceRelease < 7 ? CFG.APS_SLOPE.floorD0_6 :
    daySinceRelease < 14 ? CFG.APS_SLOPE.floorD7_13 :
    daySinceRelease < 28 ? CFG.APS_SLOPE.floorD14_27 :
    daySinceRelease < 60 ? CFG.APS_SLOPE.floorD28_59 :
    CFG.APS_SLOPE.floorD60p;

  // 과소예측 방지: 너무 가파른 감쇠(더 음수)면 완화
  slope = Math.max(slope, floor);

  // 과대 방지: 너무 완만하면(0에 가까우면) 최소 감쇠 강제
  slope = Math.min(slope, CFG.APS_SLOPE.ceil);

  // 최종 안전 범위
  slope = clamp(slope, CFG.APS_SLOPE.hardMin, -0.001);

  return {
    slope,
    intercept: fit.intercept,
    r2: fit.r2,
    residualStd: fit.residualStd || 0.35,
    fitWindow: win,
    fitStartIndex: start,
    apsNormAll,
  };
};

const chooseUpperFactor = (daySinceRelease: number) => {
  if (daySinceRelease < 7) return CFG.NEXT3_UPPER.d0_6;
  if (daySinceRelease < 14) return CFG.NEXT3_UPPER.d7_13;
  if (daySinceRelease < 28) return CFG.NEXT3_UPPER.d14_27;
  return CFG.NEXT3_UPPER.d28p;
};

const lastSameDowAnchor = (rows: TrendRow[], targetYmd: string) => {
  const targetDow = dowNameOf(targetYmd);
  // 최근 21일에서 같은 요일 가장 최근값 찾기
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 21); i--) {
    if (dowNameOf(rows[i].date) === targetDow && safeNum(rows[i].audiCnt, 0) > 0) {
      return { date: rows[i].date, audi: safeNum(rows[i].audiCnt, 0), scrn: safeNum(rows[i].scrnCnt, 0) };
    }
  }
  return null;
};

const predictNext3Released = (
  rows: TrendRow[],
  mult: Record<DowName, number>,
  decay: any,
  screenTrend: number,
  daySinceRelease: number
) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return { next3: [0, 0, 0], anchors: [] as any[] };

  const upperFactor = chooseUpperFactor(daySinceRelease);

  const slice = rows.slice(-28);
  const weekendVals = slice.filter((r) => safeNum(r.audiCnt, 0) > 0 && isWeekend(r.date)).map((r) => safeNum(r.audiCnt, 0));
  const weekdayVals = slice.filter((r) => safeNum(r.audiCnt, 0) > 0 && !isWeekend(r.date)).map((r) => safeNum(r.audiCnt, 0));
  const maxWeekend = weekendVals.length ? Math.max(...weekendVals) : 0;
  const maxWeekday = weekdayVals.length ? Math.max(...weekdayVals) : 0;

  const scrnLast = safeNum(rows[rows.length - 1].scrnCnt, 0);
  const scrnBase = scrnLast > 0 ? scrnLast : (median(rows.map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0)) || 1);

  const apsNormAll = decay.apsNormAll as number[];
  const tLast = apsNormAll.length - 1;

  // APS per screen 물리적 캡(좌석수 없이 가능한 최저 수준의 현실 캡)
  const apsRaw = computeApsSeries(rows).slice(-21).filter((v) => v > 0);
  const apsMax = apsRaw.length ? Math.max(...apsRaw) : 0;

  const anchors: any[] = [];
  const out: number[] = [];

  for (let i = 1; i <= 3; i++) {
    const date = addDaysUTC(lastDate, i);
    const dow = dowNameOf(date);

    // 1) Model core: APS_norm decay -> APS -> audience
    const logAps = decay.intercept + decay.slope * (tLast - (decay.fitStartIndex || 0) + i);
    const apsNormPred = Math.exp(logAps);
    const apsPred = apsNormPred * (mult[dow] || 1);

    const scrnPred = scrnBase * Math.pow(screenTrend, i / 3);
    const modelY = apsPred * scrnPred;

    // 2) Anchor: last same DOW (지난주/최근 같은 요일)
    const a = lastSameDowAnchor(rows, date);
    let anchorY = 0;
    if (a) {
      // 스크린 변화율을 반영해 스케일
      const scrnScale = (a.scrn > 0 && scrnPred > 0) ? clamp(scrnPred / a.scrn, 0.75, 1.35) : 1;
      anchorY = a.audi * scrnScale;
      anchors.push({ target: date, from: a.date, audi: a.audi, scaled: Math.round(anchorY) });
    } else {
      anchors.push({ target: date, from: null });
    }

    // 3) Ensemble
    const w = a ? CFG.ANCHOR_BLEND : 0;
    let y = (1 - w) * modelY + w * anchorY;

    // 4) Caps
    const weekend = isWeekend(date);
    const typeMax = weekend ? maxWeekend : maxWeekday;
    const upper = typeMax > 0
      ? typeMax * (weekend ? upperFactor.weekend : upperFactor.weekday)
      : (Math.max(...rows.slice(-7).map((r) => safeNum(r.audiCnt, 0)), 120000) * 1.28);

    const recentMin = Math.min(...rows.slice(-7).map((r) => safeNum(r.audiCnt, 0)).filter((v) => v > 0), 999999999);
    const lower = Math.max(0, Number.isFinite(recentMin) ? recentMin * 0.55 : 0);

    // APS 물리 캡 (스크린 * 최대 APS * 1.15)
    const physUpper = (apsMax > 0) ? (scrnPred * apsMax * 1.15) : upper;
    const finalUpper = Math.min(upper, physUpper);

    y = clamp(y, lower, finalUpper);
    out.push(Math.round(y));
  }

  return { next3: out, anchors };
};

const predictFinalReleased = (
  rows: TrendRow[],
  mult: Record<DowName, number>,
  decay: any,
  screenTrend: number,
  currentAcc: number,
  daySinceRelease: number
) => {
  const lastDate = rows[rows.length - 1]?.date;
  if (!lastDate) return { min: currentAcc, max: currentAcc, avg: currentAcc, horizon: 60 };

  // finite horizon (너무 짧게 잡아 과소예측이 나오는 걸 방지)
  const horizon = Math.round(clamp(180 - daySinceRelease, 35, 120));

  const last7 = rows.slice(-7).map((r) => safeNum(r.audiCnt, 0));
  const runRate7 = last7.reduce((s, v) => s + v, 0);

  const capByAcc = currentAcc * CFG.REMAINING_CAP.byAccFactor(daySinceRelease);
  const capByRun = runRate7 * CFG.REMAINING_CAP.byRunRateWeeks(daySinceRelease);

  const remainingCap = Math.max(capByAcc, capByRun) * clamp(screenTrend, 0.78, 1.18);

  const apsNormAll = decay.apsNormAll as number[];
  const tLast = apsNormAll.length - 1;

  const scrnLast = safeNum(rows[rows.length - 1].scrnCnt, 0);
  const scrnBase = scrnLast > 0 ? scrnLast : (median(rows.map((r) => safeNum(r.scrnCnt, 0)).filter((v) => v > 0)) || 1);

  const stopThreshold = 650;
  const stopAfter = 14;

  const simulate = (zLog: number) => {
    let sum = 0;
    let below = 0;
    for (let i = 1; i <= horizon; i++) {
      const date = addDaysUTC(lastDate, i);
      const dow = dowNameOf(date);

      // tail에서 slope 약간 가속(과대 방지). 단 초반에는 가속 최소
      const tailBoost = (daySinceRelease >= 14 && i > 21) ? 1.10 : 1.0;
      const slopeEff = decay.slope * tailBoost;

      const logAps = decay.intercept + slopeEff * (tLast - (decay.fitStartIndex || 0) + i) + zLog;
      const apsNormPred = Math.exp(logAps);
      const apsPred = apsNormPred * (mult[dow] || 1);

      const scrnPred = scrnBase * Math.pow(screenTrend, i / 7);
      const yi = Math.max(0, Math.round(apsPred * scrnPred));

      sum += yi;

      if (yi < stopThreshold && i > stopAfter) below += 1;
      else below = 0;

      if (below >= 7) break;
      if (sum >= remainingCap) { sum = remainingCap; break; }
    }
    return sum;
  };

  const std = decay.residualStd || 0.35;
  const extraAvg = simulate(0);
  const extraMin = simulate(-1.0 * std);
  const extraMax = simulate(+1.0 * std);

  const min = Math.max(currentAcc + Math.round(extraMin), currentAcc);
  const avg = Math.max(currentAcc + Math.round(extraAvg), currentAcc);
  const max = Math.max(currentAcc + Math.round(extraMax), currentAcc);

  return { min, avg, max, horizon };
};

type ReleasedModel = {
  mode: "RELEASED";
  effectiveOpenDate: string;
  daySinceRelease: number;
  multipliers: Record<DowName, number>;
  screenTrend: number;
  apsDecay: any;
  next3: number[];
  finalPred: { min: number; max: number; avg: number };
  debug: any;
};

const buildReleasedModel = (trendData: any[], currentAudiAcc: any): ReleasedModel => {
  const rowsAll = normalizeTrend(trendData);
  const startIndex = findEffectiveStartIndex(rowsAll, 0.30);
  const rows = rowsAll.slice(startIndex);

  const effectiveOpenDate = rows[0]?.date || (rowsAll[0]?.date ?? "");
  const lastDate = rows[rows.length - 1]?.date || effectiveOpenDate;

  const daySinceRelease = Math.max(0, daysBetweenUTC(effectiveOpenDate, lastDate));
  const { mult, dataCount } = computeDowMultipliers(rows);

  const screenTrend = computeScreenTrend(rows);
  const apsDecay = fitApsDecay(rows, mult, daySinceRelease);

  const { next3, anchors } = predictNext3Released(rows, mult, apsDecay, screenTrend, daySinceRelease);

  const curAcc = safeNum(currentAudiAcc, 0);
  const finalSim = predictFinalReleased(rows, mult, apsDecay, screenTrend, curAcc, daySinceRelease);

  return {
    mode: "RELEASED",
    effectiveOpenDate,
    daySinceRelease,
    multipliers: mult,
    screenTrend,
    apsDecay,
    next3,
    finalPred: { min: finalSim.min, max: finalSim.max, avg: finalSim.avg },
    debug: {
      rowsAll: rowsAll.length,
      rowsUsed: rows.length,
      lastDate,
      dataCount,
      anchors,
      horizon: finalSim.horizon,
      last7: rows.slice(-7).map(r => ({ date: r.date, audi: r.audiCnt, scrn: r.scrnCnt })),
      apsSlope: apsDecay.slope,
      apsR2: apsDecay.r2,
    }
  };
};

/** =========================
 *  Unreleased model (reservation-based; only internal inputs)
 *  ========================= */
type UnreleasedModel = {
  mode: "UNRELEASED";
  openDate: string;
  daysToOpen: number;
  reservation: {
    latestRate: number;
    latestCnt: number;
    rateMomentum: number;
    cntMomentum: number;
    inferredFrom: "val_audi" | "rate_assumption" | "fallback_min";
  };
  opening3: number[];
  finalPred: { min: number; max: number; avg: number };
  debug: any;
};

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

const buildUnreleasedModel = (openDate: string, historyData: any[], movieInfo: any): UnreleasedModel => {
  const today = getKST_YYYYMMDD();
  const daysToOpen = openDate && openDate.length === 8 ? daysBetweenUTC(today, openDate) : 0;

  const series = Array.isArray(historyData) ? historyData.slice(-24) : [];
  const rates = series.map((d: any) => safeNum(d.rate, 0));       // %
  const cnts = series.map((d: any) => safeNum(d.val_audi, 0));    // 예매량 또는 유사량

  const latestRate = rates.length ? rates[rates.length - 1] : 0;
  const latestCntRaw = cnts.length ? cnts[cnts.length - 1] : 0;

  const rateMomentum = computeMomentum(rates);
  const cntMomentum = cnts.length >= 2 ? (latestCntRaw - cnts[cnts.length - 2]) : 0;

  const dow = openDate ? dowNameOf(openDate) : "Fri";
  const weekendOpen = (dow === "Fri" || dow === "Sat" || dow === "Sun");

  // 1) 예매량(latestCnt) 확정: val_audi가 유효하면 사용, 아니면 rate로 환산, 그것도 없으면 최소치
  let latestCnt = 0;
  let inferredFrom: UnreleasedModel["reservation"]["inferredFrom"] = "fallback_min";

  if (latestCntRaw > 0) {
    latestCnt = latestCntRaw;
    inferredFrom = "val_audi";
  } else if (latestRate > 0) {
    const pool = weekendOpen ? CFG.ASSUMED_RESERVED_MARKET.weekend : CFG.ASSUMED_RESERVED_MARKET.weekday;
    latestCnt = Math.round(pool * (latestRate / 100));
    inferredFrom = "rate_assumption";
  } else {
    latestCnt = CFG.OPENING_CAP.min; // 0 근처 방지: 최소 앵커
    inferredFrom = "fallback_min";
  }

  // 2) walk-up(현장/당일) 계수
  const baseWalkup = weekendOpen ? CFG.WALKUP.weekendBase : CFG.WALKUP.weekdayBase;
  const momentumAdj = clamp(rateMomentum * CFG.WALKUP.momentumAdjScale, -0.18, 0.25);
  const walkup = clamp(baseWalkup + momentumAdj, CFG.WALKUP.clamp.lo, CFG.WALKUP.clamp.hi);

  // 3) 오프닝데이: reserved * (1 + walkup)
  let openDay = Math.round(latestCnt * (1 + walkup));
  openDay = clamp(openDay, CFG.OPENING_CAP.min, CFG.OPENING_CAP.max);

  // 4) 오프닝 3일: 요일 패턴 prior (데이터 없을 때도 자연스러운 형태 유지)
  const dowMult: Record<DowName, number> = { Mon: 1.00, Tue: 1.00, Wed: 1.05, Thu: 1.12, Fri: 1.38, Sat: 1.95, Sun: 1.75 };
  const d0 = openDate || today;
  const d1 = addDaysUTC(d0, 1);
  const d2 = addDaysUTC(d0, 2);

  // openDay가 d0 기준이니 base로 역산해 d1/d2로 확장
  const base = openDay / (dowMult[dowNameOf(d0)] || 1);
  const o0 = Math.round(base * (dowMult[dowNameOf(d0)] || 1));
  const o1 = Math.round(base * (dowMult[dowNameOf(d1)] || 1));
  const o2 = Math.round(base * (dowMult[dowNameOf(d2)] || 1));

  // 5) 최종 관객: opener3 * legs(genre prior) * rate-adjust(완만)
  const { legs, genreText } = inferLegsByGenre(movieInfo);

  const rateAdj =
    latestRate >= 20 ? 1.18 :
    latestRate >= 10 ? 1.08 :
    latestRate >= 5  ? 1.00 :
    latestRate > 0   ? 0.92 : 0.96;

  const opener3 = o0 + o1 + o2;

  // 개봉일까지 너무 멀면(예: 30일+) 숫자 과장 방지 위해 legs를 약간 눌러서 “리포팅은 하되” 과장은 줄임
  const distanceAdj = daysToOpen >= 30 ? 0.88 : daysToOpen >= 14 ? 0.94 : 1.00;

  const avg = Math.round(opener3 * legs.avg * rateAdj * distanceAdj);
  const min = Math.round(opener3 * legs.min * clamp(rateAdj - 0.06, 0.75, 1.25) * distanceAdj);
  const max = Math.round(opener3 * legs.max * clamp(rateAdj + 0.06, 0.75, 1.35) * distanceAdj);

  return {
    mode: "UNRELEASED",
    openDate: d0,
    daysToOpen,
    reservation: { latestRate, latestCnt, rateMomentum, cntMomentum, inferredFrom },
    opening3: [o0, o1, o2],
    finalPred: { min: Math.min(min, avg), avg, max: Math.max(max, avg) },
    debug: { genreText, legs, walkup, rateAdj, distanceAdj, dows: [dowNameOf(d0), dowNameOf(d1), dowNameOf(d2)] }
  };
};

/** =========================
 *  Handler
 *  ========================= */
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
      historyData,
      productionCost,
      salesAcc,
      audiAcc,
      avgTicketPrice,
      peopleContext, // optional: 사용자가 "검증된" 감독/배우 대표작/성과 텍스트를 넣을 때만
    } = req.body;

    const todayKST = getKST_YYYYMMDD();
    const nowKST = new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" });

    const openDateRaw = (movieInfo?.openDt || "").toString();
    const openDate = (openDateRaw && openDateRaw.length === 8) ? openDateRaw : "";

    const rowsAll = normalizeTrend(trendData);
    const hasDaily = rowsAll.length >= 6;
    const isUnreleased = openDate ? (openDate > todayKST) : (!hasDaily);

    // People (표시/해석용)
    const directors = movieInfo?.directors?.map((d: any) => d.peopleNm).join(", ") || "Unknown Director";
    const actors = movieInfo?.actors?.slice(0, 5).map((a: any) => a.peopleNm).join(", ") || "Unknown Actors";

    // BEP context (있으면)
    let bepContext = "Production cost unknown.";
    if (productionCost && Number(productionCost) > 0) {
      const cost = Number(productionCost);
      const atp = Number(avgTicketPrice || 12000);
      const bepAudi = Math.round(cost / (atp * 0.4));
      const percent = bepAudi > 0 ? ((Number(audiAcc) / bepAudi) * 100).toFixed(1) : "0.0";
      bepContext = `Production Cost: ${Math.round(cost)} KRW. Avg Ticket Price: ${Math.round(atp)} KRW. BEP Target: approx ${bepAudi}. Progress: ${percent}%.`;
    }

    // -------- model outputs (numbers are decided here, not by LLM) --------
    let baseForecast3: number[] = [0, 0, 0];
    let baseFinal = { min: 0, max: 0, avg: 0 };
    let modelSignals: any = {};
    let forecastLabel = "NEXT_3_DAYS";
    let forecastDates = "";

    if (isUnreleased) {
      const inferredOpen = openDate || todayKST; // openDt가 없으면 today 기준 리포팅
      const pre = buildUnreleasedModel(inferredOpen, historyData, movieInfo);
      baseForecast3 = pre.opening3;
      baseFinal = pre.finalPred;
      modelSignals = pre;

      forecastLabel = "OPEN_DAY_PLUS_2";
      const d0 = pre.openDate || inferredOpen;
      const d1 = addDaysUTC(d0, 1);
      const d2 = addDaysUTC(d0, 2);
      forecastDates = `${d0} ${getDayContext(d0)} | ${d1} ${getDayContext(d1)} | ${d2} ${getDayContext(d2)}`;
    } else {
      const rel = buildReleasedModel(trendData, currentAudiAcc);
      baseForecast3 = rel.next3;
      baseFinal = rel.finalPred;
      modelSignals = rel;

      const lastDate = modelSignals?.debug?.lastDate || (rowsAll.length ? rowsAll[rowsAll.length - 1].date : todayKST);
      const d1 = addDaysUTC(lastDate, 1);
      const d2 = addDaysUTC(lastDate, 2);
      const d3 = addDaysUTC(lastDate, 3);
      forecastDates = `${d1} ${getDayContext(d1)} | ${d2} ${getDayContext(d2)} | ${d3} ${getDayContext(d3)}`;
    }

    // -------- Build prompt (LLM은 보고서 문장과 해석만; 숫자는 anchor로 제한) --------
    const rowsForPrompt = rowsAll.slice(-14);
    const recentTrend = rowsForPrompt.length
      ? rowsForPrompt.map((d: any) => {
          const dayContext = getDayContext(d.date);
          return `[${d.date} ${dayContext}] Audi: ${safeNum(d.audiCnt, 0)}, Sales: ${safeNum(d.salesAmt, 0)}, Scrn: ${safeNum(d.scrnCnt, 0)}, Show: ${safeNum(d.showCnt, 0)}`;
        }).join("\n")
      : "No daily trend data";

    const realtimeTrend = Array.isArray(historyData) && historyData.length
      ? historyData.slice(-10).map((d: any) => `[${d.time}] Rank: ${d.rank}, Rate: ${d.rate}%, Audi: ${d.val_audi}`).join("\n")
      : "No realtime/reservation data";

    const prompt = `
Role: Elite Box Office Analyst (Korea) + Senior Data Scientist.

Target Movie: "${movieName}"
Key People:
- Director: ${directors}
- Cast(Top5): ${actors}
${peopleContext ? `\nVerified People Context (provided by user; ground truth):\n${peopleContext}\n` : ""}

Open Date (KOBIS): ${openDate || "Unknown"}
Today (KST): ${todayKST}
Now (KST): ${nowKST}

Financial Context: ${bepContext}

Daily Trend (recent 14 days):
${recentTrend}

Realtime/Reservation Trend (recent 10):
${realtimeTrend}

MODEL MODE:
- Mode: ${isUnreleased ? "UNRELEASED (reservation-based)" : "RELEASED (screen×APS ensemble)"}
- Forecast Label: ${forecastLabel}
- Forecast Dates: ${forecastDates}

HARD ANCHORS (numbers are decided by code; you must stay close):
- Base Forecast (3 numbers): ${JSON.stringify(baseForecast3)}
- Base Final Audience Range: ${JSON.stringify(baseFinal)}
- Model Signals: ${JSON.stringify(modelSignals)}

GUARDRAILS:
- Do NOT invent filmography facts. If unsure and no peopleContext, speak generally.
- Forecast must stay within ±${Math.round(CFG.LLM.maxAdjust * 100)}% of Base Forecast unless you cite explicit evidence from input data (trend/reservation).
- Final audience must remain within Base Final Audience Range.

TASK:
Write 3 short paragraphs in Korean with emojis:
1) Momentum summary with 2+ concrete numbers and weekday/weekend context.
2) People analysis (general, no hallucinated filmography).
3) Strategy & final prediction (include min/max/avg).

Output STRICT JSON only:
{
  "analysis": "Korean string",
  "forecast": [Number, Number, Number],
  "keywords": ["String", "String"],
  "predictedFinalAudi": { "min": Number, "max": Number, "avg": Number }
}
`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", temperature: CFG.LLM.temperature, topP: 0.9 }
    });

    let text = "{}";
    if (response?.candidates?.length) {
      text = response.candidates[0]?.content?.parts?.[0]?.text || "{}";
    }

    let result: any;
    try { result = JSON.parse(cleanJsonString(text)); } catch { result = null; }

    // fallback analysis
    const fallbackAnalysis = isUnreleased
      ? `🎟️ 아직 개봉 전으로 판단되어(개봉일: ${openDate || "미상"}) 예매/실시간 지표 기반으로 오프닝을 산출했습니다.\n` +
        `📈 개봉 3일(개봉일~+2일) 관객 예측: ${baseForecast3.map(n => n.toLocaleString()).join(" / ")}명.\n` +
        `🎯 최종 관객수는 ${baseFinal.min.toLocaleString()}~${baseFinal.max.toLocaleString()}명(중앙 ${baseFinal.avg.toLocaleString()}명) 범위로 추정됩니다.`
      : `📌 현재 누적 관객은 ${safeNum(currentAudiAcc, 0).toLocaleString()}명입니다.\n` +
        `📈 (스크린×APS 앙상블) 다음 3일 예측: ${baseForecast3.map(n => n.toLocaleString()).join(" / ")}명.\n` +
        `🎯 최종 관객수는 ${baseFinal.min.toLocaleString()}~${baseFinal.max.toLocaleString()}명(중앙 ${baseFinal.avg.toLocaleString()}명) 범위로 추정됩니다.`;

    const analysisText = result?.analysis || fallbackAnalysis;

    // clamp forecast around base (과장/과소 방지)
    const forecast = Array.isArray(result?.forecast) && result.forecast.length === 3
      ? result.forecast.map((x: any, i: number) => Math.round(
          clamp(
            safeNum(x, baseForecast3[i]),
            baseForecast3[i] * CFG.LLM.minAdjust,
            baseForecast3[i] * (1 + CFG.LLM.maxAdjust)
          )
        ))
      : baseForecast3;

    // clamp final inside base range
    const predictedFinalAudi = result?.predictedFinalAudi?.avg
      ? {
          min: Math.round(clamp(safeNum(result.predictedFinalAudi.min, baseFinal.min), baseFinal.min, baseFinal.max)),
          max: Math.round(clamp(safeNum(result.predictedFinalAudi.max, baseFinal.max), baseFinal.min, baseFinal.max)),
          avg: Math.round(clamp(safeNum(result.predictedFinalAudi.avg, baseFinal.avg), baseFinal.min, baseFinal.max)),
        }
      : baseFinal;

    const keywords = Array.isArray(result?.keywords) && result.keywords.length
      ? result.keywords.slice(0, 2)
      : [movieName, isUnreleased ? "예매율" : "박스오피스"];

    return res.status(200).json({
      analysisText,
      predictionSeries: forecast,
      searchKeywords: keywords,
      predictedFinalAudi,
      forecastLabel,
      forecastDates,
      modelSignals,
    });

  } catch (error: any) {
    console.error("AI Error:", error);
    return res.status(200).json({
      analysisText: `오류: ${error?.message || "unknown"}`,
      predictionSeries: [0, 0, 0],
      predictedFinalAudi: { min: 0, max: 0, avg: 0 },
    });
  }
}
