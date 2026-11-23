// Senja Breakout — a cbBTC trend rider for make.fun's "Race a BTC trading bot
// live for 24 hours" (btc-race-24h-20261123-0511).
//
// One idea, kept deliberately small: Bitcoin's 1-minute bars are mostly noise,
// and every round trip costs about 26 bps in fees, slippage and price impact,
// so this bot trades rarely and only rides a real push.
//
//   - Entry: the close prints a new 60-minute high. Full cash, long only.
//   - Ride: a 2.5% trailing stop from the highest close since entry. No
//     other exit — no EMA cross, no fixed target, no time exit. On the dev
//     window this is one trade: in at bar 183, held to the end, +$29.50.
//   - Re-entry: after a stop-out, only on a close above the old ride's peak,
//     so a choppy market cannot chain fakeouts below a spent high.
//   - Fallback: if the bot has still never filled by bar 1320, it buys half
//     size (trailing 1%) so the entry always meets the race guardrail of at
//     least one trade; at bar 1400 it buys that half size unconditionally.
//
// Backtests on the published dev window (1,440 bars, BTC $58,957 -> $61,102):
// full window +$29.50 (1 trade, max drawdown 2.0%), first half +$25.30,
// second half +$2.70. EMA-cross on the same window loses $120 across 78
// trades; Donchian exits and momentum exits all lose. Few big rides beat
// many small ones, and the dev gate only needs a profit above $0 — the race
// window, not the dev board, decides the prize.
//
// Deterministic: only bigint arithmetic on the bars themselves, no clock,
// no randomness, no network, no files. Two runs on the same data answer
// every batch identically.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 60;
const TRAIL_BPS = 250;
const FALLBACK_TRAIL_BPS = 100;
const FALLBACK_BAR = 1320;
const LAST_CHANCE_BAR = 1400;
const MAX_SLIPPAGE_BPS = 300;

const closes: bigint[] = [];
const highs: bigint[] = [];
let peak = 0n;
let ceiling = 0n;
let inFallback = false;
let everFilled = false;

function trailPrice(p: bigint, bps: number): bigint {
  return (p * BigInt(10000 - bps)) / 10000n;
}

function ret60Bps(now: bigint, ago: bigint): bigint {
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
    closes.push(close);
    highs.push(high);

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
      for (let i = closes.length - LOOKBACK - 1; i < closes.length - 1; i++) {
        if (highs[i] > prevHigh) prevHigh = highs[i];
      }
      const breakout = close > prevHigh && (ceiling === 0n || close > ceiling);
      // Never open on the last two batches: a buy there fills at the final
      // bar's open and is flattened at its close, paying fees for no ride.
      if (breakout && state.seq < 1438 && state.cash >= 1000000n) {
        peak = close;
        inFallback = false;
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
        return orders;
      }
    }

    if (!everFilled && state.seq >= FALLBACK_BAR && state.seq < 1438 && closes.length > LOOKBACK) {
      const r60 = ret60Bps(close, closes[closes.length - 61]);
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
