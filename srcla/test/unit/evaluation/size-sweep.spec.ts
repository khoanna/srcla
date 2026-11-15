/**
 * The non-gating vault-size sweep: row extraction, the registered-tier
 * consistency check, the eight figures, the report section and its splice.
 */
import type { PolicyRunResult } from '../../../src/evaluation/kernel/harness.js';
import { tickStep } from '../../../src/evaluation/report/charts.js';
import {
  ADD_YIELD_DISCLOSURE,
  WHOLE_USDC_NOTE,
  checkpointResumable,
  isPublishedSizeSweepFile,
  isSubsetRun,
  parsePolicyList,
  parseSizeSweep,
  parseTierList,
  registeredTierCheckFrom,
  shownYieldOnDeployed,
  sizeSweepBasename,
  sortSweepsForReport,
  staleSizeFigures,
  type SweepCheckpointKey,
  SIZE_SWEEP_POLICIES,
  SIZE_SWEEP_TIERS,
  compareWithRegistered,
  renderSizeSweepSection,
  signedDomain,
  sizeSweepFigures,
  sizeSweepRowsFrom,
  spliceSizeSweepSection,
  type SizeSweep,
  type SizeSweepRow,
} from '../../../src/evaluation/report/size-sweep.js';

const USD = 1_000_000n;

function fakeResult(over: {
  policyId: string;
  tierUsd: number;
  netApy?: number;
  capitalAtWork?: number | null;
  withdrawalSuccessRate?: number | null;
  fullExit?: number | null;
  censored?: boolean;
  venueShares?: Record<string, number>;
  rebalances?: number;
}): PolicyRunResult {
  return {
    policy: { id: over.policyId },
    tier: BigInt(over.tierUsd) * USD,
    rebalances: over.rebalances ?? 3,
    inertVsSrcla: false,
    replay: {
      realizedNetApy: over.netApy ?? 0.04,
      capitalAtWorkFraction: over.capitalAtWork === undefined ? 0.8 : over.capitalAtWork,
      totalTurnover: 12_500_000n,
      totalCosts: 250_000n,
      withdrawalSuccessRate: over.withdrawalSuccessRate === undefined ? 1 : over.withdrawalSuccessRate,
      minStressedLiquidCoverage: 0.9,
      coverageDistribution: { min: 0.9, p05: 0.95, median: 1 },
      timeToFullExitOrigins: over.fullExit === undefined ? 2 : over.fullExit,
      timeToFullExitCensored: over.censored ?? false,
      venueStressContribution: over.venueShares ?? { 'aave-v3-usdc': 0.01, 'moonwell-usdc': 0.07 },
      displayedVsRealizedGapApy: -0.002,
    },
  } as unknown as PolicyRunResult;
}

function row(policyId: string, tierUsd: number, over: Partial<SizeSweepRow> = {}): SizeSweepRow {
  return {
    policyId,
    tierUsd,
    netApy: 0.03 + tierUsd / 1e9,
    capitalAtWork: 0.9,
    yieldOnDeployed: (0.03 + tierUsd / 1e9) / 0.9,
    rebalances: 5,
    turnoverUsdc: 100,
    costsUsdc: 1,
    withdrawalSuccessRate: 1,
    coverageMin: 0.96,
    coverageP05: 0.98,
    coverageMedian: 1,
    fullExitOrigins: 1,
    fullExitCensored: false,
    maxVenueShare: 0.1,
    maxVenueShareMarket: 'aave-v3-usdc',
    displayedMinusRealizedApy: policyId === 'b1' ? -0.01 : 0.004,
    ...over,
  };
}

const TIERS_USD = SIZE_SWEEP_TIERS.map((t) => Number(t / USD));

function sweep(era = 'heldout-c', over: Partial<SizeSweep> = {}): SizeSweep {
  const rows: SizeSweepRow[] = [];
  for (const p of SIZE_SWEEP_POLICIES) {
    for (const t of TIERS_USD) {
      rows.push(
        p === 'b0'
          ? row(p, t, { netApy: 0, capitalAtWork: 0, yieldOnDeployed: null, rebalances: 0, coverageMin: 1 })
          : row(p, t),
      );
    }
  }
  return {
    kind: 'size-sweep',
    era,
    stride: 1,
    s2CoverageFloor: 0.95,
    warning: null,
    codeCommit: 'abc123',
    artifactHash: 'deadbeef',
    generatedAt: '2026-09-16T00:00:00.000Z',
    origins: 2064,
    datasetStart: '2026-03-01T00:00:00.000Z',
    datasetEnd: '2026-05-25T23:00:00.000Z',
    rows,
    registeredTierCheck: { checked: true, source: '../evaluation-heldout-c.json', compared: 32, mismatches: [] },
    ...over,
  };
}

