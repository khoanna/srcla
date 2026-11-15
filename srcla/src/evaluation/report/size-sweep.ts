/**
 * The NON-GATING vault-size sweep: SRCLA and B0–B5 at twenty vault sizes
 * between 10,000 and 10,000,000 USDC.
 *
 * WHY IT EXISTS. §11.1 registers exactly four tiers (10k / 100k / 1M / 10M)
 * and every gate is scored on those alone. Four points across three decades
 * cannot show WHERE a capacity limit falls: the behaviour worth seeing lives
 * inside the 1M–10M step, which the registered grid crosses at once. This
 * sweep fills the grid in for figures and tables. It decides nothing — no
 * gate, verdict or registered number reads it — and it runs the same decide
 * path as the registered run (`runRegisteredEvaluation`), one tier at a time.
 *
 * WHY IT CHECKS ITSELF. At stride 1 the sweep replays exactly what the
 * registered run replayed, so at the four registered tiers its numbers must
 * equal the published run record. `compareWithRegistered` tests that and
 * reports every disagreement rather than throwing, so a drift between the
 * sweep and the registered result is printed, not hidden.
 *
 * Persisted as `report/chart/SRCLA-SIZE-SWEEP-<era>.json`; the figures are
 * drawn from that object, so `pnpm figures:render` can redraw them without a
 * replay. Unlike the FIGURE_TIERS sweep in `charts.ts`, which draws FIG1–FIG3,
 * this one is not produced by `run-phase4.ts` and changes nothing it writes
 * except its own `## Vault-size sweep (non-gating)` section of the report.
 *
 * PURE: builds strings and objects. The caller does the I/O.
 */
import { REGISTERED_TIERS, type PolicyRunResult } from '../kernel/harness.js';
import { REGISTERED_MAX_VENUE_STRESS_SHARE } from '../kernel/sustainability.js';
import { lineChart, niceDomain, tickStep, type ChartSeries, type ReportFigure } from './charts.js';

/** Twenty vault sizes, USDC base units (6 dp). Contains the four registered tiers. */
export const SIZE_SWEEP_TIERS: bigint[] = [
  10_000n, 15_000n, 25_000n, 50_000n, 75_000n, 100_000n, 150_000n, 250_000n, 500_000n, 750_000n,
  1_000_000n, 1_500_000n, 2_000_000n, 2_500_000n, 3_000_000n, 4_000_000n, 5_000_000n, 6_500_000n,
  8_000_000n, 10_000_000n,
].map((t) => t * 1_000_000n);

/** SRCLA and every §11.2 baseline. B0 is idle by definition; B2u and B5 are diagnostics. */
export const SIZE_SWEEP_POLICIES = ['srcla', 'b0', 'b1', 'b2', 'b2u', 'b3', 'b4', 'b5'];

/** The section heading, and the anchor the section is inserted before. */
export const SIZE_SWEEP_HEADING = '## Vault-size sweep (non-gating)';
const LIMITATIONS_HEADING = '## Limitations';

/** A yield-on-deployed point below this capital at work is a ratio of two near-zeros; not drawn. */
const MIN_CAPITAL_FOR_YIELD_ON_DEPLOYED = 0.05;

/**
 * The replay harness's disclosed limitation, stated wherever capital at work or
 * stressed coverage is shown.
 */
export const ADD_YIELD_DISCLOSURE =
  'The replay credits accrued yield to total assets only, never to venue balances, so capital at ' +
  'work is overstated and stressed coverage understated for every policy.';

/** Yield on deployed capital as shown (figure 4 and the SRCLA table): `null` below the capital threshold. */
export function shownYieldOnDeployed(r: SizeSweepRow): number | null {
  return r.yieldOnDeployed === null || r.capitalAtWork === null || r.capitalAtWork < MIN_CAPITAL_FOR_YIELD_ON_DEPLOYED
    ? null
    : r.yieldOnDeployed;
}

/** The size figures' filename slugs, in figure order. */
export const SIZE_FIGURE_SLUGS = [
  'net-apy',
  'min-coverage',
  'capital-at-work',
  'yield-on-deployed',
  'rebalances',
  'displayed-minus-realized',
  'max-venue-share',
  'p05-coverage',
] as const;

/** Float tolerance for the registered-tier check. The replay is deterministic. */
const CHECK_TOLERANCE = 1e-12;

/** One policy at one vault size. Money in whole USDC; rates and shares as fractions. */
export interface SizeSweepRow {
  policyId: string;
  tierUsd: number;
  netApy: number;
  /** Time-weighted fraction of NAV deployed; `null` when the replay did not measure it. */
  capitalAtWork: number | null;
  /** `netApy / capitalAtWork`; `null` when nothing was deployed. */
  yieldOnDeployed: number | null;
  rebalances: number;
  turnoverUsdc: number;
  costsUsdc: number;
  /** Exact turnover and costs in USDC base units, as decimal strings. Absent in older sweeps. */
  turnoverBase?: string;
  costsBase?: string;
  /** `null` when no redemption was attempted. */
  withdrawalSuccessRate: number | null;
  coverageMin: number;
  coverageP05: number;
  coverageMedian: number;
  /** `null` when the vault did not fully exit inside the window. */
  fullExitOrigins: number | null;
  fullExitCensored: boolean;
  /** The largest share of any venue the vault itself was (S3); `null` when it held no venue. */
  maxVenueShare: number | null;
  maxVenueShareMarket: string | null;
  /** Deployed-weighted advertised APY minus realized net APY. */
  displayedMinusRealizedApy: number;
}

export interface RegisteredTierMismatch {
  /** `'*'` for a run-level mismatch (artifact, dataset window, gas series). */
  policyId: string;
  /** 0 for a run-level mismatch. */
  tierUsd: number;
  /** A compared field, `'missing'` (no registered row for a swept pair) or a run-level field. */
  field: string;
  sweep: number | string | boolean | null;
  registered: number | string | boolean | null;
}

