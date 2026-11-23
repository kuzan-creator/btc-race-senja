# btc-race-senja

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/kuzan-creator/btc-race-senja/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/kuzan-creator/btc-race-senja/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Senja Breakout — a cbBTC trend rider for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC. One idea, kept small: Bitcoin's 1-minute bars are mostly noise and every round trip costs about 26 bps, so the bot trades rarely and only rides a real push. It buys a new 60-minute high with full cash, rides it with a 2.5% trailing stop, and only re-enters above the old ride's peak. If it has never filled by bar 1320 it buys half size so the entry always meets the race guardrail of at least one trade.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=00sgd8yt&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
