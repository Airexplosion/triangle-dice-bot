import { describe, expect, it } from 'vitest'
import { APTITUDE_NAMES } from '../src/const'
import { buildTaskAttrButtons } from '../src/commands/admin'
import {
  buildAnomalyNumberButtonRows,
  buildCheckGrid,
  d8DeltaButtonRows,
} from '../src/commands/roll'
import { parseD8DeltaArg } from '../src/commands/post-roll'

describe('QQ button layouts', () => {
  it('检定九宫格展示当前资质值，并保持 3x3', () => {
    const values = Object.fromEntries(APTITUDE_NAMES.map((name, i) => [name, i]))
    const rows = buildCheckGrid('/检定 ', values)

    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.length === 3)).toBe(true)
    expect(rows[0][0]).toMatchObject({
      label: `${APTITUDE_NAMES[0]}·0`,
      data: `/检定 ${APTITUDE_NAMES[0]}`,
      type: 'input',
      enter: true,
    })
    expect(rows.flat()).toHaveLength(9)
  })

  it('最复杂的 d8 调整布局最多占两行', () => {
    const rows = d8DeltaButtonRows(6, 0)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveLength(3)
    expect(rows[1]).toHaveLength(2)
    expect(rows.flat().every((button) => button.type === 'input' && button.enter)).toBe(true)
    expect(rows.flat().map((button) => button.data)).toEqual([
      '/d8 加1', '/d8 忽略', '/d8 减1', '/d8 加2', '/d8 减2',
    ])
    expect(rows.flat().every((button) => !/\s-\d/.test(button.data))).toBe(true)
  })

  it('d8 中文方向参数可解析为正负增量', () => {
    expect(parseD8DeltaArg('加2')).toBe(2)
    expect(parseD8DeltaArg('忽略')).toBe(0)
    expect(parseD8DeltaArg('减1')).toBe(-1)
    expect(parseD8DeltaArg('减2')).toBe(-2)
  })

  it('任务属性按钮不把负数作为 Koishi 位置参数', () => {
    const buttons = buildTaskAttrButtons(true)
    const data = buttons.flat().map((button) => button.data)

    expect(data).toContain('/调整属性 混沌 减 1')
    expect(data).toContain('/调整属性 失败 减 1')
    expect(data).toContain('/调整属性 散逸 减 1')
    expect(data.every((command) => !/\s-\d/.test(command))).toBe(true)
  })

  it('异常能力按钮只显示数字并每行最多四个', () => {
    const abilities = Array.from({ length: 6 }, (_, i) => ({ qualName: `资质${i + 1}` }))
    const rows = buildAnomalyNumberButtonRows(abilities, 8)

    expect(rows.map((row) => row.length)).toEqual([4, 2])
    expect(rows.flat().map((button) => button.label)).toEqual(['9', '10', '11', '12', '13', '14'])
  })
})
