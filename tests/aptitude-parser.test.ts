import { describe, expect, it } from 'vitest'
import {
  normalizeAptitudeCommandContent,
  parseAptitudeInput,
} from '../src/commands/aptitude'

describe('parseAptitudeInput', () => {
  it('兼容旧的紧凑绝对赋值格式', () => {
    const r = parseAptitudeInput('专注3 气场5')
    expect(r.operations).toEqual([
      { name: '专注', field: 'current', mode: 'set', value: 3 },
      { name: '气场', field: 'current', mode: 'set', value: 5 },
    ])
    expect(r.unknown).toEqual([])
  })

  it('支持资质名与绝对值之间有空格', () => {
    expect(parseAptitudeInput('专注 8').operations).toEqual([
      { name: '专注', field: 'current', mode: 'set', value: 8 },
    ])
  })

  it('支持当前值的正负增量和中文加减', () => {
    expect(parseAptitudeInput('专注-1 气场 +2 共情减1 主动加1').operations).toEqual([
      { name: '专注', field: 'current', mode: 'delta', value: -1 },
      { name: '气场', field: 'current', mode: 'delta', value: 2 },
      { name: '共情', field: 'current', mode: 'delta', value: -1 },
      { name: '主动', field: 'current', mode: 'delta', value: 1 },
    ])
  })

  it('支持上限绝对值与增量', () => {
    expect(parseAptitudeInput('专注 上限 9 气场上限-1').operations).toEqual([
      { name: '专注', field: 'max', mode: 'set', value: 9 },
      { name: '气场', field: 'max', mode: 'delta', value: -1 },
    ])
  })

  it('支持逗号、顿号和重复资质的顺序操作', () => {
    const r = parseAptitudeInput('专注8，专注减1、气场5')
    expect(r.operations.map((operation) => operation.name)).toEqual(['专注', '专注', '气场'])
  })

  it('未知资质和缺失数值进入 unknown', () => {
    const r = parseAptitudeInput('滚3 专注 气场5')
    expect(r.unknown).toEqual(['滚3', '专注'])
    expect(r.operations).toEqual([
      { name: '气场', field: 'current', mode: 'set', value: 5 },
    ])
  })

  it('空字符串不产生操作', () => {
    expect(parseAptitudeInput('   ')).toEqual({ operations: [], unknown: [] })
  })
})

describe('normalizeAptitudeCommandContent', () => {
  it('在 Koishi 解析前消除负数选项歧义', () => {
    expect(normalizeAptitudeCommandContent('录入资质 专注 -1')).toBe('录入资质 专注 减1')
    expect(normalizeAptitudeCommandContent('/录入资质 专注 −1')).toBe('/录入资质 专注 减1')
    expect(normalizeAptitudeCommandContent('录入资质 专注－1 气场＋2')).toBe('录入资质 专注减1 气场加2')
  })
})
