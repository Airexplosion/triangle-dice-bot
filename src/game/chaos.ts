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
  d10ThreeCount,
  isD10Failure,
} from './dice'

export function isTripleSublimation(
  dice: readonly number[],
  d6: number | null = null,
  /** d8 带符号的 3 数贡献（已 clamp，可为负）。仅现实修改 + G3 才非 0。 */
  d8Delta = 0,
): boolean {
  return countSuccesses(dice) + d6ThreeCount(d6) + d8Delta === 3
}

export function calculateChaos(
  dice: readonly number[],
  unconsumedBurnout: number,
  d6: number | null = null,
  d8Delta = 0,
): number {
  if (isTripleSublimation(dice, d6, d8Delta)) return 0
  // d8 不贡献混沌，仅通过凑成三重升华间接把混沌归 0
  return countNonSuccesses(dice) + unconsumedBurnout + d6ChaosCount(d6)
}

/**
 * UNL3ASH 激活：原始总 3 数（d4 + d6 + d10 贡献）**恰好 == 7**。
 * 需在任何后修改前判定。d10=3 触发的"直接失败"阻断 UNL3ASH。
 * UNL3ASH 仅属异常能力，与 d8 / 现实修改 无关，故不含 d8 参数。
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
): boolean {
  if (isD10Failure(d10)) return false
  return countSuccesses(rawDice) + d6ThreeCount(d6) + d10ThreeCount(d10) === 7
}
