/**
 * 6D4 骰点纯函数。移植自 qq-bot/game/dice.py。
 * 成功 = 出 3。
 */

const NON_THREE: readonly number[] = [1, 2, 4]

export type Rng = () => number

const defaultRng: Rng = Math.random

function randInt(min: number, max: number, rng: Rng): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function pickNonThree(rng: Rng): number {
  return NON_THREE[randInt(0, NON_THREE.length - 1, rng)]
}

export function roll6d4(rng: Rng = defaultRng): number[] {
  const dice: number[] = []
  for (let i = 0; i < 6; i++) {
    dice.push(randInt(1, 4, rng))
  }
  return dice
}

export interface BurnoutResult {
  dice: number[]
  unconsumed: number
}

export function applyBurnout(
  dice: readonly number[],
  burnout: number,
  rng: Rng = defaultRng,
): BurnoutResult {
  const result = [...dice]
  let remaining = burnout

  for (let i = 0; i < result.length; i++) {
    if (remaining <= 0) break
    if (result[i] === 3) {
      result[i] = pickNonThree(rng)
      remaining -= 1
    }
  }

  return { dice: result, unconsumed: remaining }
}

export function countSuccesses(dice: readonly number[]): number {
  let n = 0
  for (const d of dice) if (d === 3) n++
  return n
}

export function countNonSuccesses(dice: readonly number[]): number {
  let n = 0
  for (const d of dice) if (d !== 3) n++
  return n
}
