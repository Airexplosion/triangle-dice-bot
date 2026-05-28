import { describe, it, expect } from 'vitest'
import { calculateChaos, isTripleSublimation, isUnleashActivated } from '../src/game/chaos'
import {
  clampD8Delta,
  d6ChaosCount,
  d6ThreeCount,
  d8ThreeCount,
  d10ChaosCount,
  d10ThreeCount,
  isD10Failure,
} from '../src/game/dice'

describe('isTripleSublimation', () => {
  it('is true iff exactly 3 threes', () => {
    expect(isTripleSublimation([3, 3, 3, 1, 2, 4])).toBe(true)
    expect(isTripleSublimation([3, 3, 3, 3, 1, 2])).toBe(false)
    expect(isTripleSublimation([3, 3, 1, 2, 4, 4])).toBe(false)
    expect(isTripleSublimation([1, 2, 4, 1, 2, 4])).toBe(false)
    expect(isTripleSublimation([3, 3, 3, 3, 3, 3])).toBe(false)
  })
})

describe('calculateChaos', () => {
  it('triple sublimation yields 0 regardless of unconsumed burnout', () => {
    expect(calculateChaos([3, 3, 3, 1, 2, 4], 0)).toBe(0)
    expect(calculateChaos([3, 3, 3, 1, 2, 4], 5)).toBe(0)
  })

  it('all non-successes contribute equally to chaos', () => {
    expect(calculateChaos([1, 2, 4, 1, 2, 4], 0)).toBe(6)
    expect(calculateChaos([1, 2, 4, 1, 2, 4], 3)).toBe(9)
  })

  it('partial successes: chaos = non-successes + unconsumed', () => {
    // 2 successes, 4 non-successes
    expect(calculateChaos([3, 3, 1, 2, 4, 4], 0)).toBe(4)
    expect(calculateChaos([3, 3, 1, 2, 4, 4], 2)).toBe(6)
  })

  it('4 successes (above triple) — NOT sublimation, normal calc', () => {
    expect(calculateChaos([3, 3, 3, 3, 1, 2], 0)).toBe(2)
    expect(calculateChaos([3, 3, 3, 3, 3, 3], 0)).toBe(0)  // 0 non-successes
  })

  it('all successes (6 threes) — chaos = 0 from non-successes alone', () => {
    expect(calculateChaos([3, 3, 3, 3, 3, 3], 0)).toBe(0)
    expect(calculateChaos([3, 3, 3, 3, 3, 3], 4)).toBe(4)
  })
})

// ───────── d6 / 规则破坏者 ─────────

describe('d6ThreeCount / d6ChaosCount', () => {
  it('maps d6 face to 3-count and chaos contribution', () => {
    expect(d6ThreeCount(3)).toBe(1)
    expect(d6ThreeCount(6)).toBe(2)
    expect(d6ThreeCount(null)).toBe(0)
    for (const x of [1, 2, 4, 5]) expect(d6ThreeCount(x)).toBe(0)

    expect(d6ChaosCount(3)).toBe(0)
    expect(d6ChaosCount(6)).toBe(0)
    expect(d6ChaosCount(null)).toBe(0)
    for (const x of [1, 2, 4, 5]) expect(d6ChaosCount(x)).toBe(1)
  })
})

describe('isTripleSublimation with d6', () => {
  it('d6=3 + 2 d4-threes → triple', () => {
    expect(isTripleSublimation([3, 3, 1, 2, 4, 4], 3)).toBe(true)
  })
  it('d6=6 + 1 d4-three → triple (d6=6 算 2 个 3)', () => {
    expect(isTripleSublimation([3, 1, 2, 4, 4, 4], 6)).toBe(true)
  })
  it('d6=3 + 3 d4-threes = 4 → NOT triple', () => {
    expect(isTripleSublimation([3, 3, 3, 1, 2, 4], 3)).toBe(false)
  })
  it('d6=null behaves like old API', () => {
    expect(isTripleSublimation([3, 3, 3, 1, 2, 4])).toBe(true)
    expect(isTripleSublimation([3, 3, 3, 3, 1, 2])).toBe(false)
  })
})

