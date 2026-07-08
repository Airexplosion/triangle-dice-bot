import type { Context, Session } from 'koishi'
import { APTITUDE_NAMES } from '../const'
import { rawRoomIdOf } from '../room'
import type { CharacterStatusResp, WebClient } from '../service/web-client'
import { NETWORK_ERROR_BLOCK } from '../util/messages'
import { sendQQMarkdown, type QQButton } from '../util/qq-markdown'
import { requireBound } from '../util/preconditions'
import { makeWrap } from '../util/safe-action'
import { sanitizeRichText } from '../util/sanitize'

export interface QueryDeps {
  web: WebClient | null
  useMarkdown: boolean
}

export function registerQueryCommands(ctx: Context, deps: QueryDeps): void {
  const wrap = makeWrap(ctx, deps.useMarkdown)

  ctx.command('查询状态', '查看角色摘要').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (!(await requireBound(session, deps))) return
      const qqOpenid = session.userId!
      const groupId = session.isDirect
        ? undefined
        : rawRoomIdOf(session) ?? undefined

      const r = await deps.web!.getCharacterStatus(qqOpenid, groupId)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success || !r.character) {
        return reply(session, deps, `> ${r.error ?? '查询失败'}`)
      }
      const c = r.character
      const lines: string[] = []
      lines.push(`# ${c.name}`)
      lines.push('')
      lines.push(`异常　**${c.anomaly}**`)
      lines.push(`现实　**${c.reality}**`)
      lines.push(`职能　**${c.competency}**`)
      lines.push('')
      lines.push(`嘉奖　**${c.commendations}**　申诫　**${c.reprimands}**`)
      lines.push(`MVP　**${c.mvpCount}**　察看期　**${c.probationCount}**`)
      if (c.managerName) lines.push(`经理　**${c.managerName}**`)
      if (c.activeMission) lines.push(`当前任务　**${c.activeMission.name}**`)
      lines.push('')
      lines.push(`资质　**${Object.keys(c.aptitudes ?? {}).length}** 项`)
      lines.push(`异常能力　**${c.anomalies?.length ?? 0}** 项　关系　**${c.relations?.length ?? 0}** 项`)
      lines.push(`申领物　**${c.items?.length ?? 0}** 件`)
      const buttons: QQButton[][] = [
        [
          { label: '现实修改', data: '/现实修改', primary: true, type: 'input', enter: true },
          { label: '异常能力', data: '/异常能力', primary: true, type: 'input', enter: true },
        ],
        [
          { label: '完整角色卡', data: '/查询角色卡', primary: true, type: 'input', enter: true },
          { label: '物品背包', data: '/查询物品', type: 'input', enter: true },
          { label: '切换角色', data: '/查询角色', type: 'input', enter: true },
        ],
        [
          { label: '嘉奖', data: '/查询嘉奖', type: 'input', enter: true },
          { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
        ],
      ]
      await reply(session, deps, lines.join('\n'), buttons)
    }),
  )

  ctx.command('查询角色卡 [page:posint]', '分页查看完整角色卡').action(
    wrap(async ({ session }, page) => {
      if (!session) return
      const c = await fetchCharacter(session, deps)
      if (!c) return

      const pages = buildCharacterCardPages(c)
      const requested = page ?? 1
      const current = Math.max(1, Math.min(requested, pages.length))
      const cardPage = pages[current - 1]
      const lines = [
        `# ${c.name} · 角色卡`,
        '',
        `> ${cardPage.label}　${current} / ${pages.length} 页`,
        '',
        ...cardPage.lines,
      ]

      const nav: QQButton[] = []
      if (current > 1) {
        nav.push({ label: '上一页', data: `/查询角色卡 ${current - 1}`, type: 'input', enter: true })
      }
      if (current < pages.length) {
        nav.push({ label: '下一页', data: `/查询角色卡 ${current + 1}`, primary: true, type: 'input', enter: true })
      }
      const buttons: QQButton[][] = []
      if (nav.length) buttons.push(nav)
      buttons.push([
        { label: '角色摘要', data: '/查询状态', type: 'input', enter: true },
        { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
      ])
      await reply(session, deps, lines.join('\n'), buttons)
    }),
  )

  ctx.command('查询资质', '查看九项资质的当前值与上限').action(
    wrap(async ({ session }) => {
      if (!session) return
      const c = await fetchCharacter(session, deps)
      if (!c) return
      const lines = [`# ${c.name} · 资质`, '', '> 当前值 / 上限均明确列出。', '']
      for (const name of APTITUDE_NAMES) {
        const aptitude = c.aptitudes?.[name]
        lines.push(`**${name}**　当前 **${aptitude?.current ?? 0}**　上限 **${aptitude?.max ?? 0}**`)
      }
      await reply(session, deps, lines.join('\n'), [[
        { label: '返回角色卡', data: '/查询角色卡', primary: true, type: 'input', enter: true },
        { label: '录入资质', data: '/录入资质 ', type: 'input' },
      ]])
    }),
  )

  ctx.command('查询异常能力', '查看当前角色的异常能力').alias('查询异常').action(
    wrap(async ({ session }) => {
      if (!session) return
      const c = await fetchCharacter(session, deps)
      if (!c) return
      const lines = [`# ${c.name} · 异常能力`, '']
      if (!c.anomalies?.length) lines.push('> 暂无异常能力。')
      for (const anomaly of c.anomalies ?? []) {
        lines.push(`**${anomaly.name}**`)
        lines.push(`资质　${anomaly.qualName ?? '未指定'}　状态　${anomaly.trained ? '熟练' : '未熟练'}`)
        if (anomaly.trigger) lines.push(`触发器　${anomaly.trigger}`)
        lines.push('')
      }
      await reply(session, deps, lines.join('\n').trimEnd(), [[
        { label: '返回角色卡', data: '/查询角色卡', primary: true, type: 'input', enter: true },
        { label: '异常检定', data: '/异常能力', type: 'input', enter: true },
      ]])
    }),
  )

  ctx.command('查询关系', '查看当前角色的关系与连结').action(
    wrap(async ({ session }) => {
      if (!session) return
      const c = await fetchCharacter(session, deps)
      if (!c) return
      const lines = [`# ${c.name} · 关系`, '']
      if (!c.relations?.length) lines.push('> 暂无关系。')
      for (const relation of c.relations ?? []) {
        lines.push(`**${relation.name}**　连结 **${relation.level}**${relation.inNetwork ? '　关系网内' : ''}`)
        if (relation.actor) lines.push(`扮演者　${relation.actor}`)
        const connection = sanitizeRichText(relation.connection)
        if (connection) lines.push(`连结加成　${connection}`)
        lines.push('')
      }
      await reply(session, deps, lines.join('\n').trimEnd(), [[
        { label: '返回角色卡', data: '/查询角色卡', primary: true, type: 'input', enter: true },
        { label: '物品背包', data: '/查询物品', type: 'input', enter: true },
      ]])
    }),
  )

  ctx.command('查询嘉奖', '查看嘉奖与处分').action(
    wrap(async ({ session }) => {
      if (!session) return
      if (!(await requireBound(session, deps))) return
      const qqOpenid = session.userId!
      const groupId = session.isDirect
        ? undefined
        : rawRoomIdOf(session) ?? undefined

      const r = await deps.web!.getCharacterStatus(qqOpenid, groupId)
      if (!r?.character) return reply(session, deps, `> ${r?.error ?? '查询失败'}`)
      const c = r.character
      await reply(
        session,
        deps,
        [
          `# ${c.name} · 嘉奖处分`,
          '',
          `嘉奖　**${c.commendations}**`,
          `申诫　**${c.reprimands}**`,
          `MVP　**${c.mvpCount}**`,
          `察看期　**${c.probationCount}**`,
        ].join('\n'),
        [[
          { label: '返回角色状态', data: '/查询状态', primary: true, type: 'input', enter: true },
          { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
        ]],
      )
    }),
  )

  ctx
    .command('查询物品 [name:text]', '查看物品列表 / 单件详情')
    .option('page', '-p [page:posint] 列表分页')
    .action(
      wrap(async ({ session, options }, name) => {
        if (!session) return
        if (!(await requireBound(session, deps))) return
        const qqOpenid = session.userId!
        const groupId = session.isDirect
          ? undefined
          : rawRoomIdOf(session) ?? undefined

        // 带名 → 调 item-detail（搜索详情，结果可能多个）
        if (name && name.trim()) {
          const r = await deps.web!.getItemDetail(
            qqOpenid,
            groupId ?? null,
            name.trim(),
          )
          if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
          if (!r.success || !r.items?.length) {
            return reply(session, deps, `> ${r.error ?? '未找到匹配物品'}`)
          }
          const lines: string[] = [`# 物品详情　**${name.trim()}**`, '']
          for (const it of r.items) {
            lines.push(`**${it.name}**`)
            const effect = sanitizeRichText(it.effect)
            const purchase = sanitizeRichText(it.purchase)
            if (effect) lines.push(`效果　${effect}`)
            if (purchase) lines.push(`购置　${purchase}`)
            lines.push('')
          }
          return reply(session, deps, lines.join('\n').trimEnd(), [
            [
              { label: '返回物品列表', data: '/查询物品', primary: true, type: 'input', enter: true },
              { label: '角色状态', data: '/查询状态', type: 'input', enter: true },
            ],
          ])
        }

        // 不带名 → 分页列表
        const r = await deps.web!.getCharacterStatus(qqOpenid, groupId)
        if (!r?.character) {
          return reply(session, deps, `> ${r?.error ?? '查询失败'}`)
        }
        const items = r.character.items
        if (items.length === 0) return reply(session, deps, '> 暂无物品。')

        const PAGE_SIZE = 5
        const total = items.length
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        const requested =
          ((options as { page?: number } | undefined)?.page) ?? 1
        const cur = Math.max(1, Math.min(requested, totalPages))
        const start = (cur - 1) * PAGE_SIZE
        const slice = items.slice(start, start + PAGE_SIZE)

        const lines: string[] = [
          `# ${r.character.name} · 物品（${cur} / ${totalPages} 页，共 ${total} 件）`,
          '',
        ]
        slice.forEach((it, i) => {
          const idx = start + i + 1
          lines.push(`**${idx}. ${it.name}**`)
        })
        lines.push('')
        lines.push('> 点击下方按钮查看物品详情')

        // 数字按钮：每件物品的"查看详情"，data="查询物品 <名>"
        const numButtons: QQButton[] = slice.map((it) => ({
          label: truncateLabel(it.name),
          data: `/查询物品 ${it.name}`,
          type: 'input',
          enter: true,
        }))

        const prev = Math.max(1, cur - 1)
        const next = Math.min(totalPages, cur + 1)
        const navRow: QQButton[] = []
        if (cur > 1) navRow.push({ label: '上一页', data: `/查询物品 -p ${prev}`, type: 'input', enter: true })
        if (cur < totalPages) navRow.push({ label: '下一页', data: `/查询物品 -p ${next}`, primary: true, type: 'input', enter: true })

        const buttons: QQButton[][] = []
        if (numButtons.length > 0) {
          for (let i = 0; i < numButtons.length; i += 2) {
            buttons.push(numButtons.slice(i, i + 2))
          }
        }
        if (navRow.length) buttons.push(navRow)
        buttons.push([
          { label: '角色状态', data: '/查询状态', type: 'input', enter: true },
          { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
        ])

        await reply(session, deps, lines.join('\n').trimEnd(), buttons)
      }),
    )

  ctx
    .command(
      '查询角色 [page:posint]',
      '列出当前 QQ 绑定账号下的所有角色（分页）',
    )
    .action(
      wrap(async ({ session }, page) => {
        if (!session) return
        if (!(await requireBound(session, deps))) return
        const qqOpenid = session.userId!
        const groupId = session.isDirect
          ? undefined
          : rawRoomIdOf(session) ?? undefined

        const r = await deps.web!.getCharacters(qqOpenid, groupId)
        if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
        if (!r.success || !r.characters?.length) {
          return reply(session, deps, `> ${r.error ?? '该账号下没有角色'}`)
        }

        const PAGE_SIZE = 6
        const total = r.characters.length
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        const requested = page ?? 1
        const cur = Math.max(1, Math.min(requested, totalPages))
        const start = (cur - 1) * PAGE_SIZE
        const slice = r.characters.slice(start, start + PAGE_SIZE)

        const lines: string[] = [
          `# 我的角色（${cur} / ${totalPages} 页）`,
          '',
        ]
        slice.forEach((c, i) => {
          const idx = start + i + 1
          const flags: string[] = []
          if (c.isActive) flags.push('当前')
          if (c.isMissionMember) flags.push('在任务')
          const flagStr = flags.length ? `（${flags.join(' · ')}）` : ''
          lines.push(`**${idx}. ${c.name}**${flagStr}`)
          const meta: string[] = []
          if (c.managerName) meta.push(`经理 ${c.managerName}`)
          if (c.missionName) meta.push(`任务 ${c.missionName}`)
          if (meta.length) lines.push(meta.join(' · '))
          lines.push('')
        })

        const numButtons: QQButton[] = slice.map((c, i) => ({
          label: truncateLabel(c.name, 8),
          data: `/切换角色 ${start + i + 1}`,
          primary: c.isActive,
          type: 'input',
          enter: true,
        }))

        const prevPage = Math.max(1, cur - 1)
        const nextPage = Math.min(totalPages, cur + 1)
        const navRow: QQButton[] = []
        if (cur > 1) navRow.push({ label: '上一页', data: `/查询角色 ${prevPage}`, type: 'input', enter: true })
        if (cur < totalPages) navRow.push({ label: '下一页', data: `/查询角色 ${nextPage}`, primary: true, type: 'input', enter: true })

        const buttons: QQButton[][] = []
        if (numButtons.length > 0) {
          for (let i = 0; i < numButtons.length; i += 2) {
            buttons.push(numButtons.slice(i, i + 2))
          }
        }
        if (navRow.length) buttons.push(navRow)
        buttons.push([
          { label: '角色状态', data: '/查询状态', type: 'input', enter: true },
          { label: '操作菜单', data: '/菜单', type: 'input', enter: true },
        ])

        await reply(session, deps, lines.join('\n').trimEnd(), buttons)
      }),
    )

  ctx.command('切换角色 <target:string>', '切换活跃角色（名称或序号）').action(
    wrap(async ({ session }, target) => {
      if (!session) return
      if (!(await requireBound(session, deps))) return
      const qqOpenid = session.userId!
      if (!target) {
        return reply(session, deps, '**用法**　切换角色 名称或序号')
      }
      const groupId = session.isDirect
        ? undefined
        : rawRoomIdOf(session) ?? undefined

      const list = await deps.web!.getCharacters(qqOpenid, groupId)
      if (!list?.characters) {
        return reply(session, deps, '> 无法获取角色列表。')
      }

      let characterId: string | number | undefined
      const trimmed = target.trim()
      const idx = Number.parseInt(trimmed, 10)
      if (!Number.isNaN(idx) && idx >= 1 && idx <= list.characters.length) {
        characterId = list.characters[idx - 1].id
      } else {
        const matched = list.characters.find((c) => c.name === trimmed)
        if (!matched) {
          return reply(session, deps, `> 未找到名为「${trimmed}」的角色。`)
        }
        characterId = matched.id
      }

      const r = await deps.web!.selectCharacter(qqOpenid, characterId)
      if (!r) return reply(session, deps, NETWORK_ERROR_BLOCK)
      if (!r.success) return reply(session, deps, `> ${r.error ?? '切换失败'}`)
      await reply(
        session,
        deps,
        ['# 已切换角色', '', `当前　**${r.characterName}**`].join('\n'),
        [
          [
            { label: '现实修改', data: '/现实修改', primary: true, type: 'input', enter: true },
            { label: '异常能力', data: '/异常能力', primary: true, type: 'input', enter: true },
          ],
          [
            { label: '角色状态', data: '/查询状态', type: 'input', enter: true },
            { label: '角色列表', data: '/查询角色', type: 'input', enter: true },
          ],
        ],
      )
    }),
  )
}

type CharacterData = NonNullable<CharacterStatusResp['character']>

export interface CharacterCardPage {
  label: string
  lines: string[]
}

/** 将完整角色卡按栏目分页；长列表继续拆成多个子页。 */
export function buildCharacterCardPages(c: CharacterData): CharacterCardPage[] {
  const pages: CharacterCardPage[] = []

  const basic = [
    `异常　**${c.anomaly}**`,
    `现实　**${c.reality}**`,
    `职能　**${c.competency}**`,
    '',
    `嘉奖　**${c.commendations}**　申诫　**${c.reprimands}**`,
    `MVP　**${c.mvpCount}**　察看期　**${c.probationCount}**`,
  ]
  if (c.managerName) basic.push(`经理　**${c.managerName}**`)
  if (c.activeMission) basic.push(`当前任务　**${c.activeMission.name}**`)
  pages.push({ label: '基础信息', lines: basic })

  pages.push({
    label: '资质（当前 / 上限）',
    lines: APTITUDE_NAMES.map((name) => {
      const aptitude = c.aptitudes?.[name]
      return `**${name}**　当前 **${aptitude?.current ?? 0}**　上限 **${aptitude?.max ?? 0}**`
    }),
  })

  const anomalyLines = (c.anomalies ?? []).map((anomaly) => {
    const meta = [anomaly.qualName ?? '未指定资质', anomaly.trained ? '熟练' : '未熟练'].join(' · ')
    return `- **${anomaly.name}**　${meta}`
  })
  pushListPages(pages, '异常能力', anomalyLines, '> 暂无异常能力。')

  const relationLines = (c.relations ?? []).map((relation) =>
    `- **${relation.name}**　连结 **${relation.level}**${relation.inNetwork ? ' · 关系网内' : ''}`,
  )
  pushListPages(pages, '关系', relationLines, '> 暂无关系。')

  const itemLines = (c.items ?? []).map((item, index) => `**${index + 1}. ${item.name}**`)
  pushListPages(pages, '申领物', itemLines, '> 暂无申领物。')

  return pages
}

function pushListPages(
  pages: CharacterCardPage[],
  label: string,
  lines: string[],
  emptyLine: string,
  pageSize = 6,
): void {
  if (lines.length === 0) {
    pages.push({ label, lines: [emptyLine] })
    return
  }
  const count = Math.ceil(lines.length / pageSize)
  for (let index = 0; index < count; index++) {
    const suffix = count > 1 ? ` ${index + 1}/${count}` : ''
    pages.push({
      label: `${label}${suffix}`,
      lines: lines.slice(index * pageSize, (index + 1) * pageSize),
    })
  }
}

async function fetchCharacter(session: Session, deps: QueryDeps) {
  if (!(await requireBound(session, deps))) return null
  const groupId = session.isDirect ? undefined : rawRoomIdOf(session) ?? undefined
  const result = await deps.web!.getCharacterStatus(session.userId!, groupId)
  if (!result) {
    await reply(session, deps, NETWORK_ERROR_BLOCK)
    return null
  }
  if (!result.success || !result.character) {
    await reply(session, deps, `> ${result.error ?? '查询失败'}`)
    return null
  }
  return result.character
}

async function reply(
  session: Session,
  deps: QueryDeps,
  content: string,
  buttons?: QQButton[][],
): Promise<void> {
  await sendQQMarkdown(session, content, {
    enabled: deps.useMarkdown,
    buttons,
  })
}

function truncateLabel(s: string, max = 10): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}
