# SRCLA forecast-horizon study (1d / 7d / 14d) — non-gating

Supplementary and **non-gating**. It changes no registered gate, threshold, artifact or verdict; `report/SRCLA-REPORT.md` remains the registered result.

## Why 7d and 14d were not in the registered run

§11.5's forecast gate runs Christoffersen's independence test on **non-overlapping** horizon windows (overlapping residuals are serially dependent by construction) and needs at least 30 of them. The registered freeze therefore keeps only horizons testable on **every sealed era** (`testableHorizons`). That is not a shortage of archived data. The archive holds every hourly origin from 2024-03-15, the Base deployment floor for all three venues, to today with zero gaps. The limit is the length of the sealed eras:

| Sealed era | Days | Non-overlapping windows at 1d | at 7d | at 14d |
|---|---:|---:|---:|---:|
| `heldout-c` | 86 | 85 | 12 | 6 |
| `heldout-b` | 30 | 30 | 4 | 2 |
| **this study's window** | **479** | **479** | **68** | **34** |

Base history cannot be extended further back, because none of the three venues existed on Base before March 2024. The only new data was 2026-09-14 → 2026-09-23 (214 hourly origins, backfilled for this study with 0 gaps). To give 7d and 14d enough windows, this study **tests on the whole post-calibration window** (2025-06-01 → 2026-09-23): `burned-a` + `heldout-c` + `burned` + `heldout-b`. `heldout-d` is not touched.

## Method

- **One artifact per horizon, all fit on the calibration era only** (2024-03-15 → 2025-05-31). The registered freeze runs with its grid forced to one horizon (`freeze-artifact.ts --horizon 7|14`), so each horizon picks its own forecaster and coverage target by the same §7.3/P18 loss. 1d is the registered artifact itself. Nothing is refit on the test window.
- **Forecast calibration** runs the registered forecast gate (`runForecastGate`, both the v0.10 and the P37 forms) on labels from the test window alone. No warm-up labels are used, so no in-sample residual is scored.
- **Policy replay** puts SRCLA and B0–B5 through the same decide path as the registered run (`runRegisteredEvaluation`, hourly origins, measured gas, registered harness config) at the four registered tiers, in six fresh-vault segments of 86–92 days that cover the whole window (see below).
- **Caveat, and it matters:** the window **pools design data**. The two burned windows were read while designing the amendments, and both held-out eras are design data since v0.9/v0.11. It is out of sample for every artifact here, since none was fit on it, but it is **not a held-out test**. The same replay limitation as the registered run applies: accrued yield is credited to total assets only, so capital at work is overstated and stressed coverage understated for every policy.

## The three artifacts

| Horizon | Forecaster | Coverage target | Artifact | Test origins | Test labels |
|---|---|---:|---|---:|---:|
| 1d | `state-space` {"halfLifeObservations":24} | 0.99 | `694cf86f6f7363f2…` | 11,497 | 34,419 |
| 7d | `ew-residual` {"decay":0.9} | 0.9 | `1c3f20e126cea21b…` | 11,497 | 33,987 |
| 14d | `ew-residual` {"decay":0.9} | 0.95 | `bebfacc4d2ffb1e4…` | 11,497 | 33,483 |

## Forecast calibration on the pooled window

Coverage = share of realised horizon returns at or above the forecast's lower bound (target = the artifact's coverage level, which each horizon selects for itself: 99% at 1d, 90% at 7d, 95% at 14d, so compare coverage with its own target). Kupiec tests the breach rate. Christoffersen tests independence on the thinned stream, and its "windows" column is the number of non-overlapping windows it ran on. At 7d and 14d this is the first time the longer horizons have ≥ 30 windows. The table shows the **P37** form (one-sided Kupiec for a lower bound, P34 domain). The registered v0.10 form follows it.

### P37 form