export interface RegisteredTierCheck {
  checked: boolean;
  /** The file(s) compared against; `null` when nothing was compared. */
  source: string | null;
  /** (policy, tier) pairs compared. */
  compared: number;
  mismatches: RegisteredTierMismatch[];
  /** Why the check did not run, when `checked` is false. Absent in sweeps written before it existed. */
  reason?: string | null;
  /** Caveats on how fields were compared (e.g. whole-USDC money on an older sweep JSON). */
  notes?: string[];
}

export interface SizeSweep {
  kind: 'size-sweep';
  era: string;
  /** Every Nth origin of the era was replayed. */
  stride: number;
  s2CoverageFloor: number;
  warning: string | null;
  codeCommit: string;
  artifactHash: string;
  generatedAt: string;
  /** Origins replayed (after the stride), and the era window actually loaded. */
  origins: number;
  datasetStart: string;
  datasetEnd: string;
  /** Digest of the measured gas series the harness config carried. Absent in older sweeps. */
  gasDigest?: string;
  rows: SizeSweepRow[];
  registeredTierCheck: RegisteredTierCheck;
}

const baseToUsdc = (base: bigint): number => Number(base) / 1e6;

export function sizeSweepRowsFrom(results: readonly PolicyRunResult[]): SizeSweepRow[] {
  return results.map((r) => {
    const replay = r.replay;
    const capital = (replay.capitalAtWorkFraction as number | null | undefined) ?? null;
    const shares = Object.entries(replay.venueStressContribution ?? {});
    let worst: [string, number] | null = null;
    for (const [market, share] of shares) {
      if (worst === null || share > worst[1]) worst = [market, share];
    }
    return {
      policyId: r.policy.id,
      tierUsd: Number(r.tier / 1_000_000n),
      netApy: replay.realizedNetApy,
      capitalAtWork: capital,
      yieldOnDeployed: capital !== null && capital > 0 ? replay.realizedNetApy / capital : null,
      rebalances: r.rebalances,
      turnoverUsdc: baseToUsdc(replay.totalTurnover),
      costsUsdc: baseToUsdc(replay.totalCosts),
      turnoverBase: replay.totalTurnover.toString(),
      costsBase: replay.totalCosts.toString(),
      withdrawalSuccessRate: replay.withdrawalSuccessRate ?? null,
      coverageMin: replay.coverageDistribution.min,
      coverageP05: replay.coverageDistribution.p05,
      coverageMedian: replay.coverageDistribution.median,
      fullExitOrigins: replay.timeToFullExitOrigins ?? null,
      fullExitCensored: replay.timeToFullExitCensored,
      maxVenueShare: worst?.[1] ?? null,
      maxVenueShareMarket: worst?.[0] ?? null,
      displayedMinusRealizedApy: replay.displayedVsRealizedGapApy,
    };
  });
}

interface RegisteredRow {
  policyId: string;
  tierUsd: number;
  /** Each field is `undefined` when the source does not carry it. */
  netApy?: number;
  capitalAtWork?: number;
  coverageMin?: number;
  rebalances?: number;
  turnoverBase?: string;
  costsBase?: string;
  withdrawalSuccessRate?: number | null;
  fullExitOrigins?: number | null;
  fullExitCensored?: boolean;
  displayedMinusRealizedApy?: number;
}

interface NormalisedSource {
  found: boolean;
  artifactHash: string | undefined;
  datasetStart: string | undefined;
  datasetEnd: string | undefined;
  origins: number | undefined;
  gasDigest: string | undefined;
  rows: RegisteredRow[];
}

type Json = Record<string, unknown>;

const has = (r: Json, k: string): boolean => Object.prototype.hasOwnProperty.call(r, k);

/** A run record (`evaluation-<era>.json`) or a `SRCLA-REPORT.json` run, reduced to what is compared. */
function normaliseSource(source: unknown, era: string | undefined): NormalisedSource {
  const obj = (source ?? {}) as Json;
  const out: NormalisedSource = {
    found: false,
    artifactHash: undefined,
    datasetStart: undefined,
    datasetEnd: undefined,
    origins: undefined,
    gasDigest: undefined,
    rows: [],
  };
  let results: Json[] = [];
  if (obj.record !== undefined) {
    const record = obj.record as Json;
    const res = (record.results ?? {}) as Json;
    results = (res.results as Json[] | undefined) ?? [];
    out.found = true;
    out.artifactHash = res.artifactHash as string | undefined;
    const dataset = ((record.manifest as Json | undefined)?.dataset ?? {}) as Json;
    out.datasetStart = dataset.startDate as string | undefined;
    out.datasetEnd = dataset.endDate as string | undefined;
    // One share price per replayed origin.
    const prices = results[0]?.sharePricesWad;
    if (Array.isArray(prices)) out.origins = prices.length;
  } else if (Array.isArray(obj.runs)) {
    const run = (obj.runs as Json[]).find((r) => era === undefined || r.era === era);
    if (run !== undefined) {
      out.found = true;
      results = (run.results as Json[] | undefined) ?? [];
      out.artifactHash = run.artifactHash as string | undefined;
      if (typeof run.origins === 'number') out.origins = run.origins;
      const digest = (run.provenance as Json | undefined)?.gasSeriesDigest;
      if (typeof digest === 'string') out.gasDigest = digest;
    }
  }
  out.rows = results.map((r) => {
    const row: RegisteredRow = {
      policyId: String(r.policyId),
      tierUsd: Number(BigInt(String(r.tier)) / 1_000_000n),
    };
    if (typeof r.realizedNetApy === 'number') row.netApy = r.realizedNetApy;
    if (typeof r.capitalAtWorkFraction === 'number') row.capitalAtWork = r.capitalAtWorkFraction;
    if (typeof r.minStressedLiquidCoverage === 'number') row.coverageMin = r.minStressedLiquidCoverage;
    if (typeof r.rebalances === 'number') row.rebalances = r.rebalances;
    if (typeof r.totalTurnoverBase === 'string') row.turnoverBase = r.totalTurnoverBase;
    if (typeof r.totalCostsBase === 'string') row.costsBase = r.totalCostsBase;
    if (has(r, 'withdrawalSuccessRate')) row.withdrawalSuccessRate = r.withdrawalSuccessRate as number | null;
    if (has(r, 'timeToFullExitOrigins')) row.fullExitOrigins = r.timeToFullExitOrigins as number | null;
    if (typeof r.timeToFullExitCensored === 'boolean') row.fullExitCensored = r.timeToFullExitCensored;
    if (typeof r.displayedVsRealizedGapApy === 'number') row.displayedMinusRealizedApy = r.displayedVsRealizedGapApy;
    return row;
  });
  return out;
}