describe('calculateChaos with d6', () => {
  it('d6 ∈ {1,2,4,5} adds 1 chaos when not triple', () => {
    // 2 个 3 + 4 非 3 + d6=2 → 4 + 0 + 1 = 5
    expect(calculateChaos([3, 3, 1, 2, 4, 4], 0, 2)).toBe(5)
  })
  it('d6=3 combined with 2 d4-3s = triple → 0 chaos', () => {
    expect(calculateChaos([3, 3, 1, 2, 4, 4], 0, 3)).toBe(0)
  })
  it('d6=6 + 1 d4-3 = triple → 0 chaos', () => {
    expect(calculateChaos([3, 1, 2, 4, 4, 4], 0, 6)).toBe(0)
  })
  it('d6=null fully backward compat', () => {
    expect(calculateChaos([3, 3, 3, 1, 2, 4], 0)).toBe(0)
    expect(calculateChaos([3, 3, 1, 2, 4, 4], 2)).toBe(6)
  })
})

describe('isUnleashActivated', () => {
  it('恰好 7 total threes → UNL3ASH', () => {
    // 6 d4-3 + d6=3 → 7
    expect(isUnleashActivated([3, 3, 3, 3, 3, 3], 3)).toBe(true)
    // 5 d4-3 + d6=6 → 7
    expect(isUnleashActivated([3, 3, 3, 3, 3, 1], 6)).toBe(true)
  })
  it('> 7（超过） → 不激活', () => {
    // 6 d4-3 + d6=6 → 8 → 超过
    expect(isUnleashActivated([3, 3, 3, 3, 3, 3], 6)).toBe(false)
  })
  it('< 7 → 不激活', () => {
    expect(isUnleashActivated([3, 3, 3, 3, 3, 3], null)).toBe(false) // 6
    expect(isUnleashActivated([3, 3, 3, 3, 3, 1], 3)).toBe(false) // 5 + 1 = 6
    expect(isUnleashActivated([3, 3, 3, 1, 2, 4], 6)).toBe(false) // 3 + 2 = 5
  })
})

// ───────── d10 / "无名"骰 ─────────

describe('d10ThreeCount / d10ChaosCount / isD10Failure', () => {
  it('maps d10 face to 3-count (failure on 3) and chaos = face', () => {
    expect(d10ThreeCount(1)).toBe(1)
    expect(d10ThreeCount(2)).toBe(2)
    expect(d10ThreeCount(3)).toBe(0)
    expect(d10ThreeCount(7)).toBe(7)
    expect(d10ThreeCount(10)).toBe(10)
    expect(d10ThreeCount(null)).toBe(0)

    for (let f = 1; f <= 10; f++) expect(d10ChaosCount(f)).toBe(f)
    expect(d10ChaosCount(null)).toBe(0)

    expect(isD10Failure(3)).toBe(true)
    for (const f of [1, 2, 4, 5, 6, 7, 8, 9, 10]) expect(isD10Failure(f)).toBe(false)
    expect(isD10Failure(null)).toBe(false)
  })
})

describe('d8ThreeCount / clampD8Delta', () => {
  it('d8=3 → 最大幅度 1，clamp 到 [-1,1]', () => {
    expect(d8ThreeCount(3)).toBe(1)
    expect(clampD8Delta(3, 1)).toBe(1)
    expect(clampD8Delta(3, 2)).toBe(1) // 超上限夹回
    expect(clampD8Delta(3, -1)).toBe(-1)
    expect(clampD8Delta(3, -5)).toBe(-1) // 超下限夹回
    expect(clampD8Delta(3, 0)).toBe(0)
  })
  it('d8=6 → 最大幅度 2，clamp 到 [-2,2]', () => {
    expect(d8ThreeCount(6)).toBe(2)
    expect(clampD8Delta(6, 2)).toBe(2)
    expect(clampD8Delta(6, 1)).toBe(1)
    expect(clampD8Delta(6, 3)).toBe(2)
    expect(clampD8Delta(6, -2)).toBe(-2)
    expect(clampD8Delta(6, -9)).toBe(-2)
  })
  it('d8 ∈ {1,2,4,5,7,8} → 最大幅度 0，任何请求都夹到 0', () => {
    for (const f of [1, 2, 4, 5, 7, 8]) {
      expect(d8ThreeCount(f)).toBe(0)
      expect(clampD8Delta(f, 2)).toBe(0)
      expect(clampD8Delta(f, -2)).toBe(0)
    }
  })
  it('d8=null → 0', () => {
    expect(d8ThreeCount(null)).toBe(0)
    expect(clampD8Delta(null, 1)).toBe(0)
  })
})