| Horizon | Venue | Obs. | Coverage | Target | Coverage check | Kupiec p | Kupiec | Christoffersen windows | Christoffersen p | Christoffersen |
|---|---|---:|---:|---:|---|---:|---|---:|---:|---|
| 1d | `aave-v3-usdc` | 10169 | 100.00% | 99% | PASS | 1.0000 | PASS | 439 | 1.0000 | PASS |
| 1d | `compound-v3-usdc` | 11443 | 99.83% | 99% | PASS | 1.0000 | PASS | 477 | 1.0000 | PASS |
| 1d | `moonwell-usdc` | 10569 | 98.66% | 99% | PASS | 0.0004 | **FAIL** | 443 | 0.0005 | **FAIL** |
| 7d | `aave-v3-usdc` | 11299 | 99.81% | 90% | PASS | 1.0000 | PASS | 68 | 1.0000 | PASS |
| 7d | `compound-v3-usdc` | 11299 | 94.74% | 90% | PASS | 1.0000 | PASS | 68 | 0.4759 | PASS |
| 7d | `moonwell-usdc` | 10491 | 90.43% | 90% | PASS | 1.0000 | PASS | 64 | 0.5626 | PASS |
| 14d | `aave-v3-usdc` | 11131 | 100.00% | 95% | PASS | 1.0000 | PASS | 34 | 1.0000 | PASS |
| 14d | `compound-v3-usdc` | 11131 | 99.59% | 95% | PASS | 1.0000 | PASS | 34 | 1.0000 | PASS |
| 14d | `moonwell-usdc` | 10155 | 95.47% | 95% | PASS | 1.0000 | PASS | 32 | 0.7962 | PASS |

### Registered v0.10 form

| Horizon | Venue | Obs. | Coverage | Target | Coverage check | Kupiec p | Kupiec | Christoffersen windows | Christoffersen p | Christoffersen |
|---|---|---:|---:|---:|---|---:|---|---:|---:|---|
| 1d | `aave-v3-usdc` | 10169 | 100.00% | 99% | PASS | 0.0000 | **FAIL** | 439 | 0.0121 | **FAIL** |
| 1d | `compound-v3-usdc` | 11443 | 99.83% | 99% | PASS | 0.0000 | **FAIL** | 477 | 0.0083 | **FAIL** |
| 1d | `moonwell-usdc` | 11203 | 98.53% | 99% | PASS | 0.0000 | **FAIL** | 470 | 0.0042 | **FAIL** |
| 7d | `aave-v3-usdc` | 11299 | 99.81% | 90% | PASS | 0.0000 | **FAIL** | 68 | 0.0008 | **FAIL** |
| 7d | `compound-v3-usdc` | 11299 | 94.74% | 90% | PASS | 0.0000 | **FAIL** | 68 | 0.3698 | PASS |
| 7d | `moonwell-usdc` | 11299 | 89.24% | 90% | PASS | 0.0076 | **FAIL** | 68 | 0.8929 | PASS |
| 14d | `aave-v3-usdc` | 11131 | 100.00% | 95% | PASS | 0.0000 | **FAIL** | 34 | 0.1748 | PASS |
| 14d | `compound-v3-usdc` | 11131 | 99.59% | 95% | PASS | 0.0000 | **FAIL** | 34 | 0.1748 | PASS |
| 14d | `moonwell-usdc` | 11131 | 93.52% | 95% | **FAIL** | 0.0000 | **FAIL** | 34 | 0.8121 | PASS |

**Whole forecast gate on the pooled window** (every check, including the grid, regime-purity and completeness checks):

| Horizon | Registered v0.10 | P37 | Blocked on (P37) |
|---|---|---|---|
| 1d | **FAIL** | **FAIL** | Kupiec unconditional coverage, one-sided — moonwell-usdc; Christoffersen independence — moonwell-usdc |
| 7d | **FAIL** | **FAIL** | Regime purity |
| 14d | **FAIL** | **FAIL** | Regime purity |

Regime purity is the share of label windows that straddle a governance rate-model change (tolerance 10%). It rises with the horizon, because a longer label window is more likely to contain a rate-model change. That is a property of the horizon, so more data does not fix it.

Regime purity per horizon (pooled, P37 form):

- **1d** — PASS: 1231 of 34419 label windows straddle a regime change (3.58%, tolerance 10%)
- **7d** — **FAIL**: 6335 of 33987 label windows straddle a regime change (18.64%, tolerance 10%)
- **14d** — **FAIL**: 9541 of 33483 label windows straddle a regime change (28.50%, tolerance 10%)

### Per sub-era: why the sealed eras alone cannot test 7d and 14d

