/**
 * kimpoSqlHighlight —— KimpoSQL 表达式的轻量词法扫描，供编辑器按元素类型着色。
 *
 * ── 为什么是「轻量扫描」而不是完整语法 ──────────────────────────────────────
 * 着色只需要知道「这一段是什么」，不需要知道「这个表达式的结构是什么」。完整语法（Lezer）
 * 要在前端复刻一份 KimpoSQL 文法，与服务端 `alice/syntax` 的 lexer/parser 长期同步——那是
 * 一个持续漂移源。本扫描器只识别 5 类**词法**形态，它们的边界规则简单且稳定：
 *
 *   ref     `[表].[字段]` / `[标签]`  —— 方括号引用（V4 / WORKFINE 方言）
 *   string  `'...'`（内部 '' 为转义单引号）
 *   number  十进制数字
 *   func    标识符紧跟 `(`
 *   keyword CASE / WHEN / THEN / ELSE / END / AND / OR / NOT / NULL / IS / IN / LIKE / BETWEEN
 *
 * ── 引号铁律（与服务端同一条）────────────────────────────────────────────
 * 字符串字面量内部的 `[x].[y]` **不是**字段引用。扫描器按「先进字符串、整段吃到闭合引号」
 * 的顺序处理，天然不会把引号内的方括号识别成引用——与服务端 tokenize「按 AST 节点区间切片、
 * 绝不做正则替换」是同一条纪律的前端对应物。
 *
 * ── 类型细分（来源字段 / 系统变量）──────────────────────────────────────
 * 词法层看不出一段 `[…]` 是字段还是系统变量——两者在 V4 文本里同形。细分靠调用方传入的
 * `refKinds`（label → kind，来自服务端 tokenize 的 refs）做**尽力匹配**：匹配到就上专属色，
 * 匹配不到退回通用引用色。**绝不猜**——宁可少上一点色，也不能把变量染成字段误导用户。
 */

/** 一段被识别出来的词法片段。from/to 是 UTF-16 下标（CodeMirror 的坐标系）。 */
export interface HighlightToken {
  from: number;
  to: number;
  kind: 'ref' | 'ref-source' | 'ref-var' | 'ref-report' | 'ref-table' | 'string' | 'number' | 'func' | 'keyword';
  /** kind='ref-table'：方括号内的表显示名（`[入库流水].[数量]` → `入库流水`），供调用方查表主题色。
   *  kind='ref-table' 且 staging=true 时这里是列名（暂存表没有「表」分段，见 staging 字段注释）。 */
  table?: string;
  /** kind='ref-table'：带 `本报表.` 前缀（token 区间含该前缀）。 */
  report?: boolean;
  /** kind='ref-table'：带 `暂存表.` 前缀（token 区间含该前缀）。暂存来源是「虚拟单表」，`暂存表.[列]`
   *  只有一段方括号（没有独立的 [表] 分段），故与 report 分开一个标记——消费方（tableThemeColors.
   *  splitBracketRefs）按它走同一条「保留独立着色角色」的路径，但不复用 report 的表名查找逻辑。 */
  staging?: boolean;
}

/** 本报表引用前缀（`本报表.[表].[字段]`，与 rawSerialize.REPORT_PREFIX / bracketText.REPORT_TEXT_PREFIX 同一写法）。 */
const REPORT_PREFIX_TAIL = /本报表\s*\.\s*$/;
/** 暂存来源引用前缀（`暂存表.[列]`，与 rawSerialize.STAGING_PREFIX / bracketText.STAGING_TEXT_PREFIX 同一写法）。
 *  只在单段方括号前生效——暂存表没有 `本报表.[表].[字段]` 那样的独立表分段。 */
const STAGING_PREFIX_TAIL = /暂存表\s*\.\s*$/;

const KEYWORDS = new Set([
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'DISTINCT',
  // 2026-09-07 模糊匹配三分关键字（服务端 kw.contains / kw.starts_with / kw.ends_with）
  'CONTAINS', 'STARTS_WITH', 'ENDS_WITH'
]);

const IDENT_START = /[A-Za-z_一-龥]/;
const IDENT_PART = /[A-Za-z0-9_一-龥]/;

/**
 * 扫描一段 KimpoSQL 文本，产出按位置升序、互不重叠的词法片段。
 *
 * refKinds 可选：把 `[…]` 引用的**文本原样**（含方括号，如 `[入库流水].[物料编码]`）映射到
 * 'source' | 'var'。未提供或未命中时该段落 kind='ref'（通用引用色）。
 */
