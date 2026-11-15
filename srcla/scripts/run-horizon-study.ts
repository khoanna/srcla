#!/usr/bin/env tsx
/**
 * The NON-GATING forecast-horizon study: the 1-, 7- and 14-day horizons of
 * §7.2's registered grid, each tested on the whole post-calibration window.
 *
 * Why it exists. The registered freeze drops 7d and 14d before selection
 * (`testableHorizons`): §11.5's Christoffersen test runs on NON-OVERLAPPING
 * horizon windows and needs 30 of them, and the sealed eras are too short --
 * `heldout-c` (86d) thins to 12 windows at 7d and 6 at 14d. That is a limit of
 * the sealed eras, not of the archive. This study answers the question the
 * registered run cannot: how do the longer horizons actually perform when
 * given enough out-of-sample data to be tested at all?
 *
 * Design, fixed before any number was read:
 *   - Each horizon gets its own artifact, fit on the CALIBRATION ERA ONLY by
 *     the registered freeze with its grid forced to that horizon
 *     (`freeze-artifact.ts --horizon`). 1d is the registered artifact itself.
 *     No artifact is refit on anything this study scores.
 *   - The test window is every origin after calibration and up to
 *     P37_FREEZE_SECONDS: `burned-a` + `heldout-c` + `burned` + `heldout-b`,
 *     ~479 days, enough for >= 30 non-overlapping windows at 14d.
 *     `heldout-d` is NOT touched.
 *   - The window POOLS DESIGN DATA (the two burned windows, and both held-out
 *     eras, which are design data since v0.9/v0.11). It is out of sample for
 *     every artifact -- none was fit on it -- but it is not a held-out test,
 *     and nothing here changes a registered gate, threshold or verdict.
 *
 * Jobs (from srcla/):
 *   DATABASE_URL=... pnpm exec tsx scripts/run-horizon-study.ts --job forecast --horizon 7
 *   DATABASE_URL=... pnpm exec tsx scripts/run-horizon-study.ts --job replay --horizon 7 --tier 1000000
 *   pnpm exec tsx scripts/run-horizon-study.ts --render
 * Outputs: ../report/chart/SRCLA-HORIZON-STUDY-*.json, ../report/SRCLA-HORIZON-STUDY.md
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

import { loadDataset, type TimeOrderedSnapshot } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { REGISTERED_ERAS, eraFor, type EraTag } from '../src/evaluation/eras.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { runRegisteredEvaluation } from '../src/evaluation/kernel/harness.js';
import { deriveCompletedLabels } from '../src/evaluation/kernel/decision-input.js';
import {
  runForecastGate,
  type ArtifactRegistration,
  type ForecastGateResult,
} from '../src/evaluation/kernel/forecast-gate.js';
import { sizeSweepRowsFrom, type SizeSweepRow } from '../src/evaluation/report/size-sweep.js';
import type { HorizonSeconds } from '../src/policy/registered.js';
import type { CompletedLabel } from '../src/policy/types.js';
import { arg, harnessConfig } from './lib/sweep-harness.js';

const CALIBRATION_FRACTION = 0.7;
const HORIZON_DAYS = [1, 7, 14] as const;
const TIERS_USD = [10_000, 100_000, 1_000_000, 10_000_000] as const;
const POLICIES = ['srcla', 'b0', 'b1', 'b2', 'b2u', 'b3', 'b4', 'b5'];
/** Sub-windows the pooled window is broken down by, in order. */
const SUB_ERAS: EraTag[] = ['burned-a', 'heldout-c', 'burned', 'heldout-b'];

const WINDOW_START = REGISTERED_ERAS['burned-a'].startSeconds;
const WINDOW_END = REGISTERED_ERAS['heldout-b'].endSeconds;

const OUT_DIR = arg('out-dir') ?? '..';
const CHART_DIR = join(OUT_DIR, 'report', 'chart');

function artifactPathFor(days: number): string {
  return days === 1 ? 'config/registered-artifact.json' : `config/horizon-study-artifact-${days}d.json`;
}

function registrationOf(path: string): ArtifactRegistration {
  const reg = (JSON.parse(readFileSync(path, 'utf8')) as { _registration?: ArtifactRegistration })._registration;
  if (reg === undefined) throw new Error(`${path} carries no _registration block`);
  return reg;
}