Christoffersen windows (fewest over the three venues) and the lowest venue coverage, P37 form, when each sub-era is tested on its own. Below 30 windows the independence test is NOT PRODUCED, shown with the most windows that sub-era could ever hold at that horizon. That is why the registered run could not test 7d or 14d on `heldout-c` or `heldout-b`. At 1d, `heldout-b` is NOT PRODUCED because P34 removes most Moonwell residuals during the drain.

| Horizon | `burned-a` windows (min over venues) / coverage (min) | `heldout-c` windows (min over venues) / coverage (min) | `burned` windows (min over venues) / coverage (min) | `heldout-b` windows (min over venues) / coverage (min) |
|---|---|---|---|---|
| 1d | 262 / 99.03% | 72 / 100.00% | 77 / 96.19% | NOT PRODUCED (≤ 30) / 100.00% |
| 7d | 39 / 93.69% | NOT PRODUCED (≤ 12) / 93.12% | NOT PRODUCED (≤ 12) / 77.38% | NOT PRODUCED (≤ 4) / 98.66% |
| 14d | NOT PRODUCED (≤ 19) / 97.25% | NOT PRODUCED (≤ 6) / 96.02% | NOT PRODUCED (≤ 6) / 88.88% | NOT PRODUCED (≤ 2) / 100.00% |

## Policy outcomes across the window

Each horizon's artifact drives SRCLA at the four registered tiers. The window is replayed as six consecutive **segments of 86–92 days**, each starting from a fresh vault at the tier (`burned-a` in three parts, then `heldout-c`, `burned`, `heldout-b`), with the registered warm-up before each. That is the registered run's own shape: one continuous 479-day replay would apply 68 weekly 5%-of-NAV redemptions and shrink every vault to ~3% of its tier. Net APY below is compounded over the six segments and annualized. Capital at work is origin-weighted. Min coverage is the worst origin in any segment. Rebalances, turnover and costs are summed. The baselines run through the same kernel with the same artifact, so kernel baselines (B1–B3, B5) also move with the horizon. B0 is idle by definition. B2u and B5 are diagnostics, not deployable comparators (B5 is bounded hindsight).

### SRCLA by horizon

"Net APY excl. `heldout-b`" compounds the five segments before the Moonwell drain, whose quoted rate could not be withdrawn. "Min coverage excl. `heldout-b`" is the same restriction. S2's floor is 0.95.

| Tier | Horizon | Net APY | Net APY excl. `heldout-b` | Capital at work | Min coverage | Min coverage excl. `heldout-b` | Rebalances | Turnover (USDC) | Costs (USDC) | Displayed − realized |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| $10k | 1d | 5.645% | 4.556% | 94.2% | 0.854 | 1.000 | 121 | 135,822 | 0.27 | 0.12% |
| $10k | 7d | 5.619% | 4.523% | 95.0% | 0.754 | 0.980 | 160 | 123,482 | 0.30 | 0.07% |
| $10k | 14d | 5.709% | 4.617% | 95.8% | 0.653 | 0.653 | 141 | 106,918 | 0.27 | 0.02% |
| $100k | 1d | 5.641% | 4.552% | 94.2% | 0.854 | 1.000 | 125 | 1,371,412 | 0.27 | 0.12% |
| $100k | 7d | 5.622% | 4.526% | 95.0% | 0.754 | 0.980 | 168 | 1,238,481 | 0.31 | 0.06% |
| $100k | 14d | 5.699% | 4.607% | 95.1% | 0.591 | 0.591 | 147 | 1,085,185 | 0.26 | 0.05% |
| $1M | 1d | 5.414% | 4.502% | 94.1% | 0.999 | 0.999 | 135 | 13,277,142 | 0.31 | 0.14% |
| $1M | 7d | 5.629% | 4.533% | 95.0% | 0.754 | 0.971 | 179 | 11,453,188 | 0.34 | 0.06% |
| $1M | 14d | 5.547% | 4.466% | 92.6% | 0.792 | 0.792 | 253 | 19,347,270 | 0.62 | 0.19% |
| $10M | 1d | 3.359% | 3.284% | 74.3% | 1.000 | 1.000 | 768 | 513,533,109 | 1.28 | 1.29% |
| $10M | 7d | 3.641% | 3.470% | 80.6% | 0.685 | 0.685 | 718 | 419,803,907 | 0.95 | 0.86% |
| $10M | 14d | 1.507% | 1.428% | 31.0% | 1.000 | 1.000 | 599 | 309,574,121 | 0.93 | 4.01% |

