import { describe, it, expect } from 'vitest'
import {
  applyBurnout,
  countNonSuccesses,
  countSuccesses,
  roll6d4,
  type Rng,
} from '../src/game/dice'

// 可重复 RNG：返回固定 0 ~ 1 序列
function seqRng(values: number[]): Rng {
  let i = 0
  return () => {
    const v = values[i % values.length]
    i++
    return v
  }
}

describe('roll6d4', () => {
  it('returns 6 values in [1,4]', () => {
    for (let trial = 0; trial < 50; trial++) {
      const dice = roll6d4()
      expect(dice).toHaveLength(6)
      for (const d of dice) {
        expect(d).toBeGreaterThanOrEqual(1)
        expect(d).toBeLessThanOrEqual(4)
        expect(Number.isInteger(d)).toBe(true)
      }
    }
  })

  it('uses injected RNG deterministically', () => {
    // rng 返回 0 → randInt(1,4) = floor(0 * 4) + 1 = 1
    // rng 返回 0.99 → randInt(1,4) = floor(3.96) + 1 = 4
    const dice = roll6d4(seqRng([0, 0.99, 0, 0.99, 0, 0.99]))
    expect(dice).toEqual([1, 4, 1, 4, 1, 4])
  })
})

describe('countSuccesses / countNonSuccesses', () => {
  it('counts 3s and non-3s', () => {
    expect(countSuccesses([3, 3, 3, 1, 2, 4])).toBe(3)
    expect(countNonSuccesses([3, 3, 3, 1, 2, 4])).toBe(3)
    expect(countSuccesses([1, 2, 4, 1, 2, 4])).toBe(0)
    expect(countNonSuccesses([1, 2, 4, 1, 2, 4])).toBe(6)
    expect(countSuccesses([3, 3, 3, 3, 3, 3])).toBe(6)
    expect(countNonSuccesses([3, 3, 3, 3, 3, 3])).toBe(0)
  })

  it('handles empty arrays', () => {
    expect(countSuccesses([])).toBe(0)
    expect(countNonSuccesses([])).toBe(0)
  })
})

describe('applyBurnout', () => {
  it('returns input unchanged when burnout is 0', () => {
    const input = [3, 3, 1, 2, 4, 3]
    const { dice, unconsumed } = applyBurnout(input, 0)
    expect(dice).toEqual(input)
    expect(unconsumed).toBe(0)
  })

  it('does not mutate the input array', () => {
    const input = [3, 3, 1, 2, 4, 3]
    const snapshot = [...input]
    applyBurnout(input, 2)
    expect(input).toEqual(snapshot)
  })

  it('converts up to N threes to non-threes (in order)', () => {
    const dice = [3, 1, 3, 2, 3, 4]
    const { dice: out, unconsumed } = applyBurnout(dice, 2)
    expect(unconsumed).toBe(0)
    // First two 3s converted, last 3 stays
    expect(out[0]).not.toBe(3)
    expect(out[1]).toBe(1)
    expect(out[2]).not.toBe(3)
    expect(out[3]).toBe(2)
    expect(out[4]).toBe(3)
    expect(out[5]).toBe(4)
  })

  it('only converts to 1, 2, or 4', () => {
    const dice = [3, 3, 3, 3, 3, 3]
    for (let trial = 0; trial < 50; trial++) {
      const { dice: out } = applyBurnout(dice, 6)
      for (const d of out) {
        expect([1, 2, 4]).toContain(d)
      }
    }
  })

  it('reports unconsumed when burnout > number of threes', () => {
    const dice = [3, 1, 3, 2, 4, 4]  // 2 threes
    const { dice: out, unconsumed } = applyBurnout(dice, 5)
    expect(unconsumed).toBe(3)
    expect(out.filter(d => d === 3)).toHaveLength(0)
  })

  it('leaves non-threes untouched even with high burnout', () => {
    const dice = [1, 2, 4, 1, 2, 4]  // 0 threes
    const { dice: out, unconsumed } = applyBurnout(dice, 10)
    expect(out).toEqual(dice)
    expect(unconsumed).toBe(10)
  })

  it('uses injected RNG deterministically when picking replacement', () => {
    // pickNonThree: rng returns 0 → index 0 → 1; rng returns 0.99 → index 2 → 4
    const dice = [3, 3, 3, 1, 2, 4]
    const { dice: out } = applyBurnout(dice, 3, seqRng([0, 0.5, 0.99]))
    // index 0/1/2 are converted in order
    // 0.0 → 1; 0.5 → index 1 (2); 0.99 → index 2 (4)
    expect(out).toEqual([1, 2, 4, 1, 2, 4])
  })
})