describe('isTripleSublimation with d8Delta', () => {
  it('用户例：1 d4-3 + d8 计入 +2 → 1+2=3 → triple', () => {
    expect(isTripleSublimation([3, 1, 2, 4, 4, 4], null, 2)).toBe(true)
  })
  it('d8=6 但只计入 +1：1+1=2 ≠ 3 → 非 triple', () => {
    expect(isTripleSublimation([3, 1, 2, 4, 4, 4], null, 1)).toBe(false)
  })
  it('2 d4-3 + d8 计入 +1 → 3 → triple（d8=6 的关键精确选项）', () => {
    expect(isTripleSublimation([3, 3, 1, 2, 4, 4], null, 1)).toBe(true)
  })
  it('1 d4-3 + d8 忽略(0) → 1 ≠ 3', () => {
    expect(isTripleSublimation([3, 1, 2, 4, 4, 4], null, 0)).toBe(false)
  })
  it('5 d4-3 + d8 减去 -2 → 5-2=3 → triple', () => {
    expect(isTripleSublimation([3, 3, 3, 3, 3, 1], null, -2)).toBe(true)
  })
  it('与 d6 叠加：1 d4-3 + d6=3 + d8 计入 +1 → 3 → triple', () => {
    expect(isTripleSublimation([3, 1, 2, 4, 4, 4], 3, 1)).toBe(true)
  })
})

describe('calculateChaos with d8Delta', () => {
  it('d8 计入凑成三重升华 → 混沌归 0', () => {
    // 2 d4-3 + 4 非3，本来 chaos=4；d8 计入 +1 → 3 个 3 → triple → 0
    expect(calculateChaos([3, 3, 1, 2, 4, 4], 0, null, 1)).toBe(0)
  })
  it('d8 计入但没凑成三重升华 → 混沌仍按 d4 算（d8 不加混沌）', () => {
    // 1 d4-3 + 5 非3 = chaos 5；d8 计入 +1 → 2 个 3，未达 triple → 仍 5
    expect(calculateChaos([3, 1, 2, 4, 4, 4], 0, null, 1)).toBe(5)
  })
})

describe('isUnleashActivated 不再含 d8（UNL3ASH 仅属异常能力）', () => {
  it('5 d4-3 + d6=6 = 7 → UNL3ASH', () => {
    expect(isUnleashActivated([3, 3, 3, 3, 3, 1], 6, null)).toBe(true)
  })
})

describe('isUnleashActivated with d10', () => {
  it('d10=7 alone = 7 个 3 → UNL3ASH', () => {
    expect(isUnleashActivated([], null, 7)).toBe(true)
  })
  it('d10=10 alone = 10 个 3 → 超过 7 不激活', () => {
    expect(isUnleashActivated([], null, 10)).toBe(false)
  })
  it('d10=8/9 alone → 超过 7 不激活', () => {
    expect(isUnleashActivated([], null, 8)).toBe(false)
    expect(isUnleashActivated([], null, 9)).toBe(false)
  })
  it('d10=6 alone = 6 个 3 → 不足，不激活', () => {
    expect(isUnleashActivated([], null, 6)).toBe(false)
  })
  it('d10=5 + d6=6 = 7 → UNL3ASH', () => {
    expect(isUnleashActivated([], 6, 5)).toBe(true)
  })
  it('d10=6 + d6=3 = 7 → UNL3ASH', () => {
    expect(isUnleashActivated([], 3, 6)).toBe(true)
  })
  it('d10=7 + d6=3 = 8 → 超过，不激活', () => {
    expect(isUnleashActivated([], 3, 7)).toBe(false)
  })
  // 开发者澄清点 1：d10=7 + d6 非 3（1/2/4/5）仍是 7 个 3 → 触发
  it('d10=7 + d6=4(非3) = 7 → UNL3ASH（开发者 RAI）', () => {
    expect(isUnleashActivated([], 4, 7)).toBe(true)
    expect(isUnleashActivated([], 1, 7)).toBe(true)
    expect(isUnleashActivated([], 2, 7)).toBe(true)
    expect(isUnleashActivated([], 5, 7)).toBe(true)
  })
  it('d10=3 failure → never UNL3ASH', () => {
    expect(isUnleashActivated([], 6, 3)).toBe(false)
    expect(isUnleashActivated([], 3, 3)).toBe(false)
  })
})
