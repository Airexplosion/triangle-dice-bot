import { describe, expect, it } from 'vitest'
import { DEFAULT_D8_TRIBUTES, normalizeD8Tributes, resolveD8Use } from '../src/game/d8'
import { parseDiceMode } from '../src/commands/roll'

describe('D8 sponsor tribute configuration', () => {
  it('keeps the eight built-in default labels', () => {
    expect(Object.keys(DEFAULT_D8_TRIBUTES)).toHaveLength(8)
    expect(DEFAULT_D8_TRIBUTES[1]).toContain('40 小时')
    expect(DEFAULT_D8_TRIBUTES[8]).toContain('背叛')
  })

  it('fills missing or invalid branch labels from defaults', () => {
    const labels = normalizeD8Tributes({ 1: '分部自定义', 2: '', 3: 123 })
    expect(labels[1]).toBe('分部自定义')
    expect(labels[2]).toBe(DEFAULT_D8_TRIBUTES[2])
    expect(labels[3]).toBe(DEFAULT_D8_TRIBUTES[3])
    expect(labels[8]).toBe(DEFAULT_D8_TRIBUTES[8])
  })

  it('accepts an explicit d8 mode, including uppercase input', () => {
    expect(parseDiceMode('D8')).toMatchObject({ useD8: true, useD6: false, useD10: false })
    expect(parseDiceMode('d10')?.useD8).toBe(false)
  })

  it('automatically uses d8 for G3, while explicit d8 bypasses the G3 gate', () => {
    expect(resolveD8Use(true, false)).toBe(true)
    expect(resolveD8Use(false, true)).toBe(true)
    expect(resolveD8Use(false, false)).toBe(false)
  })
})
