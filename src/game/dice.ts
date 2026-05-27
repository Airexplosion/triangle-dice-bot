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

// ───────── d6（规则破坏者）─────────
// U2 解锁后可在 异常能力 投骰时加入额外的一颗 d6：
//   3 → 算 1 个 3；6 → 算 2 个 3；其余 → 加 1 点混沌
// d6 不在 d4 池里，不被燃尽 / 后修改 / 撤回操作影响。

export function rollD6(rng: Rng = defaultRng): number {
  return randInt(1, 6, rng)
}

/** d6 等效的"3 数量"贡献（用于三重升华 / UNL3ASH 总数）。 */
export function d6ThreeCount(d6: number | null): number {
  if (d6 === 3) return 1
  if (d6 === 6) return 2
  return 0
}

/** d6 等效的"混沌"贡献。3 / 6 不加；1 / 2 / 4 / 5 各加 1。 */
export function d6ChaosCount(d6: number | null): number {
  if (d6 === null || d6 === 3 || d6 === 6) return 0
  return 1
}

// ───────── d10（"无名"骰）─────────
// N1 解锁后可在 异常能力 投骰时**代替**六颗 d4：
//   N 面 → N 个 3 + N 点混沌（与摇出数字匹配）
//   d10=3 特殊：失败（成功数置 0），但仍 3 点混沌；不可达成三重升华
//   d10=7 且为唯一掷出骰子 → 自动激活 UNL3ASH（与 d6 组合时按总 3 数判定）
// d10 可与 d6 组合，但不与 6D4 共存。

export function rollD10(rng: Rng = defaultRng): number {
  return randInt(1, 10, rng)
}

/** d10 等效的"3 数量"贡献。d10=3 → 0（失败），其余 = 面值。 */
export function d10ThreeCount(d10: number | null): number {
  if (d10 === null) return 0
  if (d10 === 3) return 0
  return d10
}

/** d10 等效的"混沌"贡献。永远 = 面值（含 d10=3 → 3）。 */
export function d10ChaosCount(d10: number | null): number {
  if (d10 === null) return 0
  return d10
}

/** d10=3 触发的"直接失败"。 */
export function isD10Failure(d10: number | null): boolean {
  return d10 === 3
}

// ───────── d8（赞助骰）─────────
// G3 解锁后，**现实修改** 必额外摇一颗 d8（与 6D4 同时投，不替代）。
//   面值 1/2/4/5/7/8 → 玩家做"赞助商致敬"的角色扮演（bot 不强制判定）
//   面值 3           → 1 个 3，玩家可选 计入 / 减去 / 忽略
//   面值 6           → 2 个 3，玩家可选 计入 / 减去 / 忽略
// d8 不贡献混沌。

export type D8Mode = 'ignore' | 'count' | 'subtract'

export function rollD8(rng: Rng = defaultRng): number {
  return randInt(1, 8, rng)
}

/** d8 原始等效 3 数。3 → 1，6 → 2，其余 → 0。 */
export function d8ThreeCount(d8: number | null): number {
  if (d8 === 3) return 1
  if (d8 === 6) return 2
  return 0
}

/**
 * d8 按当前 mode 实际贡献的"3 数变化量"。
 *   ignore   → 0
 *   count    → +d8ThreeCount(d8)
 *   subtract → -d8ThreeCount(d8)
 * 当 d8 ∈ {1,2,4,5,7,8} 时 d8ThreeCount=0，mode 无意义，恒返回 0。
 */
export function d8SuccessDelta(d8: number | null, mode: D8Mode): number {
  const base = d8ThreeCount(d8)
  if (base === 0) return 0
  if (mode === 'count') return base
  if (mode === 'subtract') return -base
  return 0
}
