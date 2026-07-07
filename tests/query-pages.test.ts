import { describe, expect, it } from 'vitest'
import { buildCharacterCardPages } from '../src/commands/query'
import type { CharacterStatusResp } from '../src/service/web-client'

type CharacterData = NonNullable<CharacterStatusResp['character']>

function makeCharacter(): CharacterData {
  return {
    id: 'test',
    name: '分页测试员',
    anomaly: '测试异常',
    reality: '测试现实',
    competency: '测试职能',
    commendations: 1,
    reprimands: 2,
    mvpCount: 3,
    probationCount: 4,
    managerName: '测试经理',
    activeMission: { id: 1, name: '测试任务' },
    aptitudes: Object.fromEntries(
      ['专注', '欺瞒', '活力', '共情', '主动', '坚毅', '气场', '专业', '诡秘']
        .map((name) => [name, { v: '8/9', current: 8, max: 9, m: [9] }]),
    ),
    anomalies: [],
    relations: [],
    items: [],
  }
}

describe('buildCharacterCardPages', () => {
  it('基础信息、资质、异常、关系、申领物分别成页', () => {
    const pages = buildCharacterCardPages(makeCharacter())
    expect(pages.map((page) => page.label)).toEqual([
      '基础信息',
      '资质（当前 / 上限）',
      '异常能力',
      '关系',
      '申领物',
    ])
    expect(pages[1].lines).toHaveLength(9)
  })

  it('长列表每页最多六项并继续拆页', () => {
    const character = makeCharacter()
    character.anomalies = Array.from({ length: 14 }, (_, index) => ({
      name: `异常${index + 1}`,
      qualName: '专注',
      trigger: null,
      trained: false,
    }))
    character.relations = Array.from({ length: 7 }, (_, index) => ({
      name: `关系${index + 1}`,
      actor: '',
      description: '',
      inNetwork: true,
      connection: '',
      level: index,
    }))
    character.items = Array.from({ length: 13 }, (_, index) => ({
      name: `申领物${index + 1}`,
      effect: '',
      purchase: '',
    }))

    const pages = buildCharacterCardPages(character)
    expect(pages.filter((page) => page.label.startsWith('异常能力'))).toHaveLength(3)
    expect(pages.filter((page) => page.label.startsWith('关系'))).toHaveLength(2)
    expect(pages.filter((page) => page.label.startsWith('申领物'))).toHaveLength(3)
    expect(Math.max(...pages.map((page) => page.lines.length))).toBeLessThanOrEqual(9)
  })
})