### Net APY, every policy, by horizon

| Tier | Horizon | SRCLA | B0 | B1 | B2 | B2U | B3 | B4 | B5 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| $10k | 1d | 5.645% | 0.000% | 4.745% | 4.549% | 4.733% | 5.526% | 5.479% | 5.754% |
| $10k | 7d | 5.619% | 0.000% | 4.579% | 4.459% | 4.637% | 5.552% | 5.430% | 5.792% |
| $10k | 14d | 5.709% | 0.000% | 4.287% | 4.273% | 4.544% | 5.663% | 5.430% | 5.860% |
| $100k | 1d | 5.641% | 0.000% | 4.758% | 4.542% | 4.734% | 5.530% | 5.480% | 5.758% |
| $100k | 7d | 5.622% | 0.000% | 4.591% | 4.458% | 4.637% | 5.555% | 5.431% | 5.795% |
| $100k | 14d | 5.699% | 0.000% | 4.298% | 4.271% | 4.545% | 5.635% | 5.431% | 5.832% |
| $1M | 1d | 5.414% | 0.000% | 4.759% | 4.450% | 4.666% | 5.477% | 5.480% | 5.761% |
| $1M | 7d | 5.629% | 0.000% | 4.592% | 4.431% | 4.566% | 5.511% | 5.431% | 5.795% |
| $1M | 14d | 5.547% | 0.000% | 4.299% | 3.488% | 4.547% | 4.246% | 5.431% | 5.691% |
| $10M | 1d | 3.359% | 0.000% | 4.541% | 3.477% | 3.773% | 3.637% | 5.480% | 4.302% |
| $10M | 7d | 3.641% | 0.000% | 4.347% | 3.368% | 3.402% | 3.907% | 5.431% | 4.248% |
| $10M | 14d | 1.507% | 0.000% | 4.217% | 2.165% | 3.015% | 2.432% | 5.431% | 2.264% |

### Net APY excl. `heldout-b`, every policy, by horizon

| Tier | Horizon | SRCLA | B0 | B1 | B2 | B2U | B3 | B4 | B5 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| $10k | 1d | 4.556% | 0.000% | 4.564% | 4.451% | 4.632% | 4.443% | 4.793% | 4.664% |
| $10k | 7d | 4.523% | 0.000% | 4.438% | 4.325% | 4.497% | 4.452% | 4.740% | 4.672% |
| $10k | 14d | 4.617% | 0.000% | 4.173% | 4.081% | 4.365% | 4.569% | 4.740% | 4.744% |
| $100k | 1d | 4.552% | 0.000% | 4.577% | 4.443% | 4.633% | 4.447% | 4.794% | 4.668% |
| $100k | 7d | 4.526% | 0.000% | 4.450% | 4.323% | 4.496% | 4.455% | 4.741% | 4.674% |
| $100k | 14d | 4.607% | 0.000% | 4.184% | 4.083% | 4.367% | 4.539% | 4.741% | 4.714% |
| $1M | 1d | 4.502% | 0.000% | 4.578% | 4.299% | 4.507% | 4.456% | 4.794% | 4.666% |
| $1M | 7d | 4.533% | 0.000% | 4.451% | 4.203% | 4.350% | 4.476% | 4.741% | 4.675% |
| $1M | 14d | 4.466% | 0.000% | 4.185% | 3.406% | 4.269% | 3.157% | 4.741% | 4.570% |
| $10M | 1d | 3.284% | 0.000% | 4.452% | 3.492% | 3.809% | 3.441% | 4.794% | 3.982% |
| $10M | 7d | 3.470% | 0.000% | 4.285% | 3.307% | 3.460% | 3.615% | 4.741% | 3.995% |
| $10M | 14d | 1.428% | 0.000% | 4.151% | 2.203% | 3.070% | 2.267% | 4.741% | 2.223% |

### Min stressed coverage, every policy, by horizon

