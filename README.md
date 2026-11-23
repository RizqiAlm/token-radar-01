# Token Radar v2 — radar-2

Pre-token protocols ranked by expected implied value, from the sealed DefiLlama
snapshot (2026-11-14, 758 protocols, watchlist floor $50M).

## Model

- Value: log(mcap) = 6.9646 + 0.5223 x ln(TVL), fitted on the 128 traded comps
  (R2 0.194, LOO RMSE 2.107, walk-forward RMSE 2.439 vs mean 2.728). TVL alone is
  weak; growth, age, chain count, squared TVL and shrunk category means were tested
  and dropped for worsening held-out error. Every row carries its 80% interval.
- Token odds: logistic fit on all 758 protocols (traded = symbol on record),
  AUC 0.645, LOO log-loss 0.661 vs base rate 0.688, discounted by the share still
  untraded at the protocol's age (survivor discount).
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
