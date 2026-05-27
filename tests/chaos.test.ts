import { describe, it, expect } from 'vitest'
import { calculateChaos, isTripleSublimation, isUnleashActivated } from '../src/game/chaos'
import { d6ChaosCount, d6ThreeCount } from '../src/game/dice'

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
  it('≥ 7 total threes triggers UNL3ASH', () => {
    // 6 d4-3 + d6=3 → 7 → yes
    expect(isUnleashActivated([3, 3, 3, 3, 3, 3], 3)).toBe(true)
    // 5 d4-3 + d6=6 → 7 → yes
    expect(isUnleashActivated([3, 3, 3, 3, 3, 1], 6)).toBe(true)
    // 6 d4-3 + d6=6 → 8 → yes
    expect(isUnleashActivated([3, 3, 3, 3, 3, 3], 6)).toBe(true)
  })
  it('< 7 total threes → no UNL3ASH', () => {
    expect(isUnleashActivated([3, 3, 3, 3, 3, 3], null)).toBe(false)
    expect(isUnleashActivated([3, 3, 3, 3, 3, 1], 3)).toBe(false) // 5 + 1 = 6
    expect(isUnleashActivated([3, 3, 3, 1, 2, 4], 6)).toBe(false) // 3 + 2 = 5
  })
})