export interface RegisteredExpectation {
  era?: string;
  artifactHash?: string;
  datasetStart?: string;
  datasetEnd?: string;
  origins?: number;
  gasDigest?: string;
}

/** Whole-USDC tolerance used when an older sweep JSON has no base-unit money to compare exactly. */
const USDC_TOLERANCE = 1e-6;
export const WHOLE_USDC_NOTE =
  'turnover and costs compared in whole USDC to 1e-6 (this sweep JSON predates base-unit fields), not exactly';

/**
 * Compare the sweep with a registered result at the registered tiers. `source`
 * is a run record (`evaluation-<era>.json`) or `SRCLA-REPORT.json` (whose run
 * for `expect.era` is used). Every field the source carries is compared:
 * net APY, capital at work, minimum coverage, rebalances, exact turnover and
 * costs in base units, withdrawal success, full-exit origins and censoring,
 * and the displayed-minus-realized gap.
 *
 * Never throws on a disagreement. A swept registered pair with no source row is
 * a `missing` mismatch. A different dataset window is ONE run-level mismatch
 * and no pair is compared, since nothing about the pairs could agree.
 */
export function compareWithRegistered(
  rows: readonly SizeSweepRow[],
  source: unknown,
  expect: RegisteredExpectation = {},
): { compared: number; mismatches: RegisteredTierMismatch[]; notes: string[] } {
  const src = normaliseSource(source, expect.era);
  const mismatches: RegisteredTierMismatch[] = [];
  const notes: string[] = [];
  const runLevel = (field: string, sweep: string | number, registered: string | number) =>
    mismatches.push({ policyId: '*', tierUsd: 0, field, sweep, registered });

  if (expect.artifactHash !== undefined && src.artifactHash !== undefined && expect.artifactHash !== src.artifactHash) {
    runLevel('artifactHash', expect.artifactHash, src.artifactHash);
  }
  if (expect.gasDigest !== undefined && src.gasDigest !== undefined && expect.gasDigest !== src.gasDigest) {
    runLevel('gasSeriesDigest', expect.gasDigest, src.gasDigest);
  }
  const differs = <T>(a: T | undefined, b: T | undefined) => a !== undefined && b !== undefined && a !== b;
  if (
    differs(expect.datasetStart, src.datasetStart) ||
    differs(expect.datasetEnd, src.datasetEnd) ||
    differs(expect.origins, src.origins)
  ) {
    const show = (start?: string, end?: string, origins?: number) =>
      `${start ?? '?'} -> ${end ?? '?'} (${origins ?? '?'} origins)`;
    runLevel(
      'datasetWindow',
      `dataset window differs: sweep ${show(expect.datasetStart, expect.datasetEnd, expect.origins)}`,
      show(src.datasetStart, src.datasetEnd, src.origins),
    );
    return { compared: 0, mismatches, notes };
  }

  const registeredTiers = new Set(REGISTERED_TIERS.map((t) => Number(t / 1_000_000n)));
  let compared = 0;
  let approxMoney = false;
  for (const row of rows) {
    if (!registeredTiers.has(row.tierUsd)) continue;
    const at = { policyId: row.policyId, tierUsd: row.tierUsd };
    const reg = src.rows.find((r) => r.policyId === row.policyId && r.tierUsd === row.tierUsd);
    if (reg === undefined) {
      mismatches.push({ ...at, field: 'missing', sweep: 'swept', registered: null });
      continue;
    }
    compared += 1;
    const float = (field: string, sweep: number | null, registered: number | null | undefined, tol = CHECK_TOLERANCE) => {
      if (registered === undefined) return;
      const agree =
        sweep === null || registered === null ? sweep === registered : Math.abs(sweep - registered) <= tol;
      if (!agree) mismatches.push({ ...at, field, sweep, registered });
    };
    const exact = (field: string, sweep: number | string | boolean | null, registered: typeof sweep | undefined) => {
      if (registered === undefined) return;
      if (sweep !== registered) mismatches.push({ ...at, field, sweep, registered });
    };
    float('netApy', row.netApy, reg.netApy);
    float('capitalAtWork', row.capitalAtWork, reg.capitalAtWork);
    float('coverageMin', row.coverageMin, reg.coverageMin);
    exact('rebalances', row.rebalances, reg.rebalances);
    const money = (field: string, base: string | undefined, usdc: number, registered: string | undefined) => {
      if (registered === undefined) return;
      if (base !== undefined) {
        exact(field, base, registered);
      } else {
        approxMoney = true;
        float(field, usdc, Number(BigInt(registered)) / 1e6, USDC_TOLERANCE);
      }
    };
    money('turnoverBase', row.turnoverBase, row.turnoverUsdc, reg.turnoverBase);
    money('costsBase', row.costsBase, row.costsUsdc, reg.costsBase);
    float('withdrawalSuccessRate', row.withdrawalSuccessRate, reg.withdrawalSuccessRate);
    exact('fullExitOrigins', row.fullExitOrigins, reg.fullExitOrigins);
    exact('fullExitCensored', row.fullExitCensored, reg.fullExitCensored);
    float('displayedMinusRealizedApy', row.displayedMinusRealizedApy, reg.displayedMinusRealizedApy);
  }
  if (approxMoney) notes.push(WHOLE_USDC_NOTE);
  return { compared, mismatches, notes };
}

