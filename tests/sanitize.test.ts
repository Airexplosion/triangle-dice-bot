import { describe, expect, it } from 'vitest'
import { sanitizeRichText } from '../src/util/sanitize'

/**
 * 回归测试：物品 effect / purchase 字段在 web 端是飞书剪贴板富文本（含 lark 特定 attribute、
 * HTML 标签、HTML 实体），直接显示就是天书。这个 sanitizer 保证常见污染都能被剥成纯文本。
 */
describe('sanitizeRichText', () => {
  it('解 HTML 实体', () => {
    expect(sanitizeRichText('&quot;hi&quot; &amp; &lt;tag&gt;')).toBe('"hi" & <tag>')
    expect(sanitizeRichText('&nbsp;a&#39;b')).toBe("a'b")
    expect(sanitizeRichText('&#34;quoted&#34;')).toBe('"quoted"')
  })

  it('数字实体（十进制 / 十六进制）', () => {
    expect(sanitizeRichText('&#65;&#x42;')).toBe('AB')
  })

  it('移除 HTML 标签，保留文本', () => {
    expect(sanitizeRichText('<b>粗体</b>普通')).toBe('粗体普通')
    expect(sanitizeRichText('<div>第一段</div><div>第二段</div>')).toBe(
      '第一段\n\n第二段',
    )
  })

  it('移除 lark 特定的 data-* / class attribute（含巨长 JSON）', () => {
    const raw =
      '<div data-page-id="X" data-lark-record-data="{&quot;isCut&quot;:false,&quot;rootId&quot;:&quot;X&quot;}" class="ace-line">真正内容</div>'
    expect(sanitizeRichText(raw)).toBe('真正内容')
  })

  it('lark 剪贴板典型场景（飞书复制）', () => {
    const raw =
      '<div data-page-id="XHRFdJwc9oPzJpx9MQmcgO2gnyf" data-lark-html-role="root" data-docx-has-block-data="false">' +
      '<div class="ace-line ace-line old-record-id-OZLcd1uFaoF4rBxfkYbcUNqGnqh">一个小袋里面装着普通的粉笔灰，有时是啤酒泡沫，根据前一天是否进行了团建决定。</div>' +
      '<div class="ace-line ace-line old-record-id-SVzXdzsrRoyFy7xj41wcHF3Hn8g">每次任务限一次：你可以选择将粉尘洒向周围，让自己从当前场景永久消失，直到下个场景；或者将粉尘洒向自己，让自己在当前场景一直存在，直到下个场景。</div>' +
      '</div><span data-lark-record-data="{&quot;isCut&quot;:false,&quot;rootId&quot;:&quot;XHRFdJwc9oPzJpx9MQmcgO2gnyf&quot;}"></span>'
    const out = sanitizeRichText(raw)
    // 应该只剩两段纯文本，用换行分隔
    expect(out).toContain('一个小袋里面装着普通的粉笔灰')
    expect(out).toContain('每次任务限一次')
    expect(out).not.toContain('<')
    expect(out).not.toContain('data-')
    expect(out).not.toContain('&quot;')
    expect(out).not.toContain('ace-line')
  })

  it('空 / null / undefined 安全处理', () => {
    expect(sanitizeRichText('')).toBe('')
    expect(sanitizeRichText(null)).toBe('')
    expect(sanitizeRichText(undefined)).toBe('')
  })

  it('多重换行规范化（≥3 换行 → 双换行）', () => {
    const raw = '一\n\n\n\n二'
    expect(sanitizeRichText(raw)).toBe('一\n\n二')
  })

  it('纯文本不变（无 HTML）', () => {
    expect(sanitizeRichText('只是普通文本')).toBe('只是普通文本')
  })
})
