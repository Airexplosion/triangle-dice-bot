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

// ───────── d20（技能检定，T3 解锁）─────────
// 拿 1 颗 d20 代替 6D4：花 1 点 QA（任一资质），选一项相关资质把它当前 QA 加到 d20 上。
//   最终 = d20 + 加值资质 QA（扣费后），> 10 → 成功
//   d20 = 3 → 自动成功 + 三重升华
//   d20 = 7 → 自动失败 + 加值资质所有剩余 QA 清零
//   失败 → 创造 = d20 面值 的混沌；不动失败计数

export function rollD20(rng: Rng = defaultRng): number {
  return randInt(1, 20, rng)
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
//   面值 3           → 最多 1 个 3，玩家可精确选 计入 +1 / 减去 -1 / 忽略 0
//   面值 6           → 最多 2 个 3，玩家可精确选 +2 / +1 / 0 / -1 / -2
// d8 不贡献混沌；但其带符号的 3 数（d8Delta）参与三重升华判定 ——
// 这是唯一一颗能靠"计入/减去"凑成恰好 3 个 3、从而触发三重升华（混沌归 0）的骰。
// d8 与 UNL3ASH 无关（UNL3ASH 仅属异常能力，d8 仅属现实修改）。

export function rollD8(rng: Rng = defaultRng): number {
  return randInt(1, 8, rng)
}

/** d8 可调整的最大幅度（绝对值）。3 → 1，6 → 2，其余 → 0（无可调 3）。 */
export function d8ThreeCount(d8: number | null): number {
  if (d8 === 3) return 1
  if (d8 === 6) return 2
  return 0
}

/**
 * 把玩家请求的 d8 增量夹在合法区间 [-max, +max]（max = d8ThreeCount）。
 * d8 ∈ {1,2,4,5,7,8} 时 max=0，任何请求都夹到 0。
 */
export function clampD8Delta(d8: number | null, requested: number): number {
  const max = d8ThreeCount(d8)
  if (max === 0) return 0 // 无可调 3（同时避免 -max 产生 -0）
  if (requested > max) return max
  if (requested < -max) return -max
  return requested
}
