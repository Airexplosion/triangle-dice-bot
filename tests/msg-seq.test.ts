import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetMsgSeqCounterForTesting,
  nextMsgSeqFor,
} from '../src/util/qq-markdown'

/**
 * 回归测试：QQ 服务端要求同一 msg_id 多次回复时 msg_seq 全局递增。
 * 之前曾错误地把计数器挂在 session 上（per-session 计数），callback 来的新 session
 * 会重新从 1 开始 → 与之前命令用过的 seq 1 撞 → QQ 拒（Bad Request 40034025）。
 *
 * 这个测试锁死"per msg_id 计数"语义。
 */
describe('nextMsgSeqFor', () => {
  beforeEach(() => __resetMsgSeqCounterForTesting())

  it('first call for a key returns 1', () => {
    expect(nextMsgSeqFor('msg-A')).toBe(1)
  })

  it('subsequent calls for same key increment', () => {
    expect(nextMsgSeqFor('msg-A')).toBe(1)
    expect(nextMsgSeqFor('msg-A')).toBe(2)
    expect(nextMsgSeqFor('msg-A')).toBe(3)
  })

  it('different keys have independent counters', () => {
    expect(nextMsgSeqFor('msg-A')).toBe(1)
    expect(nextMsgSeqFor('msg-B')).toBe(1)
    expect(nextMsgSeqFor('msg-A')).toBe(2)
    expect(nextMsgSeqFor('msg-B')).toBe(2)
    expect(nextMsgSeqFor('msg-C')).toBe(1)
  })

  it('reset clears all counters', () => {
    nextMsgSeqFor('msg-A')
    nextMsgSeqFor('msg-A')
    __resetMsgSeqCounterForTesting()
    expect(nextMsgSeqFor('msg-A')).toBe(1)
  })
})