describe('SIZE_SWEEP_TIERS / SIZE_SWEEP_POLICIES', () => {
  it('holds 20 ascending sizes from 10k to 10M including the four registered tiers', () => {
    expect(SIZE_SWEEP_TIERS).toHaveLength(20);
    expect(TIERS_USD[0]).toBe(10_000);
    expect(TIERS_USD[19]).toBe(10_000_000);
    expect([...TIERS_USD].sort((a, b) => a - b)).toEqual(TIERS_USD);
    for (const r of [10_000, 100_000, 1_000_000, 10_000_000]) expect(TIERS_USD).toContain(r);
  });

  it('runs SRCLA and B0-B5', () => {
    expect(SIZE_SWEEP_POLICIES).toEqual(['srcla', 'b0', 'b1', 'b2', 'b2u', 'b3', 'b4', 'b5']);
  });
});

describe('sizeSweepRowsFrom', () => {
  it('extracts whole-USDC money, coverage distribution, exit and max venue share', () => {
    const [r] = sizeSweepRowsFrom([fakeResult({ policyId: 'srcla', tierUsd: 50_000, netApy: 0.04, capitalAtWork: 0.8 })]);
    expect(r).toMatchObject({
      policyId: 'srcla',
      tierUsd: 50_000,
      netApy: 0.04,
      capitalAtWork: 0.8,
      rebalances: 3,
      turnoverUsdc: 12.5,
      costsUsdc: 0.25,
      withdrawalSuccessRate: 1,
      coverageMin: 0.9,
      coverageP05: 0.95,
      coverageMedian: 1,
      fullExitOrigins: 2,
      fullExitCensored: false,
      maxVenueShare: 0.07,
      maxVenueShareMarket: 'moonwell-usdc',
      displayedMinusRealizedApy: -0.002,
      turnoverBase: '12500000',
      costsBase: '250000',
    });
    expect(r!.yieldOnDeployed).toBeCloseTo(0.05, 12);
  });

  it('carries nulls: no capital at work, no withdrawal attempted, never exited, no venue held', () => {
    const [r] = sizeSweepRowsFrom([
      fakeResult({
        policyId: 'b0',
        tierUsd: 10_000,
        netApy: 0,
        capitalAtWork: null,
        withdrawalSuccessRate: null,
        fullExit: null,
        censored: true,
        venueShares: {},
      }),
    ]);
    expect(r!.capitalAtWork).toBeNull();
    expect(r!.yieldOnDeployed).toBeNull();
    expect(r!.withdrawalSuccessRate).toBeNull();
    expect(r!.fullExitOrigins).toBeNull();
    expect(r!.fullExitCensored).toBe(true);
    expect(r!.maxVenueShare).toBeNull();
    expect(r!.maxVenueShareMarket).toBeNull();
  });

  it('has no yield on deployed capital when capital at work is zero', () => {
    const [r] = sizeSweepRowsFrom([fakeResult({ policyId: 'b0', tierUsd: 10_000, netApy: 0, capitalAtWork: 0 })]);
    expect(r!.capitalAtWork).toBe(0);
    expect(r!.yieldOnDeployed).toBeNull();
  });
});