| Tier | Horizon | SRCLA | B0 | B1 | B2 | B2U | B3 | B4 | B5 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| $10k | 1d | 0.854 | 1.000 | 0.999 | 0.999 | 0.998 | 0.854 | 0.979 | 0.800 |
| $10k | 7d | 0.754 | 1.000 | 0.999 | 0.999 | 0.998 | 0.754 | 0.979 | 0.753 |
| $10k | 14d | 0.653 | 1.000 | 0.999 | 0.965 | 0.999 | 0.591 | 0.979 | 0.591 |
| $100k | 1d | 0.854 | 1.000 | 0.999 | 0.999 | 0.998 | 0.854 | 0.873 | 0.800 |
| $100k | 7d | 0.754 | 1.000 | 0.999 | 0.999 | 0.998 | 0.754 | 0.321 | 0.753 |
| $100k | 14d | 0.591 | 1.000 | 0.999 | 0.999 | 0.999 | 0.591 | 0.321 | 0.591 |
| $1M | 1d | 0.999 | 1.000 | 0.999 | 0.999 | 0.973 | 0.803 | 0.869 | 0.800 |
| $1M | 7d | 0.754 | 1.000 | 0.999 | 0.966 | 0.999 | 0.754 | 0.321 | 0.753 |
| $1M | 14d | 0.792 | 1.000 | 0.999 | 1.000 | 0.973 | 0.755 | 0.321 | 0.753 |
| $10M | 1d | 1.000 | 1.000 | 0.151 | 0.544 | 0.873 | 1.000 | 0.000 | 0.984 |
| $10M | 7d | 0.685 | 1.000 | 0.165 | 0.690 | 0.690 | 0.680 | 0.000 | 0.366 |
| $10M | 14d | 1.000 | 1.000 | 0.105 | 0.677 | 0.600 | 0.966 | 0.000 | 0.610 |

### SRCLA per segment

Net APY / min stressed coverage in each segment. `heldout-b` contains the Moonwell drain (the venue held zero withdrawable cash for about a third of it), so its APY is not attainable yield.

| Tier | Horizon | `burned-a (1/3)` | `burned-a (2/3)` | `burned-a (3/3)` | `heldout-c` | `burned` | `heldout-b` |
|---|---|---:|---:|---:|---:|---:|---:|
| $10k | 1d | 4.81% / 1.000 | 5.89% / 1.000 | 3.71% / 1.000 | 3.25% / 1.000 | 5.06% / 1.000 | 23.35% / 0.854 |
| $10k | 7d | 4.84% / 1.000 | 6.09% / 0.999 | 3.57% / 1.000 | 3.23% / 0.980 | 4.83% / 1.000 | 23.46% / 0.754 |
| $10k | 14d | 4.90% / 1.000 | 6.43% / 0.653 | 3.54% / 1.000 | 3.29% / 0.944 | 4.87% / 0.962 | 23.46% / 0.754 |
| $100k | 1d | 4.78% / 1.000 | 5.89% / 1.000 | 3.71% / 1.000 | 3.26% / 1.000 | 5.06% / 1.000 | 23.36% / 0.854 |
| $100k | 7d | 4.84% / 1.000 | 6.09% / 0.999 | 3.57% / 1.000 | 3.23% / 0.980 | 4.84% / 1.000 | 23.46% / 0.754 |
| $100k | 14d | 4.77% / 1.000 | 6.50% / 0.591 | 3.54% / 1.000 | 3.29% / 0.942 | 4.88% / 0.962 | 23.46% / 0.754 |
| $1M | 1d | 4.81% / 1.000 | 5.89% / 0.999 | 3.65% / 1.000 | 3.19% / 1.000 | 4.91% / 1.000 | 20.05% / 1.000 |
| $1M | 7d | 4.85% / 1.000 | 6.11% / 0.999 | 3.56% / 1.000 | 3.22% / 0.971 | 4.88% / 1.000 | 23.46% / 0.754 |
| $1M | 14d | 4.73% / 1.000 | 6.01% / 0.792 | 3.53% / 1.000 | 3.52% / 0.925 | 4.50% / 1.000 | 23.11% / 0.802 |
| $10M | 1d | 3.57% / 1.000 | 4.57% / 1.000 | 3.44% / 1.000 | 2.55% / 1.000 | 2.26% / 1.000 | 4.48% / 1.000 |
| $10M | 7d | 3.92% / 1.000 | 4.44% / 1.000 | 3.37% / 0.975 | 2.76% / 0.685 | 2.81% / 1.000 | 6.24% / 1.000 |
| $10M | 14d | 1.74% / 1.000 | 1.71% / 1.000 | 1.89% / 1.000 | 1.02% / 1.000 | 0.76% / 1.000 | 2.70% / 1.000 |

