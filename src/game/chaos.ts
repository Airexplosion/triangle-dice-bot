/**
 * 混沌计算纯函数。移植自 qq-bot/game/chaos.py。
 *
 * 三连升华：恰好 3 个成功 → 混沌贡献 = 0。
 * 否则：混沌 = 非成功数 + 未消耗的 burnout。
 */

import { countSuccesses, countNonSuccesses } from './dice'

export function isTripleSublimation(dice: readonly number[]): boolean {
  return countSuccesses(dice) === 3
}

export function calculateChaos(
  dice: readonly number[],
  unconsumedBurnout: number,
): number {
  if (isTripleSublimation(dice)) return 0
  return countNonSuccesses(dice) + unconsumedBurnout
}