/** One registered source file, already parsed. */
export interface RegisteredSource {
  path: string;
  json: unknown;
}

/**
 * The registered-tier check over every available source, merged: mismatches
 * deduplicated by (policy, tier, field), `compared` the most pairs any source
 * compared. Sources that do not hold `era` are skipped. At a stride above 1,
 * or with no source, the check is NOT run and says why.
 */
export function registeredTierCheckFrom(args: {
  rows: readonly SizeSweepRow[];
  stride: number;
  expect: RegisteredExpectation & { era: string };
  sources: readonly RegisteredSource[];
}): RegisteredTierCheck {
  const { rows, stride, expect } = args;
  if (stride !== 1) {
    return {
      checked: false,
      source: null,
      compared: 0,
      mismatches: [],
      reason: `stride ${stride}: the sweep replays a subset of origins and cannot equal the registered run`,
      notes: [],
    };
  }
  const usable = args.sources.filter((s) => normaliseSource(s.json, expect.era).found);
  if (usable.length === 0) {
    return {
      checked: false,
      source: null,
      compared: 0,
      mismatches: [],
      reason: `no registered result for \`${expect.era}\` was found (evaluation-${expect.era}.json or SRCLA-REPORT.json)`,
      notes: [],
    };
  }
  const key = (m: RegisteredTierMismatch) => `${m.policyId}|${m.tierUsd}|${m.field}`;
  const seen = new Set<string>();
  const mismatches: RegisteredTierMismatch[] = [];
  const notes = new Set<string>();
  let compared = 0;
  for (const s of usable) {
    const out = compareWithRegistered(rows, s.json, expect);
    compared = Math.max(compared, out.compared);
    for (const m of out.mismatches) {
      if (seen.has(key(m))) continue;
      seen.add(key(m));
      mismatches.push(m);
    }
    for (const n of out.notes) notes.add(n);
  }
  return {
    checked: true,
    source: usable.map((s) => s.path).join(' + '),
    compared,
    mismatches,
    reason: null,
    notes: [...notes],
  };
}

/**
 * A value axis for data that may go below zero, with zero on a tick. For
 * non-negative data it is `niceDomain` anchored at zero.
 */
export function signedDomain(min: number, max: number): { min: number; max: number } {
  if (min >= 0) return niceDomain(min, max, true);
  const top = Math.max(max, 0);
  let step = tickStep(top - min);
  for (let i = 0; i < 8; i++) {
    const lo = Math.floor(min / step - 1e-9) * step;
    const hi = Math.ceil(top / step - 1e-9) * step;
    const next = tickStep(hi - lo);
    if (Math.abs(next - step) < step * 1e-9) {
      return { min: Number(lo.toPrecision(12)), max: Number((hi === lo ? lo + step : hi).toPrecision(12)) };
    }
    step = next;
  }
  const lo = Math.floor(min / step - 1e-9) * step;
  return { min: Number(lo.toPrecision(12)), max: Number((Math.ceil(top / step - 1e-9) * step).toPrecision(12)) };
}

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

const policyName = (id: string): string => (id === 'srcla' ? 'SRCLA' : id === 'b2u' ? 'B2u' : id.toUpperCase());

const usdLabel = (usd: number): string => {
  if (usd >= 1e6) return `$${usd / 1e6}M`;
  if (usd >= 1e3) return `$${usd / 1e3}k`;
  return `$${usd}`;
};

function seriesOf(sweep: SizeSweep, value: (r: SizeSweepRow) => number | null): ChartSeries[] {
  const out: ChartSeries[] = [];
  for (const id of SIZE_SWEEP_POLICIES) {
    const points = sweep.rows
      .filter((r) => r.policyId === id)
      .map((r) => ({ tier: r.tierUsd, value: value(r) }))
      .filter((p): p is { tier: number; value: number } => p.value !== null && Number.isFinite(p.value))
      .sort((a, b) => a.tier - b.tier);
    if (points.length > 0) out.push({ policyId: id, points });
  }
  return out;
}

const valuesOf = (series: ChartSeries[]): number[] => series.flatMap((s) => s.points.map((p) => p.value));
const minOf = (series: ChartSeries[]): number => Math.min(0, ...valuesOf(series));
const maxOf = (series: ChartSeries[]): number => Math.max(0, ...valuesOf(series));

