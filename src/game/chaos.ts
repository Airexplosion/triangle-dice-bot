/**
 * 混沌计算纯函数。移植自 qq-bot/game/chaos.py。
 *
 * 三重升华：恰好 3 个成功 → 混沌贡献 = 0。
 * 否则：混沌 = 非成功数 + 未消耗的 burnout（+ 可选 d6 贡献）。
 *
 * d6（规则破坏者，仅 异常能力 + U2 解锁可加）：
 *   3 → 算 1 个 3；6 → 算 2 个 3；其余 → +1 混沌
 * d6 的"3 数量"贡献加进三重升华判定；不进入燃尽 / 后修改池。
 */

import {
  countNonSuccesses,
  countSuccesses,
  d6ChaosCount,
  d6ThreeCount,
  d8SuccessDelta,
  d10ThreeCount,
  isD10Failure,
  type D8Mode,
} from './dice'

export function isTripleSublimation(
  dice: readonly number[],
  d6: number | null = null,
  d8: number | null = null,
  d8Mode: D8Mode = 'ignore',
): boolean {
  return (
    countSuccesses(dice) + d6ThreeCount(d6) + d8SuccessDelta(d8, d8Mode) === 3
  )
}

export function calculateChaos(
  dice: readonly number[],
  unconsumedBurnout: number,
  d6: number | null = null,
  d8: number | null = null,
  d8Mode: D8Mode = 'ignore',
): number {
  if (isTripleSublimation(dice, d6, d8, d8Mode)) return 0
  // d8 不贡献混沌，仅参与三重升华判定 / 总成功数
  return countNonSuccesses(dice) + unconsumedBurnout + d6ChaosCount(d6)
}

/**
 * UNL3ASH 激活：原始总 3 数（d4 + d6 + d10 贡献）**恰好 == 7**。
 * 需在任何后修改前判定。d10=3 触发的"直接失败"阻断 UNL3ASH。
 *
 * 边界：
 *   - 6 d4-3 + d6=3 = 7 → ✅
 *   - 5 d4-3 + d6=6 = 7 → ✅
 *   - 6 d4-3 + d6=6 = 8 → ❌（超过 7）
 *   - d10=7 单骰 = 7 → ✅
 *   - d10=8/9/10 单骰 → ❌（超过 7）
 *   - d10=5 + d6=6 = 7 → ✅
 */
export function isUnleashActivated(
  rawDice: readonly number[],
  d6: number | null = null,
  d10: number | null = null,
  d8: number | null = null,
  d8Mode: D8Mode = 'ignore',
): boolean {
  if (isD10Failure(d10)) return false
  return (
    countSuccesses(rawDice) +
      d6ThreeCount(d6) +
      d10ThreeCount(d10) +
      d8SuccessDelta(d8, d8Mode) ===
    7
  )
}
