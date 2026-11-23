# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RizqiAlm/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RizqiAlm/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 178 pre-token protocols by expected implied value, with token odds and costed farm plans. Pre-token protocols ranked by expected implied value, from the sealed DefiLlama snapshot (2026-11-14, 758 protocols, watchlist floor $50M).

## Model

- Value: log(mcap) = 6.9646 + 0.5223 x ln(TVL), fitted on the 128 traded comps
  (R2 0.194, LOO RMSE 2.107, walk-forward RMSE 2.305 on dated comps only vs mean
  2.728, typical miss 3.40x). TVL alone is weak; growth, age, chain count,
  squared TVL, shrunk category means, a 12-feature ridge and Huber/median fits
  were tested and dropped for worsening held-out error. Every row carries its
  80% interval, conformal per TVL tercile, and a bootstrap rank range (200
  refits, seeded).
- Token odds: logistic fit on all 758 protocols (traded = symbol on record),
  with a quadratic age term, AUC 0.649 (5-fold CV 0.642), LOO log-loss 0.653 vs
  base rate 0.688, Brier 0.228 (CV 0.230) vs base rate 0.248, discounted by the
  share still untraded at the protocol's age (survivor discount). Ages under 90
  days are scored as 90 days.
- Expected value = launch value x token odds. Farm plans are costed per chain
  with stated assumptions (airdrop pool 5% of expected value across 5,000
  wallets; gas $5 Ethereum, $0.50 L2s, $0.05 Solana, $2 elsewhere).

## Board

178 rows: all 40 watchlist protocols + 138 early protocols below the floor that
pass the watchlist exclusion rules in full. 200 rows are not reachable under
those rules — 138 is every eligible protocol below the floor — so the board does
not pad itself with wrapped, staked, bridged, versioned or CEX protocols.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22 standard library only. No network at build or at run time.

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