function commit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function loadWindow(prisma: PrismaClient, horizonSeconds: number) {
  const start = new Date(WINDOW_START * 1000);
  const end = new Date(WINDOW_END * 1000);
  const dataset = await loadDataset(prisma, 'horizon-study:post-calibration', start, end);
  const warmupDays = Math.ceil(horizonSeconds / 86_400) + 30;
  const warmup = await loadDataset(
    prisma,
    'horizon-study:warmup',
    new Date((WINDOW_START - warmupDays * 86_400) * 1000),
    new Date((WINDOW_START - 1) * 1000),
  );
  return { dataset, warmup: warmup.snapshots };
}

// ---------------------------------------------------------------- forecast

interface GateSummary {
  pass: boolean;
  blockedReasons: string[];
  venues: ForecastGateResult['venues'];
  checks: { name: string; passed: boolean | null; detail: string; gating: boolean }[];
}

const summarise = (g: ForecastGateResult): GateSummary => ({
  pass: g.pass,
  blockedReasons: g.blockedReasons,
  venues: g.venues,
  checks: g.checks.map((c) => ({ name: c.name, passed: c.passed, detail: c.detail, gating: c.gating !== false })),
});

async function forecastJob(prisma: PrismaClient, days: number): Promise<void> {
  const path = artifactPathFor(days);
  const artifact = loadRegisteredArtifact(path);
  const registration = registrationOf(path);
  if (artifact.horizonSeconds !== days * 86_400) {
    throw new Error(`${path} is H=${artifact.horizonSeconds}s, expected ${days}d`);
  }
  const { dataset } = await loadWindow(prisma, artifact.horizonSeconds);
  // Labels from the window ALONE: a warm-up would put calibration-era (in-
  // sample) residuals into an out-of-sample test.
  const labels = deriveCompletedLabels(
    dataset.snapshots,
    artifact.horizonSeconds as HorizonSeconds,
    artifact.availabilityLagSeconds,
  );
  const gate = (ls: readonly CompletedLabel[]) => ({
    registered: summarise(runForecastGate(artifact, ls, { registration })),
    p37: summarise(runForecastGate(artifact, ls, { registration, amendment: 'p37' })),
  });
  const originSec = (l: CompletedLabel) => l.originSeconds;
  const bySubEra: Record<string, ReturnType<typeof gate>> = {};
  for (const era of SUB_ERAS) {
    bySubEra[era] = gate(labels.filter((l) => eraFor(originSec(l)) === era));
  }
  const out = {
    kind: 'horizon-study-forecast',
    horizonDays: days,
    artifactPath: path,
    artifactHash: artifact.artifactHash,
    method: artifact.method,
    methodParams: artifact.methodParams,
    coverageTarget: artifact.coverageTarget,
    selection: (registration as unknown as { selection?: string }).selection ?? null,
    origins: dataset.snapshots.length,
    windowStart: dataset.snapshots[0]!.timestamp.toISOString(),
    windowEnd: dataset.snapshots[dataset.snapshots.length - 1]!.timestamp.toISOString(),
    labels: labels.length,
    codeCommit: commit(),
    generatedAt: new Date().toISOString(),
    pooled: gate(labels),
    bySubEra,
  };
  mkdirSync(CHART_DIR, { recursive: true });
  const file = join(CHART_DIR, `SRCLA-HORIZON-STUDY-${days}d-forecast.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.error(`[horizon] forecast ${days}d -> ${file} (pooled registered ${out.pooled.registered.pass ? 'PASS' : 'FAIL'}, P37 ${out.pooled.p37.pass ? 'PASS' : 'FAIL'})`);
}

// ------------------------------------------------------------------ replay

/**
 * The replay runs the window as SEGMENTS of 86-92 days, each a fresh vault at
 * the tier, never as one 479-day replay. The registered withdrawal schedule
 * redeems 5% of live NAV every week; over one continuous 479-day replay that is
 * 68 redemptions and leaves ~3% of the vault (0.95^68), so the later eras would
 * be replayed at a small fraction of the tier -- the first attempt showed 0.000%
 * returns and 0.000 coverage on `heldout-b` for exactly that reason. Segments
 * the length of a registered era keep each vault's redemption load equal to the
 * registered run's (~12 redemptions, ~54% of NAV at the end).
 */
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const SEGMENTS: { label: string; startSeconds: number; endSeconds: number }[] = [
  { label: 'burned-a (1/3)', startSeconds: REGISTERED_ERAS['burned-a'].startSeconds, endSeconds: at('2025-08-31T23:59:59Z') },
  { label: 'burned-a (2/3)', startSeconds: at('2025-09-01T00:00:00Z'), endSeconds: at('2025-11-30T23:59:59Z') },
  { label: 'burned-a (3/3)', startSeconds: at('2025-12-01T00:00:00Z'), endSeconds: REGISTERED_ERAS['burned-a'].endSeconds },
  ...(['heldout-c', 'burned', 'heldout-b'] as EraTag[]).map((e) => ({
    label: e as string,
    startSeconds: REGISTERED_ERAS[e].startSeconds,
    endSeconds: REGISTERED_ERAS[e].endSeconds,
  })),
];

type SegmentRow = SizeSweepRow & { segment: string; days: number; origins: number };

interface Aggregate {
  /** Compounded over the segments, annualized over their total length. */
  netApy: number;
  /** Origin-weighted over the segments. */
  capitalAtWork: number;
  coverageMin: number;
  /** The worst segment's 5th percentile. */
  coverageP05Worst: number;
  rebalances: number;
  turnoverUsdc: number;
  costsUsdc: number;
  displayedMinusRealizedApy: number;
}

function aggregate(rows: readonly SegmentRow[]): Aggregate {
  const totalDays = rows.reduce((a, r) => a + r.days, 0);
  const totalOrigins = rows.reduce((a, r) => a + r.origins, 0);
  const growth = rows.reduce((g, r) => g * Math.pow(1 + r.netApy, r.days / 365.25), 1);
  return {
    netApy: Math.pow(growth, 365.25 / totalDays) - 1,
    capitalAtWork: rows.reduce((a, r) => a + (r.capitalAtWork ?? 0) * r.origins, 0) / totalOrigins,
    coverageMin: Math.min(...rows.map((r) => r.coverageMin)),
    coverageP05Worst: Math.min(...rows.map((r) => r.coverageP05)),
    rebalances: rows.reduce((a, r) => a + r.rebalances, 0),
    turnoverUsdc: rows.reduce((a, r) => a + r.turnoverUsdc, 0),
    costsUsdc: rows.reduce((a, r) => a + r.costsUsdc, 0),
    displayedMinusRealizedApy: rows.reduce((a, r) => a + r.displayedMinusRealizedApy * r.origins, 0) / totalOrigins,
  };
}

async function replayJob(prisma: PrismaClient, days: number, tierUsd: number): Promise<void> {
  const path = artifactPathFor(days);
  const artifact = loadRegisteredArtifact(path);
  const registration = registrationOf(path);
  const warmupDays = Math.ceil(artifact.horizonSeconds / 86_400) + 30;
  const t0 = Date.now();
  const segmentRows: SegmentRow[] = [];
  for (const seg of SEGMENTS) {
    const dataset = await loadDataset(
      prisma,
      `horizon-study:${seg.label}`,
      new Date(seg.startSeconds * 1000),
      new Date(seg.endSeconds * 1000),
    );
    const warmup = await loadDataset(
      prisma,
      `horizon-study:warmup:${seg.label}`,
      new Date((seg.startSeconds - warmupDays * 86_400) * 1000),
      new Date((seg.startSeconds - 1) * 1000),
    );
    const start = dataset.snapshots[0]!.timestamp;
    const end = dataset.snapshots[dataset.snapshots.length - 1]!.timestamp;
    const gas = await loadGasSeries(prisma, start, end);
    const evaluation = runRegisteredEvaluation({
      dataset,
      config: harnessConfig(gas, artifact),
      artifact,
      tiers: [BigInt(tierUsd) * 1_000_000n],
      policyIds: POLICIES,
      decideOpts: DEFAULT_DECIDE_OPTS,
      calibrationFraction: CALIBRATION_FRACTION,
      warmupSnapshots: warmup.snapshots as TimeOrderedSnapshot[],
      registration,
    });
    const segDays = (end.getTime() - start.getTime()) / 86_400_000;
    for (const row of sizeSweepRowsFrom(evaluation.results)) {
      segmentRows.push({ ...row, segment: seg.label, days: segDays, origins: dataset.snapshots.length });
    }
    const s = segmentRows.find((r) => r.segment === seg.label && r.policyId === 'srcla');
    console.error(
      `[horizon] ${days}d @ $${tierUsd}: ${seg.label} (${dataset.snapshots.length} origins) done at ` +
        `${((Date.now() - t0) / 1000).toFixed(0)}s` +
        (s ? ` srcla net ${(s.netApy * 100).toFixed(3)}%, cap ${(s.capitalAtWork ?? 0).toFixed(3)}, min cov ${s.coverageMin.toFixed(3)}` : ''),
    );
  }
  const rows = POLICIES.map((policyId) => {
    const segments = segmentRows.filter((r) => r.policyId === policyId);
    return { policyId, aggregate: aggregate(segments), segments };
  });
  const out = {
    kind: 'horizon-study-replay',
    horizonDays: days,
    tierUsd,
    artifactHash: artifact.artifactHash,
    segments: SEGMENTS.map((s) => s.label),
    origins: segmentRows.filter((r) => r.policyId === 'srcla').reduce((a, r) => a + r.origins, 0),
    codeCommit: commit(),
    generatedAt: new Date().toISOString(),
    seconds: (Date.now() - t0) / 1000,
    rows,
  };
  mkdirSync(CHART_DIR, { recursive: true });
  const file = join(CHART_DIR, `SRCLA-HORIZON-STUDY-${days}d-${tierUsd}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  const s = rows.find((r) => r.policyId === 'srcla')!.aggregate;
  console.error(
    `[horizon] replay ${days}d @ $${tierUsd} done in ${out.seconds.toFixed(0)}s -> ${file} ` +
      `(srcla net ${(s.netApy * 100).toFixed(3)}%, cap ${s.capitalAtWork.toFixed(3)}, min cov ${s.coverageMin.toFixed(3)})`,
  );
}

// ------------------------------------------------------------------ render

type ForecastJson = {
  horizonDays: number;
  artifactHash: string;
  method: string;
  methodParams: unknown;
  coverageTarget: number;
  selection: string | null;
  origins: number;
  windowStart: string;
  windowEnd: string;
  labels: number;
  pooled: { registered: GateSummary; p37: GateSummary };
  bySubEra: Record<string, { registered: GateSummary; p37: GateSummary }>;
};
type ReplayRow = { policyId: string; aggregate: Aggregate; segments: SegmentRow[] };
type ReplayJson = { horizonDays: number; tierUsd: number; origins: number; segments: string[]; rows: ReplayRow[] };

const pct = (x: number | null | undefined, dp = 2) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(dp)}%`);
const verdict = (v: boolean | null) => (v === true ? 'PASS' : v === false ? '**FAIL**' : 'NOT PRODUCED');
const usd = (n: number) => (n >= 1e6 ? `$${n / 1e6}M` : `$${n / 1e3}k`);

function findCheck(g: GateSummary, prefix: string, venue: string) {
  return g.checks.find((c) => c.name.startsWith(prefix) && c.name.endsWith(venue));
}

function render(): void {
  const files = existsSync(CHART_DIR) ? readdirSync(CHART_DIR).filter((f) => f.startsWith('SRCLA-HORIZON-STUDY-')) : [];
  const forecasts = new Map<number, ForecastJson>();
  const replays = new Map<string, ReplayJson>();
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(CHART_DIR, f), 'utf8'));
    if (j.kind === 'horizon-study-forecast') forecasts.set(j.horizonDays, j);
    if (j.kind === 'horizon-study-replay') replays.set(`${j.horizonDays}:${j.tierUsd}`, j);
  }
  const L: string[] = [];
  L.push('# SRCLA forecast-horizon study (1d / 7d / 14d) — non-gating');
  L.push('');
  L.push(
    'Supplementary and **non-gating**. It changes no registered gate, threshold, artifact or verdict; ' +
      '`report/SRCLA-REPORT.md` remains the registered result.',
  );
  L.push('');
  L.push('## Why 7d and 14d were not in the registered run');
  L.push('');
  L.push(
    '§11.5\'s forecast gate runs Christoffersen\'s independence test on **non-overlapping** horizon windows ' +
      '(overlapping residuals are serially dependent by construction) and needs at least 30 of them. ' +
      'The registered freeze therefore keeps only horizons testable on **every sealed era** (`testableHorizons`). ' +
      'That is not a shortage of archived data. The archive holds every hourly origin from 2024-03-15, the Base ' +
      'deployment floor for all three venues, to today with zero gaps. The limit is the length of the sealed eras:',
  );
  L.push('');
  L.push('| Sealed era | Days | Non-overlapping windows at 1d | at 7d | at 14d |');
  L.push('|---|---:|---:|---:|---:|');
  for (const e of ['heldout-c', 'heldout-b'] as EraTag[]) {
    const d = (REGISTERED_ERAS[e].endSeconds - REGISTERED_ERAS[e].startSeconds) / 86_400;
    L.push(`| \`${e}\` | ${Math.round(d)} | ${Math.floor(d)} | ${Math.floor(d / 7)} | ${Math.floor(d / 14)} |`);
  }
  const wd = (WINDOW_END - WINDOW_START) / 86_400;
  L.push(`| **this study's window** | **${Math.round(wd)}** | **${Math.floor(wd)}** | **${Math.floor(wd / 7)}** | **${Math.floor(wd / 14)}** |`);
  L.push('');
  L.push(
    'Base history cannot be extended further back, because none of the three venues existed on Base before March 2024. ' +
      'The only new data was 2026-09-14 → 2026-09-23 (214 hourly origins, backfilled for this study with 0 gaps). ' +
      'To give 7d and 14d enough windows, this study **tests on the whole post-calibration window** ' +
      `(${new Date(WINDOW_START * 1000).toISOString().slice(0, 10)} → ${new Date(WINDOW_END * 1000).toISOString().slice(0, 10)}): ` +
      '`burned-a` + `heldout-c` + `burned` + `heldout-b`. `heldout-d` is not touched.',
  );
  L.push('');
  L.push('## Method');
  L.push('');
  L.push(
    '- **One artifact per horizon, all fit on the calibration era only** (2024-03-15 → 2025-05-31). The registered ' +
      'freeze runs with its grid forced to one horizon (`freeze-artifact.ts --horizon 7|14`), so each horizon picks its ' +
      'own forecaster and coverage target by the same §7.3/P18 loss. 1d is the registered artifact itself. ' +
      'Nothing is refit on the test window.',
  );
  L.push(
    '- **Forecast calibration** runs the registered forecast gate (`runForecastGate`, both the v0.10 and the P37 ' +
      'forms) on labels from the test window alone. No warm-up labels are used, so no in-sample residual is scored.',
  );
  L.push(
    '- **Policy replay** puts SRCLA and B0–B5 through the same decide path as the registered run (`runRegisteredEvaluation`, ' +
      'hourly origins, measured gas, registered harness config) at the four registered tiers, in six fresh-vault segments ' +
      'of 86–92 days that cover the whole window (see below).',
  );
  L.push(
    '- **Caveat, and it matters:** the window **pools design data**. The two burned windows were read while designing ' +
      'the amendments, and both held-out eras are design data since v0.9/v0.11. It is out of sample for every artifact ' +
      'here, since none was fit on it, but it is **not a held-out test**. The same replay limitation as the registered run ' +
      'applies: accrued yield is credited to total assets only, so capital at work is overstated and stressed coverage ' +
      'understated for every policy.',
  );
  L.push('');

  // --- artifacts
  L.push('## The three artifacts');
  L.push('');
  L.push('| Horizon | Forecaster | Coverage target | Artifact | Test origins | Test labels |');
  L.push('|---|---|---:|---|---:|---:|');
  for (const d of HORIZON_DAYS) {
    const f = forecasts.get(d);
    if (!f) {
      L.push(`| ${d}d | not run | | | | |`);
      continue;
    }
    L.push(
      `| ${d}d | \`${f.method}\` ${JSON.stringify(f.methodParams)} | ${f.coverageTarget} | \`${f.artifactHash.slice(0, 16)}…\` | ${f.origins.toLocaleString('en-US')} | ${f.labels.toLocaleString('en-US')} |`,
    );
  }
  L.push('');

  // --- forecast calibration pooled
  const venues = ['aave-v3-usdc', 'compound-v3-usdc', 'moonwell-usdc'];
  L.push('## Forecast calibration on the pooled window');
  L.push('');
  L.push(
    'Coverage = share of realised horizon returns at or above the forecast\'s lower bound (target = the artifact\'s ' +
      'coverage level, which each horizon selects for itself: 99% at 1d, 90% at 7d, 95% at 14d, so compare coverage ' +
      'with its own target). Kupiec tests the breach rate. Christoffersen tests independence on the thinned stream, and ' +
      'its "windows" column is the number of non-overlapping windows it ran on. At 7d and 14d this is the first time the ' +
      'longer horizons have ≥ 30 windows. The table shows the **P37** form (one-sided Kupiec for a lower bound, P34 ' +
      'domain). The registered v0.10 form follows it.',
  );
  L.push('');
  for (const form of ['p37', 'registered'] as const) {
    L.push(`### ${form === 'p37' ? 'P37 form' : 'Registered v0.10 form'}`);
    L.push('');
    L.push('| Horizon | Venue | Obs. | Coverage | Target | Coverage check | Kupiec p | Kupiec | Christoffersen windows | Christoffersen p | Christoffersen |');
    L.push('|---|---|---:|---:|---:|---|---:|---|---:|---:|---|');
    for (const d of HORIZON_DAYS) {
      const f = forecasts.get(d);
      if (!f) continue;
      const g = f.pooled[form];
      for (const v of venues) {
        const vc = g.venues.find((x) => x.marketId === v);
        const cov = findCheck(g, 'Per-venue coverage', v);
        const kup = findCheck(g, 'Kupiec', v);
        const chr = findCheck(g, 'Christoffersen', v);
        const kupP = /one-sided p ([0-9.]+)|p ([0-9.]+)/.exec(kup?.detail ?? '');
        L.push(
          `| ${d}d | \`${v}\` | ${vc?.observations ?? '—'} | ${pct(vc?.achievedCoverage)} | ${pct(f.coverageTarget, 0)} | ${verdict(cov?.passed ?? null)} | ` +
            `${kupP ? (kupP[1] ?? kupP[2]) : vc?.kupiec ? vc.kupiec.pValue.toFixed(4) : '—'} | ${verdict(kup?.passed ?? null)} | ` +
            `${vc?.christoffersen?.observations ?? '—'} | ${/, p ([0-9.]+)/.exec(chr?.detail ?? '')?.[1] ?? '—'} | ${verdict(chr?.passed ?? null)} |`,
        );
      }
    }
    L.push('');
  }
  L.push('**Whole forecast gate on the pooled window** (every check, including the grid, regime-purity and completeness checks):');
  L.push('');
  L.push('| Horizon | Registered v0.10 | P37 | Blocked on (P37) |');
  L.push('|---|---|---|---|');
  for (const d of HORIZON_DAYS) {
    const f = forecasts.get(d);
    if (!f) continue;
    L.push(
      `| ${d}d | ${f.pooled.registered.pass ? 'PASS' : '**FAIL**'} | ${f.pooled.p37.pass ? 'PASS' : '**FAIL**'} | ${f.pooled.p37.blockedReasons.join('; ') || '—'} |`,
    );
  }
  L.push('');
  L.push(
    'Regime purity is the share of label windows that straddle a governance rate-model change (tolerance 10%). It rises ' +
      'with the horizon, because a longer label window is more likely to contain a rate-model change. That is a ' +
      'property of the horizon, so more data does not fix it.',
  );
  L.push('');
  L.push('Regime purity per horizon (pooled, P37 form):');
  L.push('');
  for (const d of HORIZON_DAYS) {
    const c = forecasts.get(d)?.pooled.p37.checks.find((x) => x.name === 'Regime purity');
    if (c) L.push(`- **${d}d** — ${verdict(c.passed)}: ${c.detail.split(':')[0]}`);
  }
  L.push('');
  L.push('### Per sub-era: why the sealed eras alone cannot test 7d and 14d');
  L.push('');
  L.push(
    'Christoffersen windows (fewest over the three venues) and the lowest venue coverage, P37 form, when each sub-era ' +
      'is tested on its own. Below 30 windows the independence test is NOT PRODUCED, shown with the most windows that ' +
      'sub-era could ever hold at that horizon. That is why the registered run could not test 7d or 14d on `heldout-c` or ' +
      '`heldout-b`. At 1d, `heldout-b` is NOT PRODUCED because P34 removes most Moonwell residuals during the drain.',
  );
  L.push('');
  L.push(`| Horizon | ${SUB_ERAS.map((e) => `\`${e}\` windows (min over venues) / coverage (min)`).join(' | ')} |`);
  L.push(`|---|${SUB_ERAS.map(() => '---').join('|')}|`);
  for (const d of HORIZON_DAYS) {
    const f = forecasts.get(d);
    if (!f) continue;
    const cells = SUB_ERAS.map((e) => {
      const g = f.bySubEra[e]?.p37;
      if (!g || g.venues.length === 0) return '—';
      const c = Math.min(...g.venues.map((v) => v.achievedCoverage));
      if (g.venues.some((v) => v.christoffersen === null)) {
        const era = REGISTERED_ERAS[e];
        const possible = Math.floor((era.endSeconds - era.startSeconds) / (d * 86_400));
        return `NOT PRODUCED (≤ ${possible}) / ${pct(c)}`;
      }
      return `${Math.min(...g.venues.map((v) => v.christoffersen!.observations))} / ${pct(c)}`;
    });
    L.push(`| ${d}d | ${cells.join(' | ')} |`);
  }
  L.push('');

  // --- policy
  L.push('## Policy outcomes across the window');
  L.push('');
  L.push(
    'Each horizon\'s artifact drives SRCLA at the four registered tiers. The window is replayed as six consecutive **segments ' +
      'of 86–92 days**, each starting from a fresh vault at the tier (`burned-a` in three parts, then `heldout-c`, `burned`, ' +
      '`heldout-b`), with the registered warm-up before each. That is the registered run\'s own shape: one continuous ' +
      '479-day replay would apply 68 weekly 5%-of-NAV redemptions and shrink every vault to ~3% of its tier. Net APY below ' +
      'is compounded over the six segments and annualized. Capital at work is origin-weighted. Min coverage is the worst ' +
      'origin in any segment. Rebalances, turnover and costs are summed. The baselines run through the same kernel with the ' +
      'same artifact, so kernel baselines (B1–B3, B5) also move with the horizon. B0 is idle by definition. B2u and B5 are ' +
      'diagnostics, not deployable comparators (B5 is bounded hindsight).',
  );
  L.push('');
  L.push('### SRCLA by horizon');
  L.push('');
  L.push(
    '"Net APY excl. `heldout-b`" compounds the five segments before the Moonwell drain, whose quoted rate could not be ' +
      'withdrawn. "Min coverage excl. `heldout-b`" is the same restriction. S2\'s floor is 0.95.',
  );
  L.push('');
  L.push('| Tier | Horizon | Net APY | Net APY excl. `heldout-b` | Capital at work | Min coverage | Min coverage excl. `heldout-b` | Rebalances | Turnover (USDC) | Costs (USDC) | Displayed − realized |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const t of TIERS_USD) {
    for (const d of HORIZON_DAYS) {
      const row = replays.get(`${d}:${t}`)?.rows.find((x) => x.policyId === 'srcla');
      const r = row?.aggregate;
      if (!row || !r) {
        L.push(`| ${usd(t)} | ${d}d | not run | | | | | | | | |`);
        continue;
      }
      const ex = aggregate(row.segments.filter((x) => x.segment !== 'heldout-b'));
      L.push(
        `| ${usd(t)} | ${d}d | ${pct(r.netApy, 3)} | ${pct(ex.netApy, 3)} | ${pct(r.capitalAtWork, 1)} | ${r.coverageMin.toFixed(3)} | ${ex.coverageMin.toFixed(3)} | ` +
          `${r.rebalances} | ${Math.round(r.turnoverUsdc).toLocaleString('en-US')} | ${r.costsUsdc.toFixed(2)} | ${pct(r.displayedMinusRealizedApy)} |`,
      );
    }
  }
  L.push('');
  L.push('### Net APY, every policy, by horizon');
  L.push('');
  L.push(`| Tier | Horizon | ${POLICIES.map((p) => p.toUpperCase()).join(' | ')} |`);
  L.push(`|---|---|${POLICIES.map(() => '---:').join('|')}|`);
  for (const t of TIERS_USD) {
    for (const d of HORIZON_DAYS) {
      const j = replays.get(`${d}:${t}`);
      if (!j) continue;
      L.push(`| ${usd(t)} | ${d}d | ${POLICIES.map((p) => pct(j.rows.find((x) => x.policyId === p)?.aggregate.netApy, 3)).join(' | ')} |`);
    }
  }
  L.push('');
  L.push('### Net APY excl. `heldout-b`, every policy, by horizon');
  L.push('');
  L.push(`| Tier | Horizon | ${POLICIES.map((p) => p.toUpperCase()).join(' | ')} |`);
  L.push(`|---|---|${POLICIES.map(() => '---:').join('|')}|`);
  for (const t of TIERS_USD) {
    for (const d of HORIZON_DAYS) {
      const j = replays.get(`${d}:${t}`);
      if (!j) continue;
      L.push(
        `| ${usd(t)} | ${d}d | ${POLICIES.map((p) => {
          const row = j.rows.find((x) => x.policyId === p);
          return row ? pct(aggregate(row.segments.filter((x) => x.segment !== 'heldout-b')).netApy, 3) : '—';
        }).join(' | ')} |`,
      );
    }
  }
  L.push('');
  L.push('### Min stressed coverage, every policy, by horizon');
  L.push('');
  L.push(`| Tier | Horizon | ${POLICIES.map((p) => p.toUpperCase()).join(' | ')} |`);
  L.push(`|---|---|${POLICIES.map(() => '---:').join('|')}|`);
  for (const t of TIERS_USD) {
    for (const d of HORIZON_DAYS) {
      const j = replays.get(`${d}:${t}`);
      if (!j) continue;
      L.push(`| ${usd(t)} | ${d}d | ${POLICIES.map((p) => j.rows.find((x) => x.policyId === p)?.aggregate.coverageMin.toFixed(3) ?? '—').join(' | ')} |`);
    }
  }
  L.push('');
  const segLabels = [...replays.values()][0]?.segments ?? [];
  L.push('### SRCLA per segment');
  L.push('');
  L.push(
    'Net APY / min stressed coverage in each segment. `heldout-b` contains the Moonwell drain (the venue held zero ' +
      'withdrawable cash for about a third of it), so its APY is not attainable yield.',
  );
  L.push('');
  L.push(`| Tier | Horizon | ${segLabels.map((e) => `\`${e}\``).join(' | ')} |`);
  L.push(`|---|---|${segLabels.map(() => '---:').join('|')}|`);
  for (const t of TIERS_USD) {
    for (const d of HORIZON_DAYS) {
      const r = replays.get(`${d}:${t}`)?.rows.find((x) => x.policyId === 'srcla');
      if (!r) continue;
      L.push(
        `| ${usd(t)} | ${d}d | ${segLabels
          .map((e) => {
            const s = r.segments.find((x) => x.segment === e);
            return s ? `${pct(s.netApy)} / ${s.coverageMin.toFixed(3)}` : '—';
          })
          .join(' | ')} |`,
      );
    }
  }
  L.push('');
  const outPath = join(OUT_DIR, 'report', 'SRCLA-HORIZON-STUDY.md');
  writeFileSync(outPath, L.join('\n') + '\n');
  console.error(`[horizon] report -> ${outPath} (${forecasts.size} forecast, ${replays.size} replay results)`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--render')) {
    render();
    return;
  }
  const job = arg('job');
  const days = Number(arg('horizon'));
  if (!(HORIZON_DAYS as readonly number[]).includes(days)) throw new Error('--horizon must be 1, 7 or 14');
  const prisma = new PrismaClient();
  try {
    if (job === 'forecast') await forecastJob(prisma, days);
    else if (job === 'replay') {
      const tier = Number(arg('tier'));
      if (!(TIERS_USD as readonly number[]).includes(tier)) throw new Error(`--tier must be one of ${TIERS_USD.join(', ')}`);
      await replayJob(prisma, days, tier);
    } else throw new Error('--job forecast|replay, or --render');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
