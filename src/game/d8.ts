/** Built-in sponsor tribute text for each D8 face. Branch settings override these values. */
export const DEFAULT_D8_TRIBUTES: Record<number, string> = {
  1: '引用一件恰好在当前时刻前 40 小时发生于目标或地点之上、并影响此因果链的事物',
  2: '引用一件发生在另一个国家、并影响此因果链的事物',
  3: '一个 3（可在下方选择 计入 / 减去 / 忽略）',
  4: '引用一种因接触虚构作品而影响此因果链的方式',
  5: '引用一种“湿嘴”牌口香糖与膳食补充剂影响此因果链的方式（请务必包含确切的措辞！）',
  6: '两个 3（可在下方选择 计入 / 减去 / 忽略）',
  7: '在因果链中包含一样蓝色的东西',
  8: '引用一次影响此因果链的背叛',
}

export type D8Tributes = Record<number, string>

/** G3 默认静默带 D8；显式 d8 不再要求 G3。 */
export function resolveD8Use(g3Unlocked: boolean, explicitD8: boolean): boolean {
  return g3Unlocked || explicitD8
}

export function normalizeD8Tributes(value: unknown): D8Tributes {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const result: D8Tributes = {}
  for (let face = 1; face <= 8; face += 1) {
    const text = source[face] ?? source[String(face)]
    result[face] = typeof text === 'string' && text.trim()
      ? text.trim()
      : DEFAULT_D8_TRIBUTES[face]
  }
  return result
}
