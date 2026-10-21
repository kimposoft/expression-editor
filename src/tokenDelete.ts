/**
 * tokenDelete —— 「退格/删除整个字段标记」的边界判定（纯函数，供编辑器 keymap 消费）。
 *
 * 抽成独立模块而不是留在组件里：这套边界规则有明确的正反判据（紧邻完整标记才接管、其余一律
 * 交回默认逐字符删除），值得被单测直接钉住，不该只活在组件内部——与 matchKeyExtract.ts /
 * bracketText.ts 同一条抽离约定。
 */

/**
 * 光标紧邻一个完整字段标记时，Backspace/Delete **整段删除**，而不是一个字符一个字符地啃
 * （删一个长字段名要按很多次退格）。
 *
 * 两种语法一并支持：`{本报表.表.字段}`（braces / 3.4）与 `[表].[字段]`（brackets / V4）。
 * 原 textarea 版只处理了 braces——V4 侧因此一直在啃字符，这里顺带补齐。
 *
 * 边界（与原实现同口径）：有选区时交回默认行为（选区删除本身已是整体）；光标不在标记边界上
 * （含"停在 token 内部"）同样交回默认行为，仍是逐字符删除。
 */
export function tokenBoundaryBefore(text: string, pos: number): number | null {
  if (pos <= 0) return null;
  const prev = text[pos - 1];
  if (prev === '}') {
    const open = text.lastIndexOf('{', pos - 2);
    if (open < 0 || text.slice(open + 1, pos - 1).includes('{')) return null;
    return open;
  }
  if (prev === ']') {
    let end = pos;
    for (;;) {
      if (text[end - 1] !== ']') break;
      const open = text.lastIndexOf('[', end - 2);
      if (open < 0 || text.slice(open + 1, end - 1).includes('[')) break;
      end = open;
      if (text[end - 1] === '.' && text[end - 2] === ']') { end -= 1; continue; }
      break;
    }
    return end < pos ? end : null;
  }
  return null;
}

export function tokenBoundaryAfter(text: string, pos: number): number | null {
  const next = text[pos];
  if (next === '{') {
    const close = text.indexOf('}', pos + 1);
    if (close < 0 || text.slice(pos + 1, close).includes('}')) return null;
    return close + 1;
  }
  if (next === '[') {
    let end = pos;
    for (;;) {
      if (text[end] !== '[') break;
      const close = text.indexOf(']', end + 1);
      if (close < 0 || text.slice(end + 1, close).includes('[')) break;
      end = close + 1;
      if (text[end] === '.' && text[end + 1] === '[') { end += 1; continue; }
      break;
    }
    return end > pos ? end : null;
  }
  return null;
}

