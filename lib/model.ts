// Token Radar v3 ("radar-3"): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor that pass the watchlist's own exclusion rules in
// full. A protocol is pre-token when its index entry records no token (no market cap, no
// CoinGecko id, no symbol); live-token protocols are kept apart and shown as the market's own
// values, never mixed into the ranked board.
//
// The value model is fitted, not asserted. On the 128 traded comps (mcap_usd > 0) the log-log
// fit is log(mcap) = 6.9646 + 0.5223 * log(tvl), R2 0.194, residual SD 2.09 in log space.
// It is weak and the dashboard says so: the typical miss is 3.40x (median of exp(|LOO
// residual|)), so every implied value carries an 80% interval, not just a point.
// Every extra term was tested on held-out data and dropped because it made held-out error
// worse (LOO RMSE / 5-fold CV / walk-forward 70-30, in log space; baseline mean = 2.728):
//   logTVL only                    LOO 2.107, CV 2.117, WF 2.439   <-- kept
//   + growth (7d, clamped)         LOO 2.115, CV 2.123, WF 2.443
//   + growth + log age             LOO 2.135, CV 2.143, WF 2.505
//   + chains, logTVL^2             LOO 2.127-2.152, CV 2.134-2.165, WF 2.535-2.614
//   + growth^2, |growth|, lt*age   LOO 2.147-2.198, WF 2.505-2.731
//   + shrunk category mean         5-fold CV 2.152-2.211 vs 2.143 without it (k = 20..2)
//   ridge on 12 wide features      CV 2.194-2.353, WF 2.524-2.650
//   Huber / LAD (median) fit       CV 2.119-2.121, median |err| no better than OLS
// Walk-forward uses only the 95 comps with a listed_at (the 33 without one have no time
// to walk forward on; v1's split sorted them last, putting them all in the test set and
// reporting 2.439). Clean splits: oldest 70% dated -> newest 30% dated, RMSE 2.305
// (median miss 3.41x); 80/20, RMSE 2.577; train listed before 2024, test 2024 and later,
// RMSE 2.058 (median miss 2.91x); the mean baseline is 2.728. A 2000-resample bootstrap
// of the comps puts the slope at 0.52 with an 80% interval of [0.41, 0.64] and the
// intercept at 6.99 [4.93, 9.09].
// The intervals are conformal per TVL tercile of the comps (cuts at $12.2M and $79.4M TVL):
// the middle tercile's 80% interval is narrower (0.16x-8.45x) than the outer terciles'
// (0.04x-6.82x and 0.06x-9.62x), instead of one global 0.06x-8.63x for every row.
// Rank ranges come from a 200-resample bootstrap of the comps (seeded, deterministic):
// each row's rank is recomputed under every refit, and the board shows the 10th-90th
// percentile rank range, so a rank of 1 that is really 1-6 does not pretend to be exact.
//
// Token odds come from a second fitted model, a logistic regression on all 758 protocols with
// traded = symbol is not null (416 traded, 342 pre-token). v3 adds a quadratic age term,
// which is the one change that improved held-out odds (5-fold CV log-loss 0.652 vs 0.660,
// CV AUC 0.642 vs 0.637, LOO log-loss 0.653 vs 0.661, base rate 0.688). Fitted (ridge
// lambda 1.0): intercept -1.5490, logTVL 0.0420, logAge -0.4096, growth -0.0180,
// logAge^2 0.0866. An interaction term (logTVL x logAge) scored a little better in CV
// (0.645) but was dropped: its coefficients extrapolate wildly outside the comps' range.
// Ages under 90 days are scored as 90 days: only 2 of the 128 comps are younger than
// 90 days, so the fit cannot say anything about newborn protocols, and without the floor
// the quadratic would give a 2-day-old protocol a 58% token odds.
// The cross-sectional fit says older protocols are more often traded (age 0-180d: 26%
// traded; 1095d+: 79%), but that is exposure time, not launch propensity: a protocol
// that is still pre-token at an old age is a survivor, and survivors are increasingly
// drawn from protocols that never launch. So the odds applied to a pre-token row are the
// cross-sectional probability discounted by the share still untraded at its age,
// token_odds = p_cross * (1 - F_age), where F_age is an age-only logistic fit
// (intercept -4.1398, logAge 0.6924, also floored at 90 days). At $100M TVL and 0%
// growth the adjusted odds are 0.22 at 30 days, 0.23 at 1 year, 0.20 at 1500 days and
// 0.16 at 3000 days: roughly flat, falling for the oldest survivors, never a claim that
// old survivors are the most likely to launch.
//
// Implied expected value = exp(predicted log mcap) * token_odds, with the 80% interval
// [exp(pred + q10_tercile) * odds, exp(pred + q90_tercile) * odds]. Growth and age enter
// the expected value through the token odds (and age sets the farm hold); the launch value
// itself comes from TVL alone because no other term survived held-out testing. No protocol
// name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted model, as the dashboard states it. */
export interface ModelConstants {
  log_intercept: number;
  log_slope: number;
  resid_sd: number;
  loo_rmse: number;
  loo_med_abs: number;
  loo_med_mult: number;
  walkforward_rmse: number;
  walkforward80_rmse: number;
  walkforward2024_rmse: number;
  walkforward_med_mult: number;
  walkforward_baseline: number;
  loo_q10: number;
  loo_q90: number;
  r2: number;
  n_comps: number;
  slope_lo80: number;
  slope_hi80: number;
  /** TVL tercile cuts (log TVL) of the comps, for the conformal intervals. */
  tercile_cut1: number;
  tercile_cut2: number;
  /** 80% conformal interval (log space) per TVL tercile: [q10, q90]. */
  tercile_q10: [number, number, number];
  tercile_q90: [number, number, number];
  odds_intercept: number;
  odds_log_tvl: number;
  odds_log_age: number;
  odds_growth: number;
  odds_log_age_sq: number;
  odds_age_intercept: number;
  odds_age_log_age: number;
  odds_auc: number;
  odds_cv_auc: number;
  odds_loo_logloss: number;
  odds_baseline_logloss: number;
  odds_brier: number;
  odds_brier_cv: number;
  odds_brier_baseline: number;
  /** Assumed airdrop pool as a share of expected implied value (an assumption, stated). */
  airdrop_pool_pct: number;
  /** Assumed eligible wallets splitting that pool (an assumption, stated). */
  airdrop_wallets: number;
}