/** The eight size-sweep figures, drawn from the persisted sweep. */
export function sizeSweepFigures(sweep: SizeSweep): ReportFigure[] {
  const { era, stride, s2CoverageFloor } = sweep;
  const warning = sweep.warning ?? undefined;
  const sizes = new Set(sweep.rows.map((r) => r.tierUsd)).size;
  const markerTiers = REGISTERED_TIERS.map((t) => Number(t / 1_000_000n));
  const cadence = stride > 1 ? `every ${ordinal(stride)} origin` : 'every origin';
  const subtitle = [
    `Sealed era ${era}`,
    `${sizes} vault sizes`,
    cadence,
    `large markers at the ${markerTiers.length} registered tiers`,
    'non-gating',
  ].join(' · ');
  const provenance =
    ` Non-gating: ${sizes} vault sizes on ${cadence} of era \`${era}\`, through the same decide ` +
    'path as the registered run. Gates are scored only at §11.1\'s four registered tiers (the ' +
    'large markers); every other point is supplementary.';
  const pctFmt = (dp: number) => (v: number) => `${Number(v.toFixed(dp))}%`;

  const apy = seriesOf(sweep, (r) => r.netApy * 100);
  const coverage = seriesOf(sweep, (r) => r.coverageMin);
  const capital = seriesOf(sweep, (r) => (r.capitalAtWork === null ? null : r.capitalAtWork * 100));
  const yieldDeployed = seriesOf(sweep, (r) => {
    const y = shownYieldOnDeployed(r);
    return y === null ? null : y * 100;
  });
  const rebalances = seriesOf(sweep, (r) => r.rebalances);
  const gap = seriesOf(sweep, (r) => r.displayedMinusRealizedApy * 100);
  const venueShare = seriesOf(sweep, (r) => r.maxVenueShare);
  const coverageP05 = seriesOf(sweep, (r) => r.coverageP05);

  const apyAxis = signedDomain(minOf(apy), maxOf(apy));
  const capitalAxis = niceDomain(0, Math.max(maxOf(capital), 1), true);
  const yieldAxis = signedDomain(minOf(yieldDeployed), maxOf(yieldDeployed));
  const rebalanceAxis = niceDomain(0, Math.max(maxOf(rebalances), 1), true);
  const gapAxis = signedDomain(minOf(gap), maxOf(gap));
  const shareAxis = niceDomain(0, Math.max(maxOf(venueShare), REGISTERED_MAX_VENUE_STRESS_SHARE * 1.2), true);
  const coverageMax = (s: ChartSeries[]) => Math.max(1, maxOf(s));
  const zeroLine = (axis: { min: number }) =>
    axis.min < 0 ? { floor: { value: 0, label: 'zero' } } : {};
  const warned = warning === undefined ? {} : { warning };
  const warnedCaption = warning === undefined ? '' : ` **${warning}**`;
  const slug = (n: number, name: (typeof SIZE_FIGURE_SLUGS)[number]) => `SRCLA-SIZE-FIG${n}-${name}-${era}.svg`;

  const figures: (ReportFigure | null)[] = [
    {
      filename: slug(1, 'net-apy'),
      svg: lineChart({
        title: 'Realized net APY by vault size',
        subtitle,
        yLabel: 'Realized net APY (%)',
        series: apy,
        yMin: apyAxis.min,
        yMax: apyAxis.max,
        yFormat: pctFmt(2),
        markerTiers,
        everyTier: true,
        ...zeroLine(apyAxis),
        ...warned,
      }),
      caption:
        `**Size figure 1 — Net APY across ${sizes} vault sizes.** Where between the registered tiers ` +
        'each policy\'s realized return falls off. Read with size figures 2 and 3: a return ' +
        'that holds up by becoming unredeemable is not capacity.' +
        warnedCaption +
        provenance,
    },
    {
      filename: slug(2, 'min-coverage'),
      svg: lineChart({
        title: 'Minimum stressed liquid coverage by vault size',
        subtitle,
        yLabel: 'Minimum stressed liquid coverage',
        series: coverage,
        yMax: coverageMax(coverage),
        yFormat: (v) => v.toFixed(1),
        floor: { value: s2CoverageFloor, label: `S2 release floor (${s2CoverageFloor})` },
        markerTiers,
        everyTier: true,
      }),
      caption:
        `**Size figure 2 — Minimum stressed liquid coverage across ${sizes} vault sizes.** The worst ` +
        'origin\'s coverage against the S2 floor; the sweep brackets the size range where each ' +
        `policy first falls below the S2 floor (${sizes} discrete sizes). ` +
        ADD_YIELD_DISCLOSURE +
        provenance,
    },
    {
      filename: slug(3, 'capital-at-work'),
      svg: lineChart({
        title: 'Capital at work by vault size',
        subtitle,
        yLabel: 'Time-weighted capital at work (%)',
        series: capital,
        yMin: capitalAxis.min,
        yMax: capitalAxis.max,
        yFormat: (v) => `${Math.round(v)}%`,
        markerTiers,
        everyTier: true,
      }),
      caption:
        `**Size figure 3 — Capital at work across ${sizes} vault sizes.** The share of NAV deployed, ` +
        'time-weighted. A falling line means the vault is holding cash, not earning a lower ' +
        'rate; B0 is idle by definition. ' +
        ADD_YIELD_DISCLOSURE +
        provenance,
    },
    {
      filename: slug(4, 'yield-on-deployed'),
      svg: lineChart({
        title: 'Yield on deployed capital by vault size',
        subtitle,
        yLabel: 'Net APY ÷ capital at work (%)',
        series: yieldDeployed,
        yMin: yieldAxis.min,
        yMax: yieldAxis.max,
        yFormat: pctFmt(2),
        markerTiers,
        everyTier: true,
        ...zeroLine(yieldAxis),
        ...warned,
      }),
      caption:
        `**Size figure 4 — Yield on deployed capital across ${sizes} vault sizes.** Net APY divided ` +
        'by capital at work: the rate earned on the money actually deployed, separating a ' +
        'worse rate from more idle cash. Not drawn where capital at work is below ' +
        `${MIN_CAPITAL_FOR_YIELD_ON_DEPLOYED * 100}% (a ratio of two near-zeros), so B0 has no line. ` +
        'Costs are charged against NAV, so this is an approximation, not a venue rate.' +
        warnedCaption +
        provenance,
    },
    {
      filename: slug(5, 'rebalances'),
      svg: lineChart({
        title: 'Rebalances by vault size',
        subtitle,
        yLabel: 'Origins with a rebalance',
        series: rebalances,
        yMin: rebalanceAxis.min,
        yMax: rebalanceAxis.max,
        yFormat: (v) => `${Math.round(v)}`,
        markerTiers,
        everyTier: true,
      }),
      caption:
        `**Size figure 5 — Rebalances across ${sizes} vault sizes.** Origins at which the policy ` +
        'moved funds, over the replayed origins of the era.' +
        provenance,
    },
    {
      filename: slug(6, 'displayed-minus-realized'),
      svg: lineChart({
        title: 'Displayed minus realized APY by vault size',
        subtitle,
        yLabel: 'Displayed − realized APY (pp)',
        series: gap,
        yMin: gapAxis.min,
        yMax: gapAxis.max,
        yFormat: (v) => `${Number(v.toFixed(2))}`,
        markerTiers,
        everyTier: true,
        ...zeroLine(gapAxis),
        ...warned,
      }),
      caption:
        `**Size figure 6 — Displayed minus realized APY across ${sizes} vault sizes**, in percentage ` +
        'points. The deployed-weighted advertised rate minus the net return kept; positive ' +
        'means the displayed rate over-promised.' +
        warnedCaption +
        provenance,
    },
    // The archive snapshots carry no venue total assets, so the replay cannot
    // measure a venue share (the registered table prints "—" for the same
    // reason). An empty chart is not drawn; the section says why.
    venueShare.length === 0 ? null : {
      filename: slug(7, 'max-venue-share'),
      svg: lineChart({
        title: 'Largest share of a venue held, by vault size',
        subtitle,
        yLabel: 'Max share of a venue the vault was',
        series: venueShare,
        yMin: shareAxis.min,
        yMax: shareAxis.max,
        yFormat: (v) => v.toFixed(2),
        floor: {
          value: REGISTERED_MAX_VENUE_STRESS_SHARE,
          label: `S3 threshold (${REGISTERED_MAX_VENUE_STRESS_SHARE})`,
        },
        markerTiers,
        everyTier: true,
      }),
      caption:
        `**Size figure 7 — Largest venue share across ${sizes} vault sizes.** The largest share of ` +
        'any single venue the vault itself was, at any origin, against S3\'s ' +
        `${REGISTERED_MAX_VENUE_STRESS_SHARE} threshold. B0 holds no venue and has no line.` +
        provenance,
    },
    {
      filename: slug(8, 'p05-coverage'),
      svg: lineChart({
        title: '5th-percentile stressed liquid coverage by vault size',
        subtitle,
        yLabel: 'p05 stressed liquid coverage',
        series: coverageP05,
        yMax: coverageMax(coverageP05),
        yFormat: (v) => v.toFixed(1),
        floor: { value: s2CoverageFloor, label: `S2 release floor (${s2CoverageFloor})` },
        markerTiers,
        everyTier: true,
      }),
      caption:
        `**Size figure 8 — 5th-percentile stressed liquid coverage across ${sizes} vault sizes.** ` +
        'Distinguishes a single bad hour (size figure 2 low, this high) from chronic ' +
        'illiquidity (both low). S2 grades the minimum, not this percentile. ' +
        ADD_YIELD_DISCLOSURE +
        provenance,
    },
  ];
  return figures.filter((f): f is ReportFigure => f !== null);
}

