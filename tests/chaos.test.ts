import { describe, it, expect } from 'vitest'
import { calculateChaos, isTripleSublimation } from '../src/game/chaos'

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