export const MODEL: ModelConstants = {
  log_intercept: 6.9646,
  log_slope: 0.5223,
  resid_sd: 2.09,
  loo_rmse: 2.107,
  loo_med_abs: 1.223,
  loo_med_mult: 3.399,
  walkforward_rmse: 2.305,
  walkforward80_rmse: 2.577,
  walkforward2024_rmse: 2.058,
  walkforward_med_mult: 3.41,
  walkforward_baseline: 2.728,
  loo_q10: -2.7825,
  loo_q90: 2.1551,
  r2: 0.194,
  n_comps: 128,
  slope_lo80: 0.406,
  slope_hi80: 0.635,
  tercile_cut1: 16.3174,
  tercile_cut2: 18.1905,
  tercile_q10: [-3.2677, -1.8188, -2.8553],
  tercile_q90: [1.9197, 2.1342, 2.2633],
  odds_intercept: -1.549,
  odds_log_tvl: 0.042,
  odds_log_age: -0.4096,
  odds_growth: -0.018,
  odds_log_age_sq: 0.0866,
  odds_age_intercept: -4.1398,
  odds_age_log_age: 0.6924,
  odds_auc: 0.649,
  odds_cv_auc: 0.642,
  odds_loo_logloss: 0.653,
  odds_baseline_logloss: 0.688,
  odds_brier: 0.228,
  odds_brier_cv: 0.23,
  odds_brier_baseline: 0.248,
  airdrop_pool_pct: 0.05,
  airdrop_wallets: 5000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** The cap on early rows below the watchlist floor. The snapshot holds 138 eligible ones. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A protocol's farm economics, all in dollars and active hours. */
export interface FarmEconomics {
  capital_usd: number;
  gas_per_tx_usd: number;
  tx_count: number;
  gas_usd: number;
  total_cost_usd: number;
  total_hours: number;
  hold_days: number;
  expected_airdrop_usd: number;
  net_usd: number;
  usd_per_hour: number;
  break_even_airdrop_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  token_odds: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  /** 10th-90th percentile rank over 200 bootstrap refits of the comps (seeded). */
  rank_lo: number;
  rank_hi: number;
  model: {
    log_tvl: number;
    pred_log_mcap: number;
    growth_pct: number;
    age_days: number | null;
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  token_odds: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  rank_lo: number;
  rank_hi: number;
  growth_pct: number;
  farm: FarmEconomics;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  audit: {
    total: number;
    traded: number;
    pre_token: number;
    rankable: number;
    excluded: number;
    comps_mcap: number;
    /** Pre-token protocols excluded, by first exclusion reason. */
    excluded_by_category: number;
    excluded_by_versioned: number;
    excluded_by_wrapped: number;
    excluded_by_exchange: number;
    /** Rankable protocols at/above the floor the watchlist leaves out (parentage is not
        provable from the snapshot's ten fields, so they are counted, not ranked). */
    above_floor_not_watchlist: number;
  };
  farm_counts: { FARM: number; THIN: number; SKIP: number };
  bootstrap: {
    resamples: number;
    slope_lo80: number;
    slope_hi80: number;
    intercept_lo80: number;
    intercept_hi80: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** log(1 + age in days); an unknown age is treated as 365 days, the same fallback everywhere. */
function logAge(age: number | null): number {
  return Math.log1p(age ?? 365);
}

/**
 * log(1 + age) for the token-odds fit, floored at 90 days: only 2 of the 128 comps are
 * younger than 90 days, so the quadratic age term is not trusted below that.
 */
function logAgeForOdds(age: number | null): number {
  return Math.log1p(Math.max(age ?? 365, 90));
}

/** The fitted log market cap for a TVL, and the launch (median) value in dollars. */
export function launchValue(tvlUsd: number, model: ModelConstants): { predLog: number; launch: number } {
  const predLog = model.log_intercept + model.log_slope * Math.log(Math.max(1, tvlUsd));
  return { predLog, launch: Math.exp(predLog) };
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * A pre-token protocol's token odds. The cross-sectional logistic probability that a
 * protocol with this TVL, age and growth has a token, discounted by the share still
 * untraded at its age (the survivor discount: see the header). Clamped to [0.01, 0.60]
 * so no row claims certainty or impossibility from a weak fit.
 */
export function tokenOdds(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const age = ageDays(asOf, protocol.listed_at);
  const growth = Math.min(120, Math.max(-60, finite(protocol.change_7d, 0)));
  const la = logAgeForOdds(age);
  const logit =
    model.odds_intercept +
    model.odds_log_tvl * Math.log(Math.max(1, protocol.tvl_usd)) +
    model.odds_log_age * la +
    model.odds_growth * growth +
    model.odds_log_age_sq * la * la;
  const pCross = sigmoid(logit);
  const fAge = sigmoid(model.odds_age_intercept + model.odds_age_log_age * la);
  const odds = pCross * (1 - fAge);
  return Math.min(0.6, Math.max(0.01, odds));
}

/** Which TVL tercile of the comps a TVL falls in (0 low, 1 middle, 2 high). */
export function tvlTercile(tvlUsd: number, model: ModelConstants): number {
  const lt = Math.log(Math.max(1, tvlUsd));
  if (lt < model.tercile_cut1) return 0;
  if (lt < model.tercile_cut2) return 1;
  return 2;
}

/** The implied expected value and its 80% interval for one protocol. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; launch: number; odds: number; lo: number; hi: number; predLog: number; growthPct: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(120, Math.max(-60, finite(protocol.change_7d, 0)));
  const { predLog, launch } = launchValue(protocol.tvl_usd, model);
  const odds = tokenOdds(protocol, asOf, model);
  const implied = Math.max(1, Math.round(launch * odds));
  const tercile = tvlTercile(protocol.tvl_usd, model);
  const lo = Math.max(1, Math.round(Math.exp(predLog + model.tercile_q10[tercile]!) * odds));
  const hi = Math.max(lo + 1, Math.round(Math.exp(predLog + model.tercile_q90[tercile]!) * odds));
  return { implied, launch: Math.round(launch), odds, lo, hi, predLog, growthPct, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule excludes outright. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol name must not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's
 * exclusion rules in full — excluded category, versioned name, a whole word wrapped /
 * staked / staking in the name, or an exchange's name at the start. (The snapshot carries
 * no parentProtocol field, so a protocol the watchlist leaves out for having a parent is
 * not provable from the file; the board never adds a protocol at or above the floor that
 * the watchlist leaves out, and the audit counts the 20 such protocols as left out.)
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  const padded = ` ${p.name.toLowerCase()} `;
  if (padded.includes(' wrapped ') || padded.includes(' staked ') || padded.includes(' staking ')) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Cheap L2 / app-chain names: gas there is assumed $0.50 a transaction (see gasPerTx). */
const CHEAP_CHAINS = new Set([
  'Base', 'Arbitrum', 'Arbitrum Nova', 'Optimism', 'Polygon', 'zkSync Era', 'Blast', 'Linea',
  'Scroll', 'Mantle', 'Mode', 'Ink', 'Abstract', 'ApeChain', 'Astar zkEVM', 'BOB', 'Fraxtal',
  'Zora', 'World Chain', 'Unichain', 'Soneium', 'Berachain', 'Sei', 'Sui', 'Aptos', 'Movement',
]);

/**
 * Assumed gas per transaction on a chain. Ethereum is expensive ($5), Solana is cheap
 * ($0.05), listed L2s and cheap chains are $0.50, every other chain is $2. These are
 * planning assumptions, stated on the dashboard, not measured fees: real gas moves.
 */
export function gasPerTx(chain: string): number {
  if (chain === 'Ethereum') return 5;
  if (chain === 'Solana') return 0.05;
  if (CHEAP_CHAINS.has(chain)) return 0.5;
  return 2;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

/**
 * A protocol's farm economics. Gas is the only cost counted against the airdrop: the
 * capital is deployed and comes back when the position unwinds, so it is shown as capital
 * at risk, not spent. Expected airdrop per wallet is an ASSUMPTION, stated on the
 * dashboard: the airdrop pool is 5% of the row's expected implied value, split across
 * 5,000 eligible wallets. Nothing about the pool size or the wallet count is measured;
 * the verdict follows from that assumption, and the dashboard says so.
 * Verdict: FARM when expected pay is at least $5 an active hour, THIN when it covers
 * gas but pays less, SKIP when it does not cover gas.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number, model: ModelConstants): FarmEconomics {
  const chain = chainOf(p);
  const gasTx = gasPerTx(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const txCount = 2 + weeks + 2;
  const gas = Math.round(gasTx * txCount * 100) / 100;
  const totalHours = Math.round((0.5 + weeks * (10 / 60) + 0.5) * 100) / 100;
  const expectedAirdrop = Math.round(implied * model.airdrop_pool_pct / model.airdrop_wallets * 100) / 100;
  const net = Math.round((expectedAirdrop - gas) * 100) / 100;
  const usdPerHour = Math.round((net / totalHours) * 100) / 100;
  const verdict: FarmEconomics['verdict'] = usdPerHour >= 5 ? 'FARM' : expectedAirdrop >= gas ? 'THIN' : 'SKIP';
  return {
    capital_usd: capital,
    gas_per_tx_usd: gasTx,
    tx_count: txCount,
    gas_usd: gas,
    total_cost_usd: gas,
    total_hours: totalHours,
    hold_days: hold,
    expected_airdrop_usd: expectedAirdrop,
    net_usd: net,
    usd_per_hour: usdPerHour,
    break_even_airdrop_usd: gas,
    verdict,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age) and its farm
 * economics, never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const capital = econ.capital_usd;
  const hold = econ.hold_days;
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `${money(econ.gas_per_tx_usd)} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital plus ${money(econ.gas_per_tx_usd * 2)} of gas for the two setup transactions`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week for ${weeks} weeks, such as a deposit, a borrow, a swap or a vote, while the position stays open.`,
      cost: `${money(econ.gas_per_tx_usd)} of gas a week, ${money(econ.gas_per_tx_usd * weeks)} in all`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position; no extra gas`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: `${money(econ.gas_per_tx_usd)} of gas for the claim transaction`,
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, then unwind the position with one exit transaction.`,
      cost: `${money(econ.gas_per_tx_usd)} of gas to exit; total gas ${money(econ.gas_usd)} over ${econ.tx_count} transactions`,
      time: '5 minutes plus the exit',
    },
  ];
}

/** A small deterministic PRNG (mulberry32) so bootstrap refits are byte-identical run to run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Closed-form OLS for log(mcap) on log(TVL) over a list of (logTVL, logMcap) points. */
function olsLogLog(points: Array<[number, number]>): { intercept: number; slope: number } {
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { intercept, slope };
}

/** Percentile by nearest rank (p in [0,1]) of a sorted array. */
function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[i]!;
}

/**
 * Rank ranges from bootstrap refits of the value model. The comps are resampled with
 * replacement (200 resamples, seeded), the log-log fit is refit each time, every board
 * row is rescored (launch value from the refit, same token odds), and ranks are recorded.
 * Returns, per slug, the 10th and 90th percentile rank, plus the bootstrap distribution
 * of the fitted slope and intercept. The point ranking never changes: this only measures
 * how stable it is.
 */
function bootstrapRankRanges(
  snapshot: Snapshot,
  scored: Array<{ p: SnapshotProtocol; odds: number }>,
  model: ModelConstants,
): { ranges: Map<string, { lo: number; hi: number }>; slopeLo: number; slopeHi: number; interceptLo: number; interceptHi: number } {
  const comps = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => [Math.log(Math.max(1, p.tvl_usd)), Math.log(p.mcap_usd!)] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ranksBySlug = new Map<string, number[]>();
  for (const s of scored) ranksBySlug.set(s.p.slug, []);
  const slopes: number[] = [];
  const intercepts: number[] = [];
  const rng = mulberry32(20261114);
  const RESAMPLES = 200;
  for (let b = 0; b < RESAMPLES; b++) {
    const sample: Array<[number, number]> = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const fit = olsLogLog(sample);
    slopes.push(fit.slope);
    intercepts.push(fit.intercept);
    const rescored = scored
      .map((s) => ({ slug: s.p.slug, value: Math.exp(fit.intercept + fit.slope * Math.log(Math.max(1, s.p.tvl_usd))) * s.odds }))
      .sort((a, z) => z.value - a.value || (a.slug < z.slug ? -1 : a.slug > z.slug ? 1 : 0));
    rescored.forEach((r, i) => ranksBySlug.get(r.slug)!.push(i + 1));
  }
  slopes.sort((a, z) => a - z);
  intercepts.sort((a, z) => a - z);
  const ranges = new Map<string, { lo: number; hi: number }>();
  for (const [slug, ranks] of ranksBySlug) {
    ranks.sort((a, z) => a - z);
    ranges.set(slug, { lo: quantileSorted(ranks, 0.1), hi: quantileSorted(ranks, 0.9) });
  }
  return {
    ranges,
    slopeLo: quantileSorted(slopes, 0.1),
    slopeHi: quantileSorted(slopes, 0.9),
    interceptLo: quantileSorted(intercepts, 0.1),
    interceptHi: quantileSorted(intercepts, 0.9),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it
  // cannot, but the board's coverage is the gate's row and is never gambled on a missing
  // record). Watchlist rows are taken as named, whatever the visible rules say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that pass the
  // watchlist's exclusion rules in full, by TVL, capped. Never a replacement for a
  // watchlist row: a chosen protocol stays chosen. The snapshot holds 138 such
  // protocols, so the board is 40 + 138 = 178 rows; 200 is not reachable under the
  // full rules, and the board does not pad itself with excluded protocols to reach it.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    const econ = farmEconomics(p, v.age, v.implied, model);
    return { p, v, econ };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Implied values are integers from a continuous model, so two rows can round to the
  // same dollar. Force strictly decreasing integers (a $1 step down where they collide)
  // so the ranking is a ranking, not a tie, and no value is invented: a collided row
  // keeps the lower of its rounded value and one dollar below the row above it.
  let prev = Number.POSITIVE_INFINITY;
  const boot = bootstrapRankRanges(
    snapshot,
    scored.map((s) => ({ p: s.p, odds: s.v.odds })),
    model,
  );
  const rows = scored.map((s, i) => {
    let implied = s.v.implied;
    if (implied >= prev) implied = prev - 1;
    if (implied < 1) implied = 1;
    prev = implied;
    const steps = farmSteps(s.p, s.v.age, s.econ).map(stepText);
    const rawRange = boot.ranges.get(s.p.slug) ?? { lo: i + 1, hi: i + 1 };
    // Two rows can be so close in value that the point rank sits outside the
    // bootstrap 10th-90th range (the refits usually order them the other way).
    // The range is a stability statement about the point rank, so it contains it.
    const range = { lo: Math.min(rawRange.lo, i + 1), hi: Math.max(rawRange.hi, i + 1) };
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.v.age,
      implied_value_usd: implied,
      launch_value_usd: s.v.launch,
      token_odds: Math.round(s.v.odds * 1000000) / 1000000,
      implied_lo_usd: s.v.lo,
      implied_hi_usd: s.v.hi,
      rank_lo: range.lo,
      rank_hi: range.hi,
      model: {
        log_tvl: Math.round(Math.log(Math.max(1, s.p.tvl_usd)) * 10000) / 10000,
        pred_log_mcap: Math.round(s.v.predLog * 10000) / 10000,
        growth_pct: s.v.growthPct,
        age_days: s.v.age,
      },
      farm: s.econ,
      farm_steps: steps,
    };
  });
  return rows;
}

/** The board plus the bootstrap distribution behind its rank ranges. */
export function buildBoardWithBootstrap(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): {
  board: BoardRow[];
  bootstrap: { resamples: number; slopeLo: number; slopeHi: number; interceptLo: number; interceptHi: number };
} {
  const board = buildBoard(snapshot, model);
  // Recompute the bootstrap once for the dashboard's slope/intercept interval. It is
  // seeded and deterministic, so it agrees with the rank ranges buildBoard computed.
  const boot = bootstrapRankRanges(
    snapshot,
    board.map((r) => ({
      p: snapshot.protocols.find((p) => p.slug === r.slug)!,
      odds: r.token_odds,
    })),
    model,
  );
  return {
    board,
    bootstrap: {
      resamples: 200,
      slopeLo: Math.round(boot.slopeLo * 1000) / 1000,
      slopeHi: Math.round(boot.slopeHi * 1000) / 1000,
      interceptLo: Math.round(boot.interceptLo * 100) / 100,
      interceptHi: Math.round(boot.interceptHi * 100) / 100,
    },
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value_usd: row.launch_value_usd,
    token_odds: row.token_odds,
    implied_lo_usd: row.implied_lo_usd,
    implied_hi_usd: row.implied_hi_usd,
    rank_lo: row.rank_lo,
    rank_hi: row.rank_hi,
    growth_pct: row.model.growth_pct,
    farm: row.farm,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
/** First exclusion reason for a pre-token protocol, in the watchlist rule's order. */
function exclusionReason(p: SnapshotProtocol): 'category' | 'versioned' | 'wrapped' | 'exchange' | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category';
  if (VERSIONED.test(p.name)) return 'versioned';
  const padded = ` ${p.name.toLowerCase()} `;
  if (padded.includes(' wrapped ') || padded.includes(' staked ') || padded.includes(' staking ')) return 'wrapped';
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return 'exchange';
  return null;
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, bootstrap } = buildBoardWithBootstrap(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const traded = snapshot.protocols.filter((p) => p.symbol !== null).length;
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const rankable = snapshot.protocols.filter(isRankable).length;
  const watchlist = new Set(snapshot.watchlist);
  let byCategory = 0;
  let byVersioned = 0;
  let byWrapped = 0;
  let byExchange = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || isRankable(p)) continue;
    const reason = exclusionReason(p);
    if (reason === 'category') byCategory++;
    else if (reason === 'versioned') byVersioned++;
    else if (reason === 'wrapped') byWrapped++;
    else if (reason === 'exchange') byExchange++;
  }
  const aboveFloorNotWatchlist = snapshot.protocols.filter(
    (p) => isRankable(p) && p.tvl_usd >= snapshot.floor_usd && !watchlist.has(p.slug),
  ).length;
  const farmCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) farmCounts[r.farm.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    audit: {
      total: snapshot.protocols.length,
      traded,
      pre_token: preToken,
      rankable,
      excluded: preToken - rankable,
      comps_mcap: snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
      excluded_by_category: byCategory,
      excluded_by_versioned: byVersioned,
      excluded_by_wrapped: byWrapped,
      excluded_by_exchange: byExchange,
      above_floor_not_watchlist: aboveFloorNotWatchlist,
    },
    farm_counts: farmCounts,
    bootstrap,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