export function scanKimpoSql(text: string, refKinds?: Map<string, 'source' | 'var'>): HighlightToken[] {
  const out: HighlightToken[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    // ① 字符串字面量：整段吃到闭合引号（'' 是转义的单引号，不算闭合）。必须排在方括号之前——
    //    引号铁律：引号内的 [x].[y] 不是引用。
    if (ch === "'") {
      const from = i;
      i += 1;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") { i += 2; continue; } // 转义的单引号
          i += 1;
          break;
        }
        i += 1;
      }
      out.push({ from, to: i, kind: 'string' });
      continue;
    }

    // ② 方括号引用：可能是 `[表].[字段]` 这样的多段形态，连着一起吃做类型匹配；多段时拆成
    //    「表段（ref-table，含 `本报表.` 前缀）+ 字段段」两枚 token——表段按表主题色、字段段按类型
    //    各自着色。
    if (ch === '[') {
      const from = i;
      const segs: Array<{ from: number; to: number }> = [];
      let end = i;
      // 反复吃 `[...]`，段间只允许一个点号（`[a].[b]`）。不闭合则整段当普通文本放弃。
      for (;;) {
        if (text[end] !== '[') break;
        const close = text.indexOf(']', end + 1);
        if (close < 0) break;
        segs.push({ from: end, to: close + 1 });
        end = close + 1;
        if (text[end] === '.' && text[end + 1] === '[') { end += 1; continue; }
        break;
      }
      if (segs.length > 0) {
        const raw = text.slice(from, end);
        const hit = refKinds?.get(raw);
        if (segs.length >= 2) {
          const prefix = REPORT_PREFIX_TAIL.exec(text.slice(0, from));
          const tableSeg = segs[segs.length - 2];
          const last = segs[segs.length - 1];
          out.push({
            from: prefix ? from - prefix[0].length : from,
            to: tableSeg.to,
            kind: 'ref-table',
            table: text.slice(segs[0].from + 1, tableSeg.to - 1),
            report: !!prefix
          });
          out.push({
            from: last.from,
            to: end,
            kind: prefix ? 'ref-report' : hit === 'source' ? 'ref-source' : hit === 'var' ? 'ref-var' : 'ref'
          });
        } else {
          // 单段 `[x]`：可能带 `暂存表.` 前缀（虚拟单表，只有列名这一段，没有独立 [表] 分段）——
          // 与 2+ 段的 `本报表.[表].[字段]` 同款「前缀并入 token」，产出 kind='ref-table' 供
          // splitBracketRefs 走同一条淡底胶囊渲染；staging=true 与 report 分开标记（见 staging
          // 字段注释），消费方据此跳过按表名查主题色（暂存表不是一张登记在来源里的普通表）。
          const stagingPrefix = STAGING_PREFIX_TAIL.exec(text.slice(0, from));
          if (stagingPrefix) {
            out.push({
              from: from - stagingPrefix[0].length,
              to: end,
              kind: 'ref-table',
              table: text.slice(segs[0].from + 1, segs[0].to - 1),
              staging: true
            });
          } else {
            out.push({ from, to: end, kind: hit === 'source' ? 'ref-source' : hit === 'var' ? 'ref-var' : 'ref' });
          }
        }
        i = end;
        continue;
      }
      i += 1;
      continue;
    }

    // ③ 数字（含小数）。前置字符是标识符的一部分时不算——那是 `a1` 这类标识符的尾巴。
    if (ch >= '0' && ch <= '9' && !(i > 0 && IDENT_PART.test(text[i - 1]))) {
      const from = i;
      while (i < n && ((text[i] >= '0' && text[i] <= '9') || text[i] === '.')) i += 1;
      out.push({ from, to: i, kind: 'number' });
      continue;
    }

    // ④ 标识符：紧跟 `(` 的是函数名，否则看是不是关键字。
    if (IDENT_START.test(ch)) {
      const from = i;
      while (i < n && IDENT_PART.test(text[i])) i += 1;
      const word = text.slice(from, i);
      let j = i;
      while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1;
      if (text[j] === '(') out.push({ from, to: i, kind: 'func' });
      else if (KEYWORDS.has(word.toUpperCase())) out.push({ from, to: i, kind: 'keyword' });
      continue;
    }

    i += 1;
  }
  return out;
}

/**
 * 从服务端 refs 构造 label → kind 的匹配表。
 *
 * refs 里的标签形态可能是 `[t1].[物料编码]`（别名）而编辑器里显示的是 `[入库流水].[物料编码]`
 * （表名）——两者不一定字面相等。故这里**同时登记整段与末段**：末段（字段名那一节）在两种
 * 形态下是一致的，能兜住绝大多数情形；仍匹配不上就退回通用引用色，不猜。
 */
export function buildRefKindMap(
  refs: Array<{ kind?: string; last_label?: string; label?: string }> | undefined
): Map<string, 'source' | 'var'> {
  const map = new Map<string, 'source' | 'var'>();
  for (const ref of refs ?? []) {
    const kind: 'source' | 'var' = ref.kind === 'system_var' ? 'var' : 'source';
    for (const label of [ref.last_label, ref.label]) {
      const raw = (label ?? '').trim();
      if (!raw) continue;
      map.set(raw, kind);
      const lastSeg = raw.lastIndexOf('.[');
      if (lastSeg > 0) map.set(raw.slice(lastSeg + 1), kind);
    }
  }
  return map;
}
