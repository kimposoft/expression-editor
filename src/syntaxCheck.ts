/**
 * 文本模式的**即时轻检查**。
 *   - 括号配对（unclosedParen / unexpectedParen）；
 *   - {…} 字段标记形态（unclosedToken / emptyToken）；
 *   - 标记内容是否在传入目录中（unknownField）——与确认时 buildLowerTextRefs 的解析共用同一口径，
 *     否则会出现"状态条说没问题、点确定却报无法识别字段"的自相矛盾。
 *
 * 为什么选"降级保留"而不是整删：这三项都是键入过程中的高频笔误（漏右括号、字段标记没闭合、手敲了
 * 一个不存在的字段名），本地 0 延迟反馈比 1.5s 后等服务端回包体验好得多，且三项判据与 表达式引擎 语法
 * 完全一致（括号/花括号语义两边相同），不存在"本地放行、服务端拒绝"或反之的分歧。
 *
 * 刻意**删掉**的旧判据（它们与服务端打架，是本次降级的直接原因）：
 *   - `[]` 整段不透明跳过：表达式引擎 里 `[label]` 是标识符引用语法（WORKFINE 方言 `[label]#{id}`），不是
 *     正则黑盒，本地跳过会把服务端要解析的内容藏起来；
 *   - `--` / `/* *\/` 注释跳过：服务端 ALICE_SYNTAX_COMMENT_FORBIDDEN 明确拒绝注释，本地不能假装它合法；
 *   - danglingOperator（运算符缺操作数）：中文关键字（并且/或者/不/为 空值/属于…）与一元/前缀形态太多，
 *     本地词法无法与服务端逐字对齐，误报概率高；服务端 ALICE_SYNTAX_* 会给出准确位置，交给它。
 *
 * 文本约定与 rawSerialize.ts 保持一致：字段标记 `{…}` 内不允许再嵌套 `{`/`}`（与 FIELD_TOKEN =
 * /\{([^{}]*)\}/g 同口径）；字符串字面量单引号包裹、`''` 表示一个单引号，字符串内的括号/花括号不参与
 * 配对/解析（表达式引擎 词法同样如此）。
 */

/** 轻检查错误码——调用方按 code 映射多语言文案（locales 的 dialog.syntaxErr.* 五键一一对应），本模块不产出面向用户的字符串。 */
export type SyntaxErrorCode =
  | 'unclosedParen' // 有 ( 未闭合
  | 'unexpectedParen' // 多余的 )
  | 'unclosedToken' // { 未闭合
  | 'emptyToken' // {} 空字段标记
  | 'unknownField'; // 字段标记内容不在传入目录中

export interface SyntaxIssue {
  code: SyntaxErrorCode;
  /** 0 基 UTF-16 字符下标，供 UI「定位到字符附近」。 */
  index: number;
  /** 补充信息（如 unknownField 时为标记文本），调用方可插进文案。 */
  detail?: string;
}

export interface SyntaxCheckResult {
  ok: boolean;
  issue?: SyntaxIssue;
}

/**
 * 轻检查主入口：同步纯计算，无网络/定时器/响应式副作用。
 * 空文本（含纯空白）视为合法（不能把"还没输入"当错误，否则会把「确定」锁死）。
 * 只返回第一个错误——多处同时有问题时按字符下标取最靠前的一个（贴合"定位到字符附近"的单点定位）。
 */
export function checkExpressionSyntax(text: string, opts: { isKnownLabel: (label: string) => boolean }): SyntaxCheckResult {
  if (text.trim() === '') return { ok: true };

  const n = text.length;
  const issues: SyntaxIssue[] = [];
  const parenStack: number[] = []; // 未闭合 '(' 的下标，按出现顺序

  let i = 0;
  while (i < n) {
    const ch = text[i];

    // 字符串字面量：单引号包裹，'' 转义为字面量单引号；内部任何字符（含括号/花括号）一律不参与配对。
    if (ch === "'") {
      i++;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2; // 转义单引号，仍在字符串内
            continue;
          }
          i++; // 收尾引号
          break;
        }
        i++;
      }
      // 未终止字符串：i 已推进到 n，字符串是否闭合由服务端 ALICE_SYNTAX_* 判，本函数不报。
      continue;
    }

    // 字段标记 {…}：与 rawSerialize.ts 的 FIELD_TOKEN 同一口径——内容不允许再含 { 或 }。
    if (ch === '{') {
      const start = i;
      let j = i + 1;
      while (j < n && text[j] !== '{' && text[j] !== '}') j++;
      if (j >= n || text[j] === '{') {
        // 到文本末尾都没等到 }，或者先撞上了下一个 {（当前这个 { 在它自己这一层永远配不出合法标记，
        // 与 FIELD_TOKEN 正则对连续 { 的处理结果一致）——判未闭合，只吃掉这一个字符，剩余文本继续扫。
        issues.push({ code: 'unclosedToken', index: start });
        i = start + 1;
        continue;
      }
      const label = text.slice(start + 1, j).trim();
      if (label === '') {
        issues.push({ code: 'emptyToken', index: start });
      } else if (!opts.isKnownLabel(label)) {
        issues.push({ code: 'unknownField', index: start, detail: label });
      }
      i = j + 1;
      continue;
    }

    // 括号配对。
    if (ch === '(') {
      parenStack.push(i);
      i++;
      continue;
    }
    if (ch === ')') {
      if (parenStack.length === 0) issues.push({ code: 'unexpectedParen', index: i });
      else parenStack.pop();
      i++;
      continue;
    }

    i++;
  }

  // 扫描结束仍留在栈里的 '(' 均未闭合；[0] 是最早那个——定位到它比定位到最内层更贴近用户真正漏打右括号的位置。
  if (parenStack.length > 0) issues.push({ code: 'unclosedParen', index: parenStack[0] });

  if (issues.length === 0) return { ok: true };
  issues.sort((a, b) => a.index - b.index);
  return { ok: false, issue: issues[0] };
}