const pct = (v: number | null, dp = 2): string => (v === null ? '—' : `${(v * 100).toFixed(dp)}%`);
const num = (v: number, dp = 3): string => v.toFixed(dp);

function checkLines(sweep: SizeSweep): string[] {
  const c = sweep.registeredTierCheck;
  const head = `**Registered-tier consistency (\`${sweep.era}\`):**`;
  if (!c.checked) {
    const reason =
      c.reason ??
      (sweep.stride > 1
        ? `stride ${sweep.stride}: the sweep replays a subset of origins and cannot equal the registered run`
        : 'no registered result was found to compare against');
    return [`${head} **NOT CHECKED** — ${reason}.`];
  }
  const n = c.mismatches.length;
  const noun = `${n} ${n === 1 ? 'mismatch' : 'mismatches'}`;
  const out: string[] = [];
  if (c.compared === 0) {
    out.push(
      `${head} **nothing compared** — no (policy, tier) pair at the registered tiers was compared ` +
        `against \`${c.source}\`, so this is not evidence of agreement (${noun} at run level).`,
    );
  } else {
    out.push(
      `${head} ${c.compared} (policy, tier) pairs at the registered tiers compared against ` +
        `\`${c.source}\` — **${noun}**` +
        (n === 0 ? ', as expected of the same deterministic replay.' : '.'),
    );
  }
  for (const note of c.notes ?? []) out.push('', `Note: ${note}.`);
  if (n > 0) {
    out.push('');
    for (const m of c.mismatches) {
      out.push(
        `- \`${m.policyId}\` at ${m.tierUsd === 0 ? 'run level' : usdLabel(m.tierUsd)}: ${m.field} ` +
          `sweep ${String(m.sweep)} vs registered ${String(m.registered)}`,
      );
    }
  }
  return out;
}

