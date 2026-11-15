#!/usr/bin/env tsx
/**
 * The NON-GATING vault-size sweep: SRCLA and B0–B5 at twenty vault sizes
 * between 10,000 and 10,000,000 USDC, for figures and tables.
 *
 * It decides nothing. Registered gates, verdicts and `run-phase4.ts` are not
 * touched; the only report change is the `## Vault-size sweep (non-gating)`
 * section, spliced in before `## Limitations`. See
 * `src/evaluation/report/size-sweep.ts` for why the sweep exists and how it
 * checks itself against the registered results.
 *
 * Each era is loaded exactly as `run-phase4.ts#runEra` loads it (sealed era,
 * measured gas series, warm-up, the same harness config and registered
 * artifact) and replayed ONE TIER AT A TIME, all policies per call so
 * `inertVsSrcla` still compares against SRCLA. After every tier the rows are
 * checkpointed to `report/chart/SRCLA-SIZE-SWEEP-<era>.partial.json`. A re-run
 * resumes from it only when stride, policies, tiers, artifact, dataset window,
 * gas series and code commit all match; otherwise it refuses (pass `--restart`
 * to discard the checkpoint).
 *
 * A run with a non-default `--policies` or `--tiers` is a SUBSET run: it writes
 * `SRCLA-SIZE-SWEEP-<era>-subset.json`, which neither the report section nor
 * `figures:render` reads, and never overwrites the full sweep.
 *
 * Usage (from srcla/):
 *   DATABASE_URL=... pnpm evaluation:size-sweep \
 *     [--eras heldout-c,heldout-b] [--stride 1] [--tiers 10000,1000000] \
 *     [--policies srcla,b1] [--out-dir ..] [--artifact config/registered-artifact.json] [--restart]
 *   pnpm evaluation:size-sweep --render-only [--out-dir ..]
 *     # no DB: re-runs the registered-tier check against the sources, rewrites
 *     # that field of each sweep JSON, redraws figures and re-splices the section
 *
 * Exits non-zero when a registered-tier check finds a mismatch (after every
 * output is written).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

import { loadEra, loadWarmup } from '../src/evaluation/dataset.js';
import { loadGasSeries } from '../src/evaluation/gas-series.js';
import { REGISTERED_ERAS, type EraTag } from '../src/evaluation/eras.js';
import { loadRegisteredArtifact } from '../src/policy/artifact.js';
import { DEFAULT_DECIDE_OPTS } from '../src/policy/decide.js';
import { runRegisteredEvaluation } from '../src/evaluation/kernel/harness.js';
import { REGISTERED_POLICIES } from '../src/evaluation/kernel/registry.js';
import { REGISTERED_S2_COVERAGE_FLOOR } from '../src/evaluation/kernel/sustainability.js';
import type { ArtifactRegistration } from '../src/evaluation/kernel/forecast-gate.js';
import { venueFailureWarning } from '../src/evaluation/report/charts.js';
import {
  checkpointResumable,
  isPublishedSizeSweepFile,
  isSubsetRun,
  parsePolicyList,
  parseSizeSweep,
  parseTierList,
  registeredTierCheckFrom,
  renderSizeSweepSection,
  sizeSweepBasename,
  sizeSweepFigures,
  sizeSweepRowsFrom,
  sortSweepsForReport,
  spliceSizeSweepSection,
  staleSizeFigures,
  type RegisteredSource,
  type RegisteredTierCheck,
  type SizeSweep,
  type SweepCheckpoint,
  type SweepCheckpointKey,
} from '../src/evaluation/report/size-sweep.js';
import { arg, harnessConfig } from './lib/sweep-harness.js';

/** Matches run-phase4's CALIBRATION_FRACTION; inert for a registered artifact. */
const CALIBRATION_FRACTION = 0.7;
const PURPOSE = 'the non-gating vault-size sweep';
/** The repository root, for the registered results when `--out-dir` has none. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function codeCommit(): string {
  const fromEnv = process.env.GIT_COMMIT_HASH;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

const chartDirOf = (outDir: string) => join(outDir, 'report', 'chart');

/** First existing file among `<out-dir>/<name>` and `<repo root>/<name>`. */
function findSource(outDir: string, name: string): string | undefined {
  for (const dir of [outDir, REPO_ROOT]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** The registered results for `era`: the run record and/or SRCLA-REPORT.json, whichever exist. */
function registeredSources(outDir: string, era: string): RegisteredSource[] {
  const sources: RegisteredSource[] = [];
  for (const name of [`evaluation-${era}.json`, 'SRCLA-REPORT.json']) {
    const path = findSource(outDir, name);
    if (path === undefined) continue;
    const shown = relative(REPO_ROOT, path).startsWith('..') ? path : relative(REPO_ROOT, path);
    sources.push({ path: shown, json: JSON.parse(readFileSync(path, 'utf8')) as unknown });
  }
  return sources;
}

function checkFor(outDir: string, sweep: SizeSweep): RegisteredTierCheck {
  const sources = registeredSources(outDir, sweep.era);
  const check = registeredTierCheckFrom({
    rows: sweep.rows,
    stride: sweep.stride,
    expect: {
      era: sweep.era,
      artifactHash: sweep.artifactHash,
      datasetStart: sweep.datasetStart,
      datasetEnd: sweep.datasetEnd,
      ...(typeof sweep.origins === 'number' ? { origins: sweep.origins } : {}),
      ...(sweep.gasDigest === undefined ? {} : { gasDigest: sweep.gasDigest }),
    },
    sources,
  });
  const tag = `[size-sweep] ${sweep.era}`;
  if (!check.checked) {
    console.error(`${tag}: WARNING registered-tier check NOT CHECKED — ${check.reason ?? 'no reason'}`);
  } else {
    console.error(
      `${tag}: registered-tier check vs ${check.source}: ${check.compared} pairs, ${check.mismatches.length} mismatches`,
    );
    for (const n of check.notes ?? []) console.error(`${tag}: note: ${n}`);
    for (const m of check.mismatches) {
      console.error(
        `${tag}:   MISMATCH ${m.policyId}@${m.tierUsd} ${m.field}: sweep ${String(m.sweep)} vs registered ${String(m.registered)}`,
      );
    }
  }
  return check;
}

function writeFigures(figuresDir: string, sweep: SizeSweep): { filename: string; caption: string }[] {
  const figures = sizeSweepFigures(sweep);
  mkdirSync(figuresDir, { recursive: true });
  for (const f of figures) writeFileSync(join(figuresDir, f.filename), f.svg + '\n');
  for (const stale of staleSizeFigures(readdirSync(figuresDir), sweep.era, figures.map((f) => f.filename))) {
    unlinkSync(join(figuresDir, stale));
    console.error(`[size-sweep] ${sweep.era}: removed stale ${stale}`);
  }
  console.error(`[size-sweep] ${sweep.era}: figures -> ${figuresDir}: ${figures.map((f) => f.filename).join(', ')}`);
  return figures;
}

/**
 * For every published sweep: re-run the registered-tier check against the
 * sources and rewrite that field of its JSON, redraw its figures (removing
 * stale ones), then splice the section into the report if it exists. Returns
 * the total mismatch count.
 */
function publish(outDir: string): number {
  const chartDir = chartDirOf(outDir);
  const files = existsSync(chartDir) ? readdirSync(chartDir).filter(isPublishedSizeSweepFile).sort() : [];
  if (files.length === 0) {
    console.error(`[size-sweep] no published SRCLA-SIZE-SWEEP-<era>.json in ${chartDir}`);
    return 0;
  }
  let mismatches = 0;
  const sweeps: SizeSweep[] = [];
  for (const file of files) {
    const path = join(chartDir, file);
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const sweep = parseSizeSweep(json, path);
    const check = checkFor(outDir, sweep);
    // Only the check field changes; every other field is written back as read.
    json.registeredTierCheck = check;
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
    sweep.registeredTierCheck = check;
    mismatches += check.mismatches.length;
    sweeps.push(sweep);
  }
  const figuresDir = join(outDir, 'report', 'figures');
  const ordered = sortSweepsForReport(sweeps);
  const figuresByEra: Record<string, { filename: string; caption: string }[]> = {};
  for (const sweep of ordered) figuresByEra[sweep.era] = writeFigures(figuresDir, sweep);
  const mdPath = join(outDir, 'report', 'SRCLA-REPORT.md');
  if (existsSync(mdPath)) {
    const before = readFileSync(mdPath, 'utf8');
    writeFileSync(mdPath, spliceSizeSweepSection(before, renderSizeSweepSection(ordered, figuresByEra)));
    console.error(`[size-sweep] section spliced into ${mdPath} (${ordered.map((s) => s.era).join(', ')})`);
  } else {
    console.error(`[size-sweep] no ${mdPath}; section not spliced`);
  }
  return mismatches;
}

interface RunOptions {
  outDir: string;
  stride: number;
  tiers: readonly bigint[];
  policies: string[];
  artifactPath: string;
  commit: string;
  subset: boolean;
  restart: boolean;
}

/** Replays one era, writes its JSON and returns its path. */
async function runEra(prisma: PrismaClient, era: EraTag, opts: RunOptions): Promise<string> {
  const { outDir, stride, tiers, policies } = opts;
  const artifact = loadRegisteredArtifact(opts.artifactPath);
  const reg = (JSON.parse(readFileSync(opts.artifactPath, 'utf8')) as { _registration?: ArtifactRegistration })
    ._registration;
  if (reg === undefined) throw new Error(`${opts.artifactPath} carries no _registration block`);

  console.error('');
  console.error(`=== SIZE SWEEP ${era} (non-gating${opts.subset ? ', SUBSET' : ''}) ===`);
  const dataset = await loadEra(prisma, era, PURPOSE, { allowSealed: true });
  if (dataset.snapshots.length === 0) {
    throw new Error(`era '${era}' holds no origins. Run \`pnpm backfill:history --era ${era}\` first.`);
  }
  const start = dataset.snapshots[0]!.timestamp;
  const end = dataset.snapshots[dataset.snapshots.length - 1]!.timestamp;
  const gas = await loadGasSeries(prisma, start, end);
  const warmupDays = Math.ceil(artifact.horizonSeconds / 86_400) + 30;
  const warmupSnapshots = await loadWarmup(prisma, era, warmupDays);
  const config = harnessConfig(gas, artifact);
  const sweepDataset = { ...dataset, snapshots: dataset.snapshots.filter((_, i) => i % stride === 0) };
  console.error(
    `    ${dataset.snapshots.length} origins ${start.toISOString()} -> ${end.toISOString()}; replaying ` +
      `${sweepDataset.snapshots.length} (stride ${stride}); warm-up ${warmupSnapshots.length}; ` +
      `${tiers.length} tiers x ${policies.length} policies; gas digest ${gas.digest}`,
  );

  // The dry-venue warning, measured over the full era exactly as run-phase4 does.
  const dryByVenue: Record<string, { dryOrigins: number; total: number; maxApy: number }> = {};
  for (const o of dataset.snapshots) {
    for (const m of o.snapshots) {
      const v = (dryByVenue[m.marketId] ??= { dryOrigins: 0, total: 0, maxApy: 0 });
      v.total += 1;
      if (m.cashBase === 0n) v.dryOrigins += 1;
      const apy = Number(m.supplyRateE18) / 1e18;
      if (apy > v.maxApy) v.maxApy = apy;
    }
  }
  const spanSeconds = (end.getTime() - start.getTime()) / 1000;
  const warning = venueFailureWarning(dryByVenue, Math.max(1, Math.round(spanSeconds / 86_400)));
  if (warning !== undefined) console.error(`    ${warning}`);

  const key: SweepCheckpointKey = {
    era,
    stride,
    policies,
    tiers: tiers.map((t) => Number(t / 1_000_000n)),
    artifactHash: artifact.artifactHash,
    datasetStart: start.toISOString(),
    datasetEnd: end.toISOString(),
    origins: sweepDataset.snapshots.length,
    gasDigest: gas.digest,
    codeCommit: opts.commit,
  };
  mkdirSync(chartDirOf(outDir), { recursive: true });
  const base = join(chartDirOf(outDir), sizeSweepBasename(era, opts.subset));
  const pPath = `${base}.partial.json`;
  let checkpoint: SweepCheckpoint = { kind: 'size-sweep-partial', ...key, tiersDone: [], rows: [] };
  if (existsSync(pPath)) {
    const verdict = checkpointResumable(JSON.parse(readFileSync(pPath, 'utf8')) as unknown, key);
    if (verdict.ok) {
      checkpoint = JSON.parse(readFileSync(pPath, 'utf8')) as SweepCheckpoint;
      console.error(`    resuming from ${pPath}: tiers done ${checkpoint.tiersDone.join(', ')}`);
    } else if (opts.restart) {
      console.error(`    --restart: discarding ${pPath} (${verdict.reasons.join('; ')})`);
      unlinkSync(pPath);
    } else {
      throw new Error(
        `refusing to resume from ${pPath}, which does not match this run:\n  - ${verdict.reasons.join('\n  - ')}\n` +
          'Pass --restart to discard it and start this era from the first tier.',
      );
    }
  }

  const began = Date.now();
  for (const tier of tiers) {
    const tierUsd = Number(tier / 1_000_000n);
    if (checkpoint.tiersDone.includes(tierUsd)) continue;
    const t0 = Date.now();
    const evaluation = runRegisteredEvaluation({
      dataset: sweepDataset,
      config,
      artifact,
      tiers: [tier],
      policyIds: policies,
      decideOpts: DEFAULT_DECIDE_OPTS,
      calibrationFraction: CALIBRATION_FRACTION,
      warmupSnapshots,
      registration: reg,
    });
    const rows = sizeSweepRowsFrom(evaluation.results);
    checkpoint.rows = [...checkpoint.rows.filter((r) => r.tierUsd !== tierUsd), ...rows];
    checkpoint.tiersDone = [...checkpoint.tiersDone, tierUsd];
    writeFileSync(pPath, JSON.stringify(checkpoint, null, 2) + '\n');
    const srcla = rows.find((r) => r.policyId === 'srcla');
    console.error(
      `    [${era}] tier $${tierUsd.toLocaleString('en-US')} done in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
        `(elapsed ${((Date.now() - began) / 1000).toFixed(1)}s, ${checkpoint.tiersDone.length}/${tiers.length})` +
        (srcla === undefined ? '' : ` srcla net ${(srcla.netApy * 100).toFixed(3)}%, min cov ${srcla.coverageMin.toFixed(3)}`),
    );
  }

  const rows = [...checkpoint.rows].sort(
    (a, b) => a.tierUsd - b.tierUsd || policies.indexOf(a.policyId) - policies.indexOf(b.policyId),
  );
  const sweep: SizeSweep = {
    kind: 'size-sweep',
    era,
    stride,
    s2CoverageFloor: REGISTERED_S2_COVERAGE_FLOOR,
    warning: warning ?? null,
    codeCommit: opts.commit,
    artifactHash: artifact.artifactHash,
    generatedAt: new Date().toISOString(),
    origins: key.origins,
    datasetStart: key.datasetStart,
    datasetEnd: key.datasetEnd,
    gasDigest: key.gasDigest,
    rows,
    registeredTierCheck: { checked: false, source: null, compared: 0, mismatches: [], reason: 'not yet checked', notes: [] },
  };
  sweep.registeredTierCheck = checkFor(outDir, sweep);
  const outPath = `${base}.json`;
  writeFileSync(outPath, JSON.stringify(sweep, null, 2) + '\n');
  unlinkSync(pPath);
  console.error(`    sweep -> ${outPath}`);
  return outPath;
}

async function main(): Promise<void> {
  const outDir = arg('out-dir') ?? '..';
  if (process.argv.includes('--render-only')) {
    const mismatches = publish(outDir);
    if (mismatches > 0) {
      console.error(`[size-sweep] ${mismatches} registered-tier mismatches; outputs written, exiting 1`);
      process.exitCode = 1;
    }
    return;
  }
  const eras = [...new Set((arg('eras') ?? 'heldout-c,heldout-b').split(',').map((e) => e.trim()))] as EraTag[];
  for (const e of eras) {
    if (!(e in REGISTERED_ERAS)) throw new Error(`unknown era '${e}'`);
  }
  const stride = Number(arg('stride') ?? 1);
  if (!Number.isInteger(stride) || stride < 1) throw new Error('--stride must be a positive integer');
  const tiers = parseTierList(arg('tiers'));
  const policies = parsePolicyList(
    arg('policies'),
    REGISTERED_POLICIES.map((p) => p.id),
  );
  const subset = isSubsetRun(policies, tiers);
  const artifactPath = arg('artifact') ?? 'config/registered-artifact.json';
  const commit = codeCommit();
  const restart = process.argv.includes('--restart');

  const prisma = new PrismaClient();
  let mismatches = 0;
  try {
    for (const era of eras) {
      const path = await runEra(prisma, era, { outDir, stride, tiers, policies, artifactPath, commit, subset, restart });
      if (subset) {
        // A subset is not published: no figures, no report section.
        const sweep = parseSizeSweep(JSON.parse(readFileSync(path, 'utf8')), path);
        mismatches += sweep.registeredTierCheck.mismatches.length;
        console.error(`    subset run: ${path} is not drawn or spliced`);
      }
    }
    if (!subset) mismatches += publish(outDir);
  } finally {
    await prisma.$disconnect();
  }
  if (mismatches > 0) {
    console.error(`[size-sweep] ${mismatches} registered-tier mismatches; outputs written, exiting 1`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
