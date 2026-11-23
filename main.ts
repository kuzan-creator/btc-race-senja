// Senja Breakout v2 — a cbBTC trend rider for make.fun's "Race a BTC trading
// bot live for 24 hours" (btc-race-24h-20261123-0511).
//
// v2 follows the top-10 race-mode recipe (their titles all name it): a
// two-trigger rider — a 60-minute breakout, a dip-reclaim buy, and a
// confirmed 4-hour trend entry — full size, one wide trailing stop, almost
// no trading. The top 10 all show 430-460 trades and $151.00 on the dev
// board, but those trades are the DP-fitted DEV schedule (hindsight on the
// published dev window, hundreds of tiny fractional nibbles); their RACE
// modes all read as 1-8 big trades (dip-rider, 4h-trend +1.5% entry, 1.5%
// trailing stop). More trades in the race only bleed fees: a causal
// 78-trade EMA-cross bot loses $120 on this window, and tranching loses
// to full size. So v2 adds entry triggers, never trade frequency.
//
// What sets the PnL-per-trade frontier (measured on the dev window with an
// exact-fill DP): one $1,000 round trip costs ~$4.53 (about 45 bps — 4 bps
// fee + 2 bps slippage + ~33 bps price impact at ~$597k depth), so a swing
// must beat ~0.45% to be worth trading at full size. The dev window holds
// only a few such swings (of 24 non-overlapping 60-min windows, 4 swing
// >1%, 2 swing >2%), so the binary full-size ceiling is $115.60 at 20
// round trips and extra full-size trades LOSE money; partial sizing lifts
// the ceiling toward the board's $151 only by nibbling small swings with
// hundreds of fractional orders. The efficient point is a handful of
// full-size rides: 1 round trip $47.11, 5 round trips $94.05, 10 round
// trips $110.67 — versus $151 at ~230 round trips ($0.66 per trip).
// The race window is unseen, so v2 optimises for the efficient point,
// not the fitted ceiling.
//
//   - Entry (any one fires, full cash, long only):
//       * breakout: close prints a new 60-minute high AND above the old
//         ride's peak (re-entry filter, stops fakeout chains);
//       * dip-reclaim: the 60-min range dipped >=1% from its high, and the
//         close has bounced >=0.5% off the 60-min low while still >=0.5%
//         below the high — buy the dip, not the top;
//       * confirmed trend: 240-minute return above +1.5%.
//   - Ride: a 2.5% trailing stop from the highest close since entry. No
//     other exit — no EMA cross, no fixed target, no time exit.
//   - Fallback: if the bot has still never filled by bar 1320, it buys half
//     size (trailing 1%) so the entry always meets the race guardrail of at
//     least one trade; at bar 1400 it buys that half size unconditionally.
//
// Backtests on the published dev window (1,440 bars, BTC $58,957 -> $61,102):
// full window +$29.50 (1 trade, max drawdown 2.0%), first half +$25.30,
// second half +$2.70 — identical to v1, because the breakout fires first
// and rides the whole trend. On rolling 240-bar windows (11 windows, fresh
// $1,000 each) v2 averages +$1.14/window with 5/11 winning windows, versus
// v1's -$0.12 and 4/11: the extra triggers add a little robustness without
// adding trades. Few big rides beat many small ones, and the dev gate only
// needs a profit above $0 — the race window, not the dev board, decides
// the prize.
//
// Deterministic: only bigint arithmetic on the bars themselves, no clock,
// no randomness, no network, no files. Two runs on the same data answer
// every batch identically.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 60;
const TREND_LOOKBACK = 240;
const TRAIL_BPS = 250;
const FALLBACK_TRAIL_BPS = 100;
const FALLBACK_BAR = 1320;
const LAST_CHANCE_BAR = 1400;
const MAX_SLIPPAGE_BPS = 300;

const closes: bigint[] = [];
const highs: bigint[] = [];
const lows: bigint[] = [];
let peak = 0n;
let ceiling = 0n;
let inFallback = false;
let everFilled = false;

function trailPrice(p: bigint, bps: number): bigint {
  return (p * BigInt(10000 - bps)) / 10000n;
}

function retBps(now: bigint, ago: bigint): bigint {
  if (ago <= 0n) return 0n;
  return ((now - ago) * 10000n) / ago;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    for (const f of batch.fills) if (f.status === 'filled') everFilled = true;
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (!bar) return [];
    const close = BigInt(bar.c);
    const high = BigInt(bar.h);
    const low = BigInt(bar.l);
    closes.push(close);
    highs.push(high);
    lows.push(low);

    const pos = state.positions.get(SYMBOL);
    const qty = pos ? pos.qty : 0n;
    const orders: OrderInput[] = [];

    if (qty > 0n) {
      if (close > peak) peak = close;
      const trail = inFallback ? FALLBACK_TRAIL_BPS : TRAIL_BPS;
      if (close < trailPrice(peak, trail)) {
        ceiling = peak;
        inFallback = false;
        orders.push({ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      return orders;
    }

    if (closes.length > LOOKBACK) {
      let prevHigh = 0n;
      let rangeLow = 0n;
      let rangeHigh = 0n;
      for (let i = closes.length - LOOKBACK - 1; i < closes.length - 1; i++) {
        if (highs[i] > prevHigh) prevHigh = highs[i];
        if (rangeHigh === 0n || highs[i] > rangeHigh) rangeHigh = highs[i];
        if (rangeLow === 0n || lows[i] < rangeLow) rangeLow = lows[i];
      }
      const breakout = close > prevHigh && (ceiling === 0n || close > ceiling);
      // Dip-reclaim: the 60-min range dipped >=1% from its high, the close
      // has bounced >=0.5% off the 60-min low, still >=0.5% below the high.
      const rangeBps = retBps(rangeHigh, rangeLow);
      const dipReclaim =
        rangeBps >= 100n &&
        close * 10000n >= rangeLow * 10050n &&
        close * 10000n < rangeHigh * 9950n;
      // Confirmed trend: 240-minute return above +1.5%.
      const trend =
        closes.length > TREND_LOOKBACK &&
        retBps(close, closes[closes.length - TREND_LOOKBACK - 1]) > 150n;
      // Never open on the last two batches: a buy there fills at the final
      // bar's open and is flattened at its close, paying fees for no ride.
      if ((breakout || dipReclaim || trend) && state.seq < 1438 && state.cash >= 1000000n) {
        peak = close;
        inFallback = false;
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
        return orders;
      }
    }

    if (!everFilled && state.seq >= FALLBACK_BAR && state.seq < 1438 && closes.length > LOOKBACK) {
      const r60 = retBps(close, closes[closes.length - 61]);
      const lastChance = state.seq >= LAST_CHANCE_BAR;
      if (lastChance || r60 > -150n) {
        const spend = state.cash / 2n;
        if (spend >= 1000000n) {
          peak = close;
          inFallback = true;
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
    }
    return orders;
  },
});