/** The `## Vault-size sweep (non-gating)` report section, one block per era. */
export function renderSizeSweepSection(
  sweeps: readonly SizeSweep[],
  figuresByEra: Readonly<Record<string, readonly { filename: string; caption: string }[]>>,
): string[] {
  const out: string[] = [SIZE_SWEEP_HEADING, ''];
  out.push(
    'Supplementary and **non-gating**. §11.1 registers four vault tiers and every gate and verdict ' +
      'above is scored on those four alone; four points across three decades cannot show where a ' +
      'capacity limit falls, and the interesting behaviour lives between them, above all inside ' +
      'the 1M–10M step. This section replays SRCLA and baselines B0–B5 at up to 20 vault sizes ' +
      'through the same decide path as the registered run (`runRegisteredEvaluation`), on every ' +
      'Nth origin of the era as stated per era. Nothing here changes a gate, a verdict or a ' +
      'registered number. B0 holds idle USDC by definition; B2u and B5 are labelled diagnostics ' +
      '(B5 is bounded hindsight, a non-deployable upper bound), not deployable comparators. ' +
      ADD_YIELD_DISCLOSURE,
  );
  out.push('');

  for (const sweep of sweeps) {
    const sizes = [...new Set(sweep.rows.map((r) => r.tierUsd))].sort((a, b) => a - b);
    const policies = SIZE_SWEEP_POLICIES.filter((p) => sweep.rows.some((r) => r.policyId === p));
    out.push(`### Era \`${sweep.era}\``);
    out.push('');
    out.push(
      `${sizes.length} vault sizes × ${policies.length} policies on ` +
        `${sweep.stride > 1 ? `every ${ordinal(sweep.stride)} origin` : 'every origin'} ` +
        `(${sweep.origins} origins, ${sweep.datasetStart} → ${sweep.datasetEnd}); artifact ` +
        `\`${sweep.artifactHash.slice(0, 16)}…\`, code \`${sweep.codeCommit.slice(0, 8)}\`, generated ${sweep.generatedAt}.`,
    );
    out.push('');
    if (sweep.warning !== null) {
      out.push(`> **${sweep.warning}**`);
      out.push('');
    }
    out.push(...checkLines(sweep));
    out.push('');
    if (sweep.rows.every((r) => r.maxVenueShare === null)) {
      out.push(
        '**Max venue share was not measured** for any policy at any size: the archive snapshots carry ' +
          'no venue total assets, so the replay has no denominator (the registered tables print "—" for ' +
          'the same reason). Size figure 7 is therefore not drawn for this era.',
      );
      out.push('');
    }

    const srcla = sweep.rows.filter((r) => r.policyId === 'srcla').sort((a, b) => a.tierUsd - b.tierUsd);
    if (srcla.length > 0) {
      out.push(`**SRCLA across vault sizes (\`${sweep.era}\`).** Registered tiers in bold.`);
      out.push('');
      out.push(
        '| Size | Net APY | Capital at work | Yield on deployed | Min coverage | p05 coverage | Rebalances | Displayed − realized | Max venue share |',
      );
      out.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
      const registered = new Set(REGISTERED_TIERS.map((t) => Number(t / 1_000_000n)));
      for (const r of srcla) {
        const size = registered.has(r.tierUsd) ? `**${usdLabel(r.tierUsd)}**` : usdLabel(r.tierUsd);
        out.push(
          `| ${size} | ${pct(r.netApy)} | ${pct(r.capitalAtWork, 1)} | ${pct(shownYieldOnDeployed(r))} | ` +
            `${num(r.coverageMin)} | ${num(r.coverageP05)} | ${r.rebalances} | ` +
            `${pct(r.displayedMinusRealizedApy)} | ${r.maxVenueShare === null ? '—' : num(r.maxVenueShare)} |`,
        );
      }
      out.push('');
    }

    out.push(`**Net APY by policy and vault size (\`${sweep.era}\`).**`);
    out.push('');
    out.push(`| Size | ${policies.map(policyName).join(' | ')} |`);
    out.push(`|---:|${policies.map(() => '---:').join('|')}|`);
    for (const size of sizes) {
      const cells = policies.map((p) => {
        const r = sweep.rows.find((x) => x.policyId === p && x.tierUsd === size);
        return r === undefined ? '—' : pct(r.netApy);
      });
      out.push(`| ${usdLabel(size)} | ${cells.join(' | ')} |`);
    }
    out.push('');

    for (const f of figuresByEra[sweep.era] ?? []) {
      out.push(`![${f.filename}](figures/${f.filename})`);
      out.push('');
      out.push(f.caption);
      out.push('');
    }
  }
  return out;
}

/**
 * Put `block` into `markdown` as the size-sweep section: replace the existing
 * section (its heading up to the next `## ` heading) or, if there is none,
 * insert it immediately before `## Limitations`. Every other line is returned
 * unchanged. Throws when `## Limitations` is missing rather than guessing.
 */
export function spliceSizeSweepSection(markdown: string, block: readonly string[]): string {
  const lines = markdown.split('\n');
  const body = [...block.join('\n').split('\n')];
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  const limitations = lines.indexOf(LIMITATIONS_HEADING);
  if (limitations < 0) {
    throw new Error(`cannot splice the size-sweep section: no "${LIMITATIONS_HEADING}" heading`);
  }
  const start = lines.indexOf(SIZE_SWEEP_HEADING);
  if (start >= 0) {
    let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    if (end < 0) end = lines.length;
    return [...lines.slice(0, start), ...body, '', ...lines.slice(end)].join('\n');
  }
  return [...lines.slice(0, limitations), ...body, '', ...lines.slice(limitations)].join('\n');
}

/** Validate a persisted `SRCLA-SIZE-SWEEP-<era>.json` before drawing it; throws naming the missing field. */
export function parseSizeSweep(json: unknown, path: string): SizeSweep {
  const obj = (json ?? {}) as Partial<SizeSweep>;
  if (obj.kind !== 'size-sweep') throw new Error(`${path} is not a size sweep (kind '${String(obj.kind)}')`);
  for (const field of ['era', 'stride', 's2CoverageFloor', 'warning', 'rows', 'registeredTierCheck'] as const) {
    if (!(field in obj)) {
      throw new Error(`${path} has no '${field}' field; re-run pnpm evaluation:size-sweep to regenerate it`);
    }
  }
  return obj as SizeSweep;
}

