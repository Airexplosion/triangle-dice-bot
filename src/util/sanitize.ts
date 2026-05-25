/**
 * 把 web 端富文本（飞书剪贴板 / Lark 文档生成的 HTML）清洗成纯文本。
 *
 * 角色卡 web 的「物品 effect / 购置」等字段允许富文本，前端用飞书剪贴 → 含
 *   <div class="ace-line" data-lark-record-data="{&quot;isCut&quot;:..." ...>
 *   <span data-lark-record-data=...>
 *   &quot; / &amp; / &nbsp;
 * 直接显示到 QQ markdown 上就是"天书"。本函数只做安全清洗，不依赖外部库。
 */
export function sanitizeRichText(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input)

  // 1) 先把 data-lark-record-data="..." 这种巨长 attribute 整段抹掉
  //    （它里面是 quoted JSON，含 &quot; 和 HTML 实体，会污染后续清洗）
  s = s.replace(/\s*data-lark-record-data\s*=\s*"[^"]*"/gi, '')
  s = s.replace(/\s*data-[a-z-]+\s*=\s*"[^"]*"/gi, '') // 同理移除其它 data-* attribute
  s = s.replace(/\s*class\s*=\s*"[^"]*"/gi, '')

  // 2) 块级标签 → 换行
  s = s.replace(/<\/?(div|p|br|li|h\d|tr)\b[^>]*>/gi, '\n')

  // 3) 移除剩余所有标签
  s = s.replace(/<[^>]+>/g, '')

  // 4) 解 HTML entities
  const ENTITY: Record<string, string> = {
    '&quot;': '"',
    '&apos;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
    '&#39;': "'",
    '&#34;': '"',
  }
  s = s.replace(/&(quot|apos|amp|lt|gt|nbsp|#39|#34);/g, (m) => ENTITY[m] ?? m)
  // 数字实体（&#NNN; / &#xHH;）
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
    String.fromCharCode(Number.parseInt(h, 16)),
  )

  // 5) 规范化空白：多重换行 → 双换行；行首尾空格去掉
  s = s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return s
}
