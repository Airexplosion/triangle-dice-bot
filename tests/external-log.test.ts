import { describe, expect, it, vi } from 'vitest'
import { createExternalLogRecorder, registerLogCommands } from '../src/commands/log'
import type { LogStore } from '../src/service/log-store'

/**
 * 回归测试：外部 OneBot 桥（red）的回复走 bridge 的 bot.internal.sendMessage，
 * 绕过了 sendQQMarkdown 钩子，因此靠 globalThis.__triangleLogRecordExternal 这个
 * 全局函数补记进跑团日志。
 *
 * 这段实现曾经只被手工加进 lib/ 的编译产物里，源码中并不存在 —— 一次
 * `npm run build` 就被 tsc 覆盖掉，导致 .rd 的骰点结果从此静默不再入日志
 * （bridge 侧是 `typeof rec === 'function'` 的软判断，失效时不报错）。
 *
 * 下面第二组测试专门盯住「注册」这一步，确保它不会再次消失。
 */

interface AppendedLine {
  logId: number
  senderId: string
  senderName: string
  kind: string
  content: string
  time: Date
}

function mockStore(recordingId: number | undefined) {
  const appended: AppendedLine[] = []
  const store = {
    recordingLogId: () => recordingId,
    appendLine: async (line: AppendedLine) => {
      appended.push(line)
    },
  } as unknown as LogStore
  return { store, appended }
}

describe('createExternalLogRecorder', () => {
  it('录制中：记录成功并返回 true', () => {
    const { store, appended } = mockStore(42)
    const rec = createExternalLogRecorder(store)

    expect(rec('qq:GROUP_OPENID', '红', '「侦查」检定: D100=37/60 成功')).toBe(true)
    expect(appended).toHaveLength(1)
    expect(appended[0].logId).toBe(42)
    expect(appended[0].senderName).toBe('红')
    expect(appended[0].kind).toBe('bot')
    expect(appended[0].content).toBe('「侦查」检定: D100=37/60 成功')
  })

  it('未开启录制：返回 false 且不写入', () => {
    const { store, appended } = mockStore(undefined)
    const rec = createExternalLogRecorder(store)

    expect(rec('qq:GROUP_OPENID', '红', '掷骰结果')).toBe(false)
    expect(appended).toHaveLength(0)
  })

  it('roomId 为空：返回 false', () => {
    const { store, appended } = mockStore(42)
    const rec = createExternalLogRecorder(store)

    expect(rec('', '红', '掷骰结果')).toBe(false)
    expect(appended).toHaveLength(0)
  })

  it('内容为空或纯空白：返回 false，不产生空行', () => {
    const { store, appended } = mockStore(42)
    const rec = createExternalLogRecorder(store)

    expect(rec('qq:G', '红', '')).toBe(false)
    expect(rec('qq:G', '红', '   ')).toBe(false)
    expect(appended).toHaveLength(0)
  })

  it('剥离 markdown 后再入库', () => {
    const { store, appended } = mockStore(7)
    const rec = createExternalLogRecorder(store)

    rec('qq:G', '红', '**加粗**的结果')
    expect(appended[0].content).not.toContain('**')
    expect(appended[0].content).toContain('加粗')
  })

  it('发送者名缺省为「红」，kind 缺省为 bot', () => {
    const { store, appended } = mockStore(7)
    const rec = createExternalLogRecorder(store)

    rec('qq:G', '', '结果')
    expect(appended[0].senderName).toBe('红')
    expect(appended[0].kind).toBe('bot')
    expect(appended[0].senderId).toBe('onebot')
  })

  it('可指定 kind（如 dice）', () => {
    const { store, appended } = mockStore(7)
    const rec = createExternalLogRecorder(store)

    rec('qq:G', '红', '结果', 'dice')
    expect(appended[0].kind).toBe('dice')
  })

  it('store 抛异常时吞掉并返回 false，不影响转发', () => {
    const store = {
      recordingLogId: () => {
        throw new Error('db down')
      },
      appendLine: async () => {},
    } as unknown as LogStore
    const rec = createExternalLogRecorder(store)

    expect(rec('qq:G', '红', '结果')).toBe(false)
  })
})

describe('全局钩子注册（防止再次被 build 冲掉）', () => {
  function mockCtx() {
    const action = vi.fn().mockReturnThis()
    return {
      middleware: vi.fn(),
      command: vi.fn(() => ({ action })),
      on: vi.fn(),
    }
  }

  it('registerLogCommands 后，globalThis.__triangleLogRecordExternal 是可用函数', () => {
    delete globalThis.__triangleLogRecordExternal
    const { store } = mockStore(99)

    registerLogCommands(mockCtx() as never, { store, web: null, useMarkdown: false })

    expect(typeof globalThis.__triangleLogRecordExternal).toBe('function')
  })

  it('注册后的钩子确实能把外部消息写进日志', () => {
    delete globalThis.__triangleLogRecordExternal
    const { store, appended } = mockStore(123)

    registerLogCommands(mockCtx() as never, { store, web: null, useMarkdown: false })
    const ok = globalThis.__triangleLogRecordExternal!('qq:G', '红', 'D100=5 大成功')

    expect(ok).toBe(true)
    expect(appended).toHaveLength(1)
    expect(appended[0].content).toBe('D100=5 大成功')
  })
})