/** Report order of the eras a section lists: the release era first. */
export function sortSweepsForReport(sweeps: readonly SizeSweep[]): SizeSweep[] {
  const order = ['heldout-c', 'heldout-b', 'heldout-d'];
  const rank = (era: string): number => (order.includes(era) ? order.indexOf(era) : order.length);
  return [...sweeps].sort((a, b) => rank(a.era) - rank(b.era) || a.era.localeCompare(b.era));
}

/** A persisted size sweep the report and `figures:render` use: not a checkpoint, not a subset run. */
export function isPublishedSizeSweepFile(name: string): boolean {
  return /^SRCLA-SIZE-SWEEP-.+\.json$/.test(name) && !name.endsWith('.partial.json') && !name.endsWith('-subset.json');
}

/** The JSON (and checkpoint) basename for a run: a non-default policy or tier set is a `-subset` run. */
export function sizeSweepBasename(era: string, subset: boolean): string {
  return `SRCLA-SIZE-SWEEP-${era}${subset ? '-subset' : ''}`;
}

/**
 * Figure files for `era` in a figures directory that the current render did not
 * produce (e.g. a size figure 7 dropped because venue share is unmeasured).
 * `produced` are `.svg` filenames; a `.png` beside a produced SVG is kept.
 */
export function staleSizeFigures(existing: readonly string[], era: string, produced: readonly string[]): string[] {
  const keep = new Set(produced.map((f) => f.replace(/\.svg$/, '')));
  const escaped = era.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchored on the known slugs, so one era's name can never match another era's files.
  const pattern = new RegExp(`^(SRCLA-SIZE-FIG\\d+-(?:${SIZE_FIGURE_SLUGS.join('|')})-${escaped})\\.(svg|png)$`);
  return existing.filter((f) => {
    const m = f.match(pattern);
    return m !== null && !keep.has(m[1]!);
  });
}

/** `--policies`: every id must be a registered policy; duplicates dropped, order kept. */
export function parsePolicyList(raw: string | undefined, registeredIds: readonly string[]): string[] {
  if (raw === undefined) return [...SIZE_SWEEP_POLICIES];
  const ids = [...new Set(raw.split(',').map((p) => p.trim()).filter((p) => p !== ''))];
  const unknown = ids.filter((p) => !registeredIds.includes(p));
  if (unknown.length > 0) {
    throw new Error(`unknown policy id(s) ${unknown.join(', ')}; registered: ${registeredIds.join(', ')}`);
  }
  if (ids.length === 0) throw new Error('--policies names no policy');
  return ids;
}

/** `--tiers` in whole USDC: positive integers, deduplicated and ascending, returned in base units. */
export function parseTierList(raw: string | undefined): bigint[] {
  if (raw === undefined) return [...SIZE_SWEEP_TIERS];
  const usd = raw.split(',').map((t) => t.trim()).filter((t) => t !== '');
  for (const t of usd) {
    if (!/^[1-9]\d*$/.test(t)) throw new Error(`--tiers: '${t}' is not a positive whole-USDC amount`);
  }
  const unique = [...new Set(usd.map((t) => BigInt(t)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (unique.length === 0) throw new Error('--tiers names no tier');
  return unique.map((t) => t * 1_000_000n);
}

/** True unless the run's policies and tiers are exactly the defaults (as sets). */
export function isSubsetRun(policies: readonly string[], tiers: readonly bigint[]): boolean {
  const samePolicies =
    policies.length === SIZE_SWEEP_POLICIES.length && SIZE_SWEEP_POLICIES.every((p) => policies.includes(p));
  const sameTiers = tiers.length === SIZE_SWEEP_TIERS.length && SIZE_SWEEP_TIERS.every((t) => tiers.includes(t));
  return !(samePolicies && sameTiers);
}

/** What a checkpoint must match before a run may resume from it. */
export interface SweepCheckpointKey {
  era: string;
  stride: number;
  policies: string[];
  /** Whole USDC, ascending. */
  tiers: number[];
  artifactHash: string;
  datasetStart: string;
  datasetEnd: string;
  origins: number;
  gasDigest: string;
  codeCommit: string;
}

export interface SweepCheckpoint extends SweepCheckpointKey {
  kind: 'size-sweep-partial';
  tiersDone: number[];
  rows: SizeSweepRow[];
}

/**
 * Whether `prior` may be resumed by a run keyed `current`. Every key field must
 * match; each difference is named, so a refusal says exactly what changed.
 */
export function checkpointResumable(prior: unknown, current: SweepCheckpointKey): { ok: boolean; reasons: string[] } {
  const p = (prior ?? {}) as Partial<SweepCheckpoint>;
  const reasons: string[] = [];
  if (p.kind !== 'size-sweep-partial') reasons.push(`kind is '${String(p.kind)}', not 'size-sweep-partial'`);
  const scalar = [
    'era',
    'stride',
    'artifactHash',
    'datasetStart',
    'datasetEnd',
    'origins',
    'gasDigest',
    'codeCommit',
  ] as const;
  for (const k of scalar) {
    if (p[k] !== current[k]) reasons.push(`${k}: checkpoint ${String(p[k])} vs run ${String(current[k])}`);
  }
  const list = (k: 'policies' | 'tiers') => {
    const got = Array.isArray(p[k]) ? (p[k] as unknown[]).join(',') : String(p[k]);
    const want = current[k].join(',');
    if (got !== want) reasons.push(`${k}: checkpoint ${got} vs run ${want}`);
  };
  list('policies');
  list('tiers');
  if (!Array.isArray(p.tiersDone) || !Array.isArray(p.rows)) reasons.push('tiersDone/rows missing');
  return { ok: reasons.length === 0, reasons };
}
