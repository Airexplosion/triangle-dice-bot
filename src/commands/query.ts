import type { Context, Session } from 'koishi'
import { rawRoomIdOf } from '../room'
import type { WebClient } from '../service/web-client'
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

  ctx.command('查询状态', '查看角色信息').action(
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
      if (c.items.length > 0) {
        lines.push('')
        lines.push(`物品（${c.items.length}）`)
        for (const it of c.items.slice(0, 5)) {
          lines.push(`- ${it.name}`)
        }
        if (c.items.length > 5) lines.push(`…还有 ${c.items.length - 5} 件`)
      }
      const buttons: QQButton[][] = [
        [
          { label: '嘉奖', data: '/查询嘉奖', type: 'input', enter: true },
          { label: '物品', data: '/查询物品', type: 'input', enter: true },
          { label: '角色', data: '/查询角色', type: 'input', enter: true },
        ],
      ]
      await reply(session, deps, lines.join('\n'), buttons)
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
      )
    }),
  )

  ctx
    .command('查询物品 [name:string]', '查看物品列表 / 单件详情')
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
            [{ label: '返回', data: '/查询物品', type: 'input', enter: true }],
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
        const navRow: QQButton[] = [
          { label: '◀', data: `/查询物品 -p ${prev}`, primary: cur > 1, type: 'input', enter: true },
          { label: '▶', data: `/查询物品 -p ${next}`, primary: cur < totalPages, type: 'input', enter: true },
        ]

        const buttons: QQButton[][] = []
        if (numButtons.length > 0) {
          const first = numButtons.slice(0, Math.min(3, numButtons.length))
          const second = numButtons.slice(3)
          buttons.push(first)
          if (second.length > 0) buttons.push(second)
        }
        buttons.push(navRow)

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
        slice.forEach((c) => {
          const idx = start + r.characters!.indexOf(c) + 1
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
          label: String(start + i + 1),
          data: `/切换角色 ${start + i + 1}`,
          primary: c.isActive,
          type: 'input',
          enter: true,
        }))

        const prevPage = Math.max(1, cur - 1)
        const nextPage = Math.min(totalPages, cur + 1)
        const navRow: QQButton[] = [
          { label: '◀', data: `/查询角色 ${prevPage}`, primary: cur > 1, type: 'input', enter: true },
          { label: '▶', data: `/查询角色 ${nextPage}`, primary: cur < totalPages, type: 'input', enter: true },
        ]

        const buttons: QQButton[][] = []
        if (numButtons.length > 0) {
          const firstRow = numButtons.slice(0, 3)
          const secondRow = numButtons.slice(3)
          buttons.push(firstRow)
          if (secondRow.length > 0) buttons.push(secondRow)
        }
        buttons.push(navRow)

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
        [[{ label: '状态', data: '/查询状态', type: 'input', enter: true }]],
      )
    }),
  )
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
