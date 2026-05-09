import { describe, expect, it } from 'vitest'
import { parseAptitudeInput } from '../src/commands/aptitude'

/**
 * 回归测试：录入资质命令的 token 解析。
 * 玩家可能用空格、逗号、顿号分隔，可能拼错资质名。
 * 这个 parser 是命令的入口，输入容错性是体验的一部分。
 */
describe('parseAptitudeInput', () => {
  it('单个资质 + 数值', () => {
    const r = parseAptitudeInput('专注3')
    expect([...r.updates.entries()]).toEqual([['专注', 3]])
    expect(r.unknown).toEqual([])
  })

  it('多个资质用空格分隔', () => {
    const r = parseAptitudeInput('专注3 气场5 诡秘2')
    expect([...r.updates.entries()].sort()).toEqual([
      ['专注', 3],
      ['气场', 5],
      ['诡秘', 2],
    ].sort())
  })

  it('支持中文逗号 / 顿号 / 英文逗号', () => {
    const r = parseAptitudeInput('专注3，气场5、诡秘2,坚毅1')
    expect(r.updates.size).toBe(4)
    expect(r.updates.get('专注')).toBe(3)
    expect(r.updates.get('气场')).toBe(5)
    expect(r.updates.get('诡秘')).toBe(2)
    expect(r.updates.get('坚毅')).toBe(1)
  })

  it('未知资质名进 unknown 列表', () => {
    const r = parseAptitudeInput('专注3 滚3 气场5')
    expect(r.updates.get('专注')).toBe(3)
    expect(r.updates.get('气场')).toBe(5)
    expect(r.unknown).toContain('滚')
  })

  it('格式错误（无数字）进 unknown', () => {
    const r = parseAptitudeInput('专注 气场5')
    expect(r.unknown).toContain('专注')
    expect(r.updates.get('气场')).toBe(5)
  })

  it('两位数及以上数值', () => {
    const r = parseAptitudeInput('专注10 气场100')
    expect(r.updates.get('专注')).toBe(10)
    expect(r.updates.get('气场')).toBe(100)
  })

  it('空字符串', () => {
    const r = parseAptitudeInput('')
    expect(r.updates.size).toBe(0)
    expect(r.unknown).toEqual([])
  })

  it('全空白', () => {
    const r = parseAptitudeInput('   ')
    expect(r.updates.size).toBe(0)
    expect(r.unknown).toEqual([])
  })

  it('重复资质名 - 后面的覆盖前面', () => {
    const r = parseAptitudeInput('专注3 专注7')
    expect(r.updates.get('专注')).toBe(7)
  })
})