describe('compareWithRegistered', () => {
  const record = (over: Record<string, unknown> = {}) => ({
    record: {
      manifest: { dataset: { startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-05-25T23:00:00.000Z' } },
      results: {
        artifactHash: 'deadbeef',
        results: [
          { policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.03001, rebalances: 5, minStressedLiquidCoverage: 0.96 },
          { policyId: 'b1', tier: '100000000000', realizedNetApy: 0.0301, rebalances: 5, minStressedLiquidCoverage: 0.96 },
          { policyId: 'h1', tier: '10000000000', realizedNetApy: 1, rebalances: 99, minStressedLiquidCoverage: 0 },
          { policyId: 'srcla', tier: '25000000000', realizedNetApy: 9, rebalances: 99, minStressedLiquidCoverage: 0 },
        ],
        ...over,
      },
    },
  });
  const rows = [row('srcla', 10_000), row('b1', 100_000), row('srcla', 25_000)];
  const window = { artifactHash: 'deadbeef', datasetStart: '2026-03-01T00:00:00.000Z', datasetEnd: '2026-05-25T23:00:00.000Z' };

  it('finds no mismatch when the registered tiers agree, ignoring policies and tiers the sweep does not share', () => {
    const out = compareWithRegistered(rows, record(), window);
    expect(out.mismatches).toEqual([]);
    expect(out.compared).toBe(2);
  });

  it('reports a mismatch per field rather than throwing', () => {
    const bad = record({
      results: [
        { policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.031, rebalances: 6, minStressedLiquidCoverage: 0.96 },
      ],
    });
    const out = compareWithRegistered(rows, bad, window);
    expect(out.mismatches).toEqual([
      { policyId: 'srcla', tierUsd: 10_000, field: 'netApy', sweep: 0.03001, registered: 0.031 },
      { policyId: 'srcla', tierUsd: 10_000, field: 'rebalances', sweep: 5, registered: 6 },
      { policyId: 'b1', tierUsd: 100_000, field: 'missing', sweep: 'swept', registered: null },
    ]);
    expect(out.compared).toBe(1);
  });

  it('tolerates 1e-12 of float noise but not more', () => {
    const near = record({
      results: [
        { policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.03001 + 1e-14, rebalances: 5, minStressedLiquidCoverage: 0.96 + 1e-9 },
      ],
    });
    const out = compareWithRegistered(rows, near, window);
    expect(out.mismatches.filter((m) => m.policyId === 'srcla').map((m) => m.field)).toEqual(['coverageMin']);
  });

  it('compares capital at work when the source carries it (SRCLA-REPORT.json shape)', () => {
    const report = {
      runs: [
        { era: 'heldout-b', artifactHash: 'deadbeef', results: [] },
        {
          era: 'heldout-c',
          artifactHash: 'deadbeef',
          results: [
            { policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.03001, rebalances: 5, minStressedLiquidCoverage: 0.96, capitalAtWorkFraction: 0.5 },
          ],
        },
      ],
    };
    const out = compareWithRegistered(rows, report, { ...window, era: 'heldout-c' });
    expect(out.compared).toBe(1);
    expect(out.mismatches).toEqual([
      { policyId: 'srcla', tierUsd: 10_000, field: 'capitalAtWork', sweep: 0.9, registered: 0.5 },
      { policyId: 'b1', tierUsd: 100_000, field: 'missing', sweep: 'swept', registered: null },
    ]);
  });

  it('flags a different artifact, and a different window as ONE run-level mismatch with no pair compared', () => {
    const bad = record({
      artifactHash: 'other',
      results: [{ policyId: 'srcla', tier: '10000000000', realizedNetApy: 9, rebalances: 99, minStressedLiquidCoverage: 0 }],
    });
    const out = compareWithRegistered(rows, bad, { ...window, datasetEnd: '2026-05-26T00:00:00.000Z' });
    expect(out.mismatches.map((m) => m.field)).toEqual(['artifactHash', 'datasetWindow']);
    expect(out.mismatches[1]!.policyId).toBe('*');
    expect(String(out.mismatches[1]!.sweep)).toContain('dataset window differs');
    expect(out.compared).toBe(0);
  });

  it('treats a different origin count as a window change (run record: one share price per origin)', () => {
    const rec = record({
      results: [
        { policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.03001, rebalances: 5, minStressedLiquidCoverage: 0.96, sharePricesWad: ['1', '2', '3'] },
      ],
    });
    expect(compareWithRegistered([row('srcla', 10_000)], rec, { ...window, origins: 3 }).mismatches).toEqual([]);
    const out = compareWithRegistered([row('srcla', 10_000)], rec, { ...window, origins: 4 });
    expect(out.mismatches.map((m) => m.field)).toEqual(['datasetWindow']);
  });

  it('compares money exactly in base units, withdrawals, exit and the displayed gap', () => {
    const report = {
      runs: [
        {
          era: 'heldout-c',
          artifactHash: 'deadbeef',
          origins: 2064,
          provenance: { gasSeriesDigest: '0xgas' },
          results: [
            {
              policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.03001, rebalances: 5, minStressedLiquidCoverage: 0.96,
              capitalAtWorkFraction: 0.9, totalTurnoverBase: '100000001', totalCostsBase: '1000000', withdrawalSuccessRate: null,
              timeToFullExitOrigins: null, timeToFullExitCensored: true, displayedVsRealizedGapApy: 0.005,
            },
          ],
        },
      ],
    };
    const r = row('srcla', 10_000, { turnoverBase: '100000000', costsBase: '1000000' });
    const out = compareWithRegistered([r], report, { era: 'heldout-c', artifactHash: 'deadbeef', origins: 2064, gasDigest: '0xgas' });
    expect(out.mismatches.map((m) => m.field)).toEqual([
      'turnoverBase',
      'withdrawalSuccessRate',
      'fullExitOrigins',
      'fullExitCensored',
      'displayedMinusRealizedApy',
    ]);
    expect(out.notes).toEqual([]);
    expect(compareWithRegistered([r], report, { era: 'heldout-c', gasDigest: '0xother' }).mismatches[0]!.field).toBe('gasSeriesDigest');
  });

  it('compares whole-USDC money to 1e-6 for an older sweep JSON without base units, and says so', () => {
    const rec = record({
      results: [
        { policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.03001, rebalances: 5, minStressedLiquidCoverage: 0.96, totalTurnoverBase: '100000000', totalCostsBase: '1000002' },
      ],
    });
    const out = compareWithRegistered([row('srcla', 10_000)], rec, window);
    expect(out.mismatches.map((m) => m.field)).toEqual(['costsBase']);
    expect(out.notes).toEqual([WHOLE_USDC_NOTE]);
  });
});

describe('signedDomain', () => {
  it('spans negative values with zero on a tick of the axis the chart will draw', () => {
    expect(signedDomain(-0.7, 1.3)).toEqual({ min: -1, max: 1.5 });
    for (const [lo, hi] of [[-0.7, 1.3], [-1.62, 9.9], [-0.004, 0.0003], [-12, -3], [-3.3, 47]] as const) {
      const d = signedDomain(lo, hi);
      expect(d.min).toBeLessThanOrEqual(lo);
      expect(d.max).toBeGreaterThanOrEqual(Math.max(hi, 0));
      const step = tickStep(d.max - d.min);
      expect(Math.abs(d.min / step - Math.round(d.min / step))).toBeLessThan(1e-9);
      expect(Math.abs(d.max / step - Math.round(d.max / step))).toBeLessThan(1e-9);
    }
  });

  it('starts at zero for non-negative data', () => {
    expect(signedDomain(0.2, 3).min).toBe(0);
  });
});

describe('sizeSweepFigures', () => {
  const figures = sizeSweepFigures(sweep('heldout-b', { warning: 'WARNING: moonwell-usdc held ZERO withdrawable cash' }));

  it('draws eight figures named by number, slug and era', () => {
    expect(figures).toHaveLength(8);
    figures.forEach((f, i) => {
      expect(f.filename).toMatch(new RegExp(`^SRCLA-SIZE-FIG${i + 1}-[a-z0-9-]+-heldout-b\\.svg$`));
      expect(f.caption.startsWith(`**Size figure ${i + 1} — `)).toBe(true);
      expect(f.caption).toContain('registered tiers');
      expect(f.svg).toContain('non-gating');
      expect(f.svg).toContain('20 vault sizes');
    });
  });

  it('draws every policy, marks every size and enlarges the four registered tiers', () => {
    const apy = figures[0]!.svg;
    for (const p of SIZE_SWEEP_POLICIES) expect(apy).toContain(`data-role="series" data-policy="${p}"`);
    const sizes = SIZE_SWEEP_TIERS.length;
    const markers = [...apy.matchAll(/<circle data-role="marker" data-policy="srcla"[^>]* r="([\d.]+)"/g)];
    expect(markers).toHaveLength(sizes);
    expect(markers.filter((m) => m[1] === '5')).toHaveLength(4);
    expect([...apy.matchAll(/data-role="x-tick-label"/g)]).toHaveLength(sizes);
  });

  it('carries the dry-venue warning on the yield figures 1, 4 and 6 only', () => {
    figures.forEach((f, i) => {
      const warned = [0, 3, 5].includes(i);
      expect(f.svg.includes('data-role="warning-line"')).toBe(warned);
      expect(f.caption.includes('ZERO withdrawable cash')).toBe(warned);
    });
  });

  it('discloses the replay\'s yield crediting on the capital and coverage figures', () => {
    figures.forEach((f, i) => expect(f.caption.includes(ADD_YIELD_DISCLOSURE)).toBe([1, 2, 7].includes(i)));
    expect(ADD_YIELD_DISCLOSURE).not.toMatch(/\.ts|src\//);
    expect(figures[1]!.caption).toContain('brackets the size range where each policy first falls below the S2 floor');
  });

  it('draws the S2 floor on both coverage figures and the S3 threshold on the venue-share figure', () => {
    expect(figures[1]!.svg).toContain('S2 release floor (0.95)');
    expect(figures[7]!.svg).toContain('S2 release floor (0.95)');
    expect(figures[6]!.svg).toContain('S3 threshold (0.25)');
  });

  it('omits B0 from yield on deployed capital, where it has none', () => {
    expect(figures[3]!.svg).not.toContain('data-policy="b0"');
  });

  it('draws the displayed-minus-realized gap below zero when a policy is negative', () => {
    const labels = [...figures[5]!.svg.matchAll(/data-role="y-tick-label"[^>]*>([^<]*)</g)].map((m) => m[1]!);
    expect(labels.some((l) => l.startsWith('-'))).toBe(true);
    expect(labels).toContain('0');
  });
});

describe('size sweeps without a measured venue share', () => {
  const base = sweep();
  const unmeasured = sweep('heldout-c', { rows: base.rows.map((r) => ({ ...r, maxVenueShare: null, maxVenueShareMarket: null })) });

  it('skips size figure 7 rather than drawing an empty chart', () => {
    const figs = sizeSweepFigures(unmeasured);
    expect(figs).toHaveLength(7);
    expect(figs.some((f) => f.filename.includes('FIG7'))).toBe(false);
    for (const f of figs) expect(f.svg.length).toBeGreaterThan(0);
  });

  it('says in the section that it was not measured', () => {
    const md = renderSizeSweepSection([unmeasured], {}).join('\n');
    expect(md).toContain('Max venue share was not measured');
    expect(renderSizeSweepSection([base], {}).join('\n')).not.toContain('not measured');
  });

  it('states the actual number of sizes in captions', () => {
    const two = sweep('heldout-c', { rows: base.rows.filter((r) => r.tierUsd === 10_000 || r.tierUsd === 1_000_000) });
    for (const f of sizeSweepFigures(two)) {
      expect(f.caption).toContain('2 vault sizes');
      expect(f.caption).not.toContain('20 vault sizes');
    }
  });
});

describe('renderSizeSweepSection', () => {
  const s = sweep();
  const figs = sizeSweepFigures(s);
  const md = renderSizeSweepSection([s], { 'heldout-c': figs }).join('\n');

  it('opens with the non-gating heading and says why', () => {
    expect(md.startsWith('## Vault-size sweep (non-gating)')).toBe(true);
    expect(md).toContain('non-gating');
    expect(md).toContain('B5');
    expect(md).toContain('B0');
  });

  it('states the registered-tier consistency result', () => {
    expect(md).toContain('0 mismatches');
    expect(md).toContain('../evaluation-heldout-c.json');
  });

  it('tabulates SRCLA at all 20 sizes and net APY by policy', () => {
    expect(md).toContain('| $6.5M |');
    expect(md).toContain('| Size | SRCLA | B0 | B1 | B2 | B2u | B3 | B4 | B5 |');
  });

  it('embeds every figure with its caption', () => {
    for (const f of figs) {
      expect(md).toContain(`![${f.filename}](figures/${f.filename})`);
      expect(md).toContain(f.caption);
    }
  });

  it('lists mismatches when the check found some', () => {
    const bad = sweep('heldout-c', {
      registeredTierCheck: {
        checked: true,
        source: 'x.json',
        compared: 1,
        mismatches: [{ policyId: 'srcla', tierUsd: 10_000, field: 'netApy', sweep: 0.1, registered: 0.2 }],
      },
    });
    const text = renderSizeSweepSection([bad], {}).join('\n');
    expect(text).toContain('1 mismatch');
    expect(text).toContain('netApy');
  });
});

describe('spliceSizeSweepSection', () => {
  const block = ['## Vault-size sweep (non-gating)', '', 'new body'];

  it('inserts the section immediately before ## Limitations', () => {
    const md = ['# R', '', '## Results', 'x', '', '## Limitations', 'y'].join('\n');
    expect(spliceSizeSweepSection(md, block)).toBe(
      ['# R', '', '## Results', 'x', '', '## Vault-size sweep (non-gating)', '', 'new body', '', '## Limitations', 'y'].join('\n'),
    );
  });

  it('replaces an existing section and leaves every other line alone', () => {
    const md = ['# R', '## Vault-size sweep (non-gating)', 'old', '', '## Limitations', 'y'].join('\n');
    const once = spliceSizeSweepSection(md, block);
    expect(once).toBe(['# R', '## Vault-size sweep (non-gating)', '', 'new body', '', '## Limitations', 'y'].join('\n'));
    expect(spliceSizeSweepSection(once, block)).toBe(once);
  });

  it('throws when there is no ## Limitations heading to anchor on', () => {
    expect(() => spliceSizeSweepSection('# R\n## Results\n', block)).toThrow(/Limitations/);
  });
});

describe('registeredTierCheckFrom', () => {
  const rows = [row('srcla', 10_000), row('srcla', 25_000)];
  const expect_ = { era: 'heldout-c', artifactHash: 'deadbeef' };
  const runRecord = {
    record: {
      manifest: { dataset: {} },
      results: {
        artifactHash: 'deadbeef',
        results: [{ policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.03001, rebalances: 5, minStressedLiquidCoverage: 0.96 }],
      },
    },
  };
  const report = (capital: number, era = 'heldout-c') => ({
    runs: [
      {
        era,
        artifactHash: 'deadbeef',
        results: [
          { policyId: 'srcla', tier: '10000000000', realizedNetApy: 0.031, rebalances: 5, minStressedLiquidCoverage: 0.96, capitalAtWorkFraction: capital },
        ],
      },
    ],
  });

  it('is NOT CHECKED at a stride above 1, whatever the sources', () => {
    const c = registeredTierCheckFrom({ rows, stride: 3, expect: expect_, sources: [{ path: 'r.json', json: runRecord }] });
    expect(c).toMatchObject({ checked: false, source: null, compared: 0, mismatches: [] });
    expect(c.reason).toContain('stride 3');
  });

  it('is NOT CHECKED with no source holding the era', () => {
    const c = registeredTierCheckFrom({ rows, stride: 1, expect: expect_, sources: [{ path: 'SRCLA-REPORT.json', json: report(0.9, 'heldout-b') }] });
    expect(c.checked).toBe(false);
    expect(c.reason).toContain('evaluation-heldout-c.json');
  });

  it('falls back to SRCLA-REPORT.json alone when there is no run record', () => {
    const c = registeredTierCheckFrom({ rows, stride: 1, expect: expect_, sources: [{ path: 'SRCLA-REPORT.json', json: report(0.9) }] });
    expect(c).toMatchObject({ checked: true, source: 'SRCLA-REPORT.json', compared: 1 });
    expect(c.mismatches.map((m) => m.field)).toEqual(['netApy']);
  });

  it('merges two sources, deduplicating the same (policy, tier, field)', () => {
    const c = registeredTierCheckFrom({
      rows,
      stride: 1,
      expect: expect_,
      sources: [
        { path: 'evaluation-heldout-c.json', json: runRecord },
        { path: 'SRCLA-REPORT.json', json: report(0.5) },
      ],
    });
    expect(c.source).toBe('evaluation-heldout-c.json + SRCLA-REPORT.json');
    expect(c.compared).toBe(1);
    expect(c.mismatches.map((m) => m.field)).toEqual(['netApy', 'capitalAtWork']);
    const twice = registeredTierCheckFrom({
      rows,
      stride: 1,
      expect: expect_,
      sources: [
        { path: 'a', json: report(0.5) },
        { path: 'b', json: report(0.5) },
      ],
    });
    expect(twice.mismatches).toHaveLength(2);
  });
});

describe('checkpointResumable', () => {
  const key: SweepCheckpointKey = {
    era: 'heldout-b',
    stride: 1,
    policies: ['srcla', 'b0'],
    tiers: [10_000, 1_000_000],
    artifactHash: 'deadbeef',
    datasetStart: '2026-08-24T00:00:00.000Z',
    datasetEnd: '2026-09-14T02:00:00.000Z',
    origins: 507,
    gasDigest: '0xgas',
    codeCommit: 'abc',
  };
  const checkpoint = { kind: 'size-sweep-partial', ...key, tiersDone: [10_000], rows: [] };

  it('resumes a checkpoint whose every key field matches', () => {
    expect(checkpointResumable(checkpoint, key)).toEqual({ ok: true, reasons: [] });
  });

  it.each([
    ['datasetEnd', { datasetEnd: '2026-09-16T00:00:00.000Z' }],
    ['origins', { origins: 508 }],
    ['gasDigest', { gasDigest: '0xnew' }],
    ['codeCommit', { codeCommit: 'def' }],
    ['tiers', { tiers: [10_000] }],
    ['policies', { policies: ['srcla'] }],
    ['stride', { stride: 3 }],
    ['artifactHash', { artifactHash: 'other' }],
  ])('refuses when %s differs, naming it', (field, change) => {
    const out = checkpointResumable(checkpoint, { ...key, ...change } as SweepCheckpointKey);
    expect(out.ok).toBe(false);
    expect(out.reasons.some((r) => r.startsWith(field))).toBe(true);
  });

  it('refuses a checkpoint written before the key fields existed', () => {
    const old = { kind: 'size-sweep-partial', era: 'heldout-b', stride: 1, policies: key.policies, artifactHash: 'deadbeef', tiersDone: [], rows: [] };
    const out = checkpointResumable(old, key);
    expect(out.ok).toBe(false);
    expect(out.reasons.join(' ')).toContain('gasDigest');
  });
});

describe('file and argument helpers', () => {
  it('publishes only full sweeps: not checkpoints, not subsets, not the FIG1-3 sweep', () => {
    expect(isPublishedSizeSweepFile('SRCLA-SIZE-SWEEP-heldout-b.json')).toBe(true);
    expect(isPublishedSizeSweepFile('SRCLA-SIZE-SWEEP-heldout-b.partial.json')).toBe(false);
    expect(isPublishedSizeSweepFile('SRCLA-SIZE-SWEEP-heldout-b-subset.json')).toBe(false);
    expect(isPublishedSizeSweepFile('SRCLA-SIZE-SWEEP-heldout-b-subset.partial.json')).toBe(false);
    expect(isPublishedSizeSweepFile('SRCLA-FIGURE-SWEEP-heldout-b.json')).toBe(false);
    expect(sizeSweepBasename('heldout-c', true)).toBe('SRCLA-SIZE-SWEEP-heldout-c-subset');
    expect(sizeSweepBasename('heldout-c', false)).toBe('SRCLA-SIZE-SWEEP-heldout-c');
  });

  it('finds stale size figures for one era only, keeping produced SVGs and their PNGs', () => {
    const existing = [
      'SRCLA-SIZE-FIG1-net-apy-heldout-b.svg',
      'SRCLA-SIZE-FIG1-net-apy-heldout-b.png',
      'SRCLA-SIZE-FIG7-max-venue-share-heldout-b.svg',
      'SRCLA-SIZE-FIG7-max-venue-share-heldout-b.png',
      'SRCLA-SIZE-FIG7-max-venue-share-heldout-c.svg',
      'SRCLA-FIG1-apy-by-vault-size-heldout-b.svg',
      'image.png',
    ];
    expect(staleSizeFigures(existing, 'heldout-b', ['SRCLA-SIZE-FIG1-net-apy-heldout-b.svg'])).toEqual([
      'SRCLA-SIZE-FIG7-max-venue-share-heldout-b.svg',
      'SRCLA-SIZE-FIG7-max-venue-share-heldout-b.png',
    ]);
  });

  it('validates and deduplicates --policies', () => {
    const ids = ['srcla', 'b0', 'b1', 'h1'];
    expect(parsePolicyList(undefined, ids)).toEqual(SIZE_SWEEP_POLICIES);
    expect(parsePolicyList('b1, srcla,b1', ids)).toEqual(['b1', 'srcla']);
    expect(() => parsePolicyList('srcla,b9', ids)).toThrow(/b9/);
  });

  it('deduplicates and sorts --tiers, rejecting non-integers', () => {
    expect(parseTierList(undefined)).toEqual(SIZE_SWEEP_TIERS);
    expect(parseTierList('1000000, 10000,1000000')).toEqual([10_000n * USD, 1_000_000n * USD]);
    expect(() => parseTierList('10k')).toThrow(/10k/);
    expect(() => parseTierList('0')).toThrow();
  });

  it('calls any non-default policy or tier set a subset run', () => {
    expect(isSubsetRun(SIZE_SWEEP_POLICIES, SIZE_SWEEP_TIERS)).toBe(false);
    expect(isSubsetRun([...SIZE_SWEEP_POLICIES].reverse(), SIZE_SWEEP_TIERS)).toBe(false);
    expect(isSubsetRun(['srcla'], SIZE_SWEEP_TIERS)).toBe(true);
    expect(isSubsetRun(SIZE_SWEEP_POLICIES, [10_000n * USD])).toBe(true);
  });
});

describe('parseSizeSweep / sortSweepsForReport', () => {
  it('accepts a sweep written before the base-unit, gas-digest and check-reason fields', () => {
    const old = JSON.parse(JSON.stringify(sweep('heldout-b'))) as Record<string, unknown>;
    delete old.gasDigest;
    (old.rows as Record<string, unknown>[]).forEach((r) => {
      delete r.turnoverBase;
      delete r.costsBase;
    });
    old.registeredTierCheck = { checked: true, source: 'x', compared: 16, mismatches: [] };
    const parsed = parseSizeSweep(old, 'old.json');
    expect(parsed.era).toBe('heldout-b');
    expect(sizeSweepFigures(parsed)).toHaveLength(8);
  });

  it('rejects a non-sweep and names a missing field', () => {
    expect(() => parseSizeSweep({ kind: 'size-sweep-partial' }, 'p.json')).toThrow(/not a size sweep/);
    const noRows = { ...sweep() } as Record<string, unknown>;
    delete noRows.rows;
    expect(() => parseSizeSweep(noRows, 'x.json')).toThrow(/'rows'/);
  });

  it('orders heldout-c, heldout-b, heldout-d, then others by name', () => {
    const order = sortSweepsForReport([sweep('zeta'), sweep('heldout-d'), sweep('heldout-b'), sweep('alpha'), sweep('heldout-c')]);
    expect(order.map((s) => s.era)).toEqual(['heldout-c', 'heldout-b', 'heldout-d', 'alpha', 'zeta']);
  });
});

describe('section rendering: check states, thresholds and two eras', () => {
  it('prints NOT CHECKED with the stride reason', () => {
    const s = sweep('heldout-c', {
      stride: 3,
      registeredTierCheck: { checked: false, source: null, compared: 0, mismatches: [] },
    });
    const md = renderSizeSweepSection([s], {}).join('\n');
    expect(md).toContain('**NOT CHECKED**');
    expect(md).toContain('stride 3');
    expect(md).not.toContain('0 mismatches');
  });

  it('prints NOT CHECKED with the stored reason when no source was found', () => {
    const s = sweep('heldout-c', {
      registeredTierCheck: { checked: false, source: null, compared: 0, mismatches: [], reason: 'no registered result for `heldout-c` was found' },
    });
    expect(renderSizeSweepSection([s], {}).join('\n')).toContain('**NOT CHECKED** — no registered result');
  });

  it('never prints agreement when nothing was compared', () => {
    const s = sweep('heldout-c', {
      registeredTierCheck: {
        checked: true,
        source: 'e.json',
        compared: 0,
        mismatches: [{ policyId: '*', tierUsd: 0, field: 'datasetWindow', sweep: 'dataset window differs: a', registered: 'b' }],
      },
    });
    const md = renderSizeSweepSection([s], {}).join('\n');
    expect(md).toContain('**nothing compared**');
    expect(md).not.toContain('as expected of the same deterministic replay');
    expect(md).toContain('datasetWindow');
  });

  it('prints the whole-USDC note', () => {
    const s = sweep('heldout-c', {
      registeredTierCheck: { checked: true, source: 'e.json', compared: 32, mismatches: [], notes: [WHOLE_USDC_NOTE] },
    });
    expect(renderSizeSweepSection([s], {}).join('\n')).toContain(WHOLE_USDC_NOTE);
  });

  it('shows no yield on deployed below the 5% capital threshold, in the SRCLA table as in figure 4', () => {
    const base = sweep();
    const rows = base.rows.map((r) =>
      r.policyId === 'srcla' && r.tierUsd === 15_000 ? { ...r, capitalAtWork: 0.04, yieldOnDeployed: 0.75 } : r,
    );
    const s = { ...base, rows };
    expect(shownYieldOnDeployed(rows.find((r) => r.policyId === 'srcla' && r.tierUsd === 15_000)!)).toBeNull();
    const line = renderSizeSweepSection([s], {}).find((l) => l.startsWith('| $15k |') && l.includes('4.0%'))!;
    expect(line.split('|')[4]!.trim()).toBe('—');
  });

  it('carries the yield-crediting disclosure in the section text', () => {
    expect(renderSizeSweepSection([sweep()], {}).join('\n')).toContain(ADD_YIELD_DISCLOSURE);
  });

  it('renders two eras in report order and splices them as one section', () => {
    const c = sweep('heldout-c');
    const b = sweep('heldout-b');
    const block = renderSizeSweepSection(sortSweepsForReport([b, c]), {
      'heldout-c': sizeSweepFigures(c),
      'heldout-b': sizeSweepFigures(b),
    });
    const text = block.join('\n');
    expect(text.indexOf('### Era `heldout-c`')).toBeLessThan(text.indexOf('### Era `heldout-b`'));
    expect(text).toContain('figures/SRCLA-SIZE-FIG1-net-apy-heldout-b.svg');
    const md = ['# R', '## Results — era `heldout-b`', 'x', '## Limitations', 'y'].join('\n');
    const once = spliceSizeSweepSection(md, block);
    expect(once.split('\n').filter((l) => l === '## Vault-size sweep (non-gating)')).toHaveLength(1);
    expect(spliceSizeSweepSection(once, block)).toBe(once);
    expect(once.startsWith('# R\n## Results — era `heldout-b`\nx\n## Vault-size sweep (non-gating)')).toBe(true);
    expect(once.endsWith('\n\n## Limitations\ny')).toBe(true);
  });
});
