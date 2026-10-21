/**
 * kimpoSqlCompletion —— 表达式编辑区函数补全的**纯逻辑**（取词字符集 / 字符串内抑制 / 候选筛选）。
 *
 * 与 tokenDelete.ts 同款分层：CodeMirror 相关的部分（matchBefore、dispatch 插入）留在
 * ExpressionSqlEditor.vue，判定逻辑抽到这里，好让判据用纯函数测，不必端起一整个编辑器。
 *
 * ① **标识符字符集必须含中文**。中文界面下函数别名本身就是中文（`合计(` / `连接文本(`，见
 *    functionCatalog.ts 的别名镜像），用 ASCII-only 的 `[A-Za-z_]` 取词等于让补全在默认语言下
 *    永不触发。这里与着色扫描器（kimpoSqlHighlight.ts IDENT_START/IDENT_PART）共用同一套字符
 *    集，避免出现「能染色却补不出」这种自相矛盾。
 *
 * ② **展示名 ≠ 插入别名，两个都得能匹配**。目录项的 label 是业务展示名（`求和`），snip 才是真
 *    正落进表达式的 KimpoSQL 别名（`合计()`）——两者不同字。只按展示名过滤的话，用户照着已有
 *    表达式里看到的 `合计` 打字将一条也匹配不到。故双向匹配，且调用方要对 CodeMirror 关掉二次
 *    过滤（filter:false），否则它会再用 label 滤一遍、把靠别名命中的项重新滤掉。
 */

/** 标识符字符集：与 kimpoSqlHighlight 的 IDENT_START/IDENT_PART 同口径（含 CJK）。 */
export const COMPLETION_IDENT = /[A-Za-z_一-龥][A-Za-z0-9_一-龥]*/;

/** 函数目录项（调用方从 functionCatalog 映射而来）。 */
export interface CompletionFunctionItem {
  /** 插入片段，如 `合计()`；以 "()" 结尾时光标回退 1 落进括号内。 */
  snip: string;
  /** 业务展示名，如 `求和`。 */
  label: string;
  /** 说明文案。 */
  detail?: string;
  /**
   * 常驻匹配键：任何界面语言下都参与前缀匹配的
   * 别名，典型是函数的英文规范名（`SUM`）。只做匹配、**不作为插入片段**——插入仍用当前语言包的 snip：
   * 服务端中文包虽把多数英文名登记为额外别名，但不是全部（行数/空值计数等
   * 没有），前端目录里也拿不到那张表，插入英文名有概率被服务端拒；用当前语言别名插入则一定能解析。
   * 命中英文键的候选在 detail 里并列显示英文名，用户能认出「打 su 出来的 合计 就是 SUM」。
   */
  aliases?: readonly string[];
}

/** 一条候选：已算好展示字段与插入后的光标回退量。 */
export interface CompletionCandidate {
  /** 列表主文案 = 别名（所见即所得，它才是落进文本里的字）。 */
  label: string;
  /** 列表右侧 = 业务展示名。 */
  detail?: string;
  /** 选中态说明面板 = 完整描述。 */
  info?: string;
  /** 插入片段原文。 */
  snip: string;
  /** 插入后光标从末尾回退几个字符。 */
  back: number;
}

/**
 * 别名（真正落进表达式的函数名）= 片段开头那一串标识符字符：
 * `合计()` → `合计`、`年份(` → `年份`、关键字构造 `分支 当  则  否则  结束` → `分支`。
 * 取「开头一串」而不是「去掉尾括号」，是为了让关键字构造这类多词片段也有一个短别名可匹配。
 */
export function aliasOf(snip: string): string {
  return snip.match(new RegExp('^' + COMPLETION_IDENT.source))?.[0] ?? snip;
}

/**
 * 光标是否落在字符串字面量内部——引号内是数据不是代码，不该弹函数补全。
 * 判据：光标之前未转义的单引号个数为奇数（`''` 是转义的单引号，成对抵消）。
 */
export function insideStringLiteral(before: string): boolean {
  const singles = (before.match(/'/g) ?? []).length;
  const escaped = (before.match(/''/g) ?? []).length;
  return (singles - escaped * 2) % 2 === 1;
}

/**
 * 按已键入前缀筛候选。前缀为空（显式 Ctrl+Space 唤起）时列全量目录。
 * 匹配大小写不敏感，别名与展示名任一前缀命中即入选。
 */
export function matchFunctionCandidates(
  typed: string,
  functions: readonly CompletionFunctionItem[]
): CompletionCandidate[] {
  const needle = typed.toLowerCase();
  const out: CompletionCandidate[] = [];
  for (const fn of functions) {
    const alias = aliasOf(fn.snip);
    // 常驻匹配键去掉与别名/展示名重名的（英文界面下英文名本身就是别名，不必再列一遍）。
    const extra = (fn.aliases ?? []).filter(a => a && a.toLowerCase() !== alias.toLowerCase() && a.toLowerCase() !== fn.label.toLowerCase());
    if (
      needle &&
      !alias.toLowerCase().startsWith(needle) &&
      !fn.label.toLowerCase().startsWith(needle) &&
      !extra.some(a => a.toLowerCase().startsWith(needle))
    )
      continue;
    out.push({
      label: alias,
      // 右侧展示名并列常驻键（`求和 · SUM`），让按英文打出来的中文候选可被认出。
      detail: extra.length ? `${fn.label} · ${extra.join(' / ')}` : fn.label,
      info: fn.detail,
      snip: fn.snip,
      back: fn.snip.endsWith('()') ? 1 : 0
    });
  }
  return out;
}
