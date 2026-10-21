/**
 * 来源表主题色（2026-09-02 样式草案）：色值定义见 ./table-theme-colors.css（唯一定义处），
 * 本文件负责两件纯计算的事：
 *   1. tableColorClass / tokenTableClass：显式来源别名 t1/t2/… → ttc-N 色类（确定性、跨面一致——
 *      四个消费面各自只拿得到别名，按别名序号取色即天然同色，无需在组件间传递色表）；
 *   2. splitLabeledTextSegments：把文本表达式（raw / sidecar 原文）按 {…} 字段标记切成可逐段
 *      着色的 token 片段——原先整段一个 raw token，无法在"编写的表达式"里体现表主题色。
 *
 * 本报表 bt* 与解析不到的别名恒返回空串（不占主题色，沿用既有语义色/中性灰圆点）。
 */
import './table-theme-colors.css';
import type { ValueRef } from './types';
import { instanceSuffix, isReportContextAlias, type FormTableLite, type SourceTableLite } from './rawSerialize';
import type { SystemVariableDef } from './useExpressionContext';
import { resolveTextLabel } from './textSource';
import { scanKimpoSql } from './kimpoSqlHighlight';

/** 色板容量，与 table-theme-colors.css 的 .ttc-0～.ttc-7 一一对应。 */
export const TABLE_THEME_COLOR_COUNT = 8;

/** 显式来源别名（t1/t2/…，见 ExpressionEditor 的来源别名分配）——bt* 本报表别名不匹配。 */
const SOURCE_ALIAS_RE = /^t(\d+)$/;

/** 别名 → 色类：t1→ttc-0、t2→ttc-1…按色板容量循环；非显式来源别名（bt 前缀 / 空 / 未识别）→ 空串。 */
export function tableColorClass(alias?: string | null): string {
  const m = SOURCE_ALIAS_RE.exec((alias ?? '').trim());
  if (!m) return '';
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return '';
  return `ttc-${(n - 1) % TABLE_THEME_COLOR_COUNT}`;
}

/** token 消费形态：色类 + ttc-themed（tint 开关类，见 table-theme-colors.css 的 .tok.ttc-themed）。 */
export function tokenTableClass(alias?: string | null): string {
  const c = tableColorClass(alias);
  return c ? `ttc-themed ${c}` : '';
}

/** 只需别名的来源表最小形状（四个面手上的 SourceTableLite / DisplayTable / FlatGroup 都满足）。 */
export interface AliasOrdered {
  alias: string;
}

/**
 * 表主题色序号：
 *   - 别名 tN → (N-1) % 8（3.4 既有规则，不变）；
 *   - 其余显式来源（V4 的 cat-… / stg-… 等）→ 按其在 sources 里非上下文来源的出现顺序 % 8；
 *   - 本报表上下文别名（bt… / rpt-…）、空、查不到 → -1（不占主题色，沿用既有绿色/中性灰语义）。
 * 动作设计器详情弹层按同一口径（query.sources 里非本报表来源的顺序）取色，两面同色。
 */
export function tableColorIndex(alias: string | null | undefined, sources: ReadonlyArray<AliasOrdered> = []): number {
  const a = (alias ?? '').trim();
  if (!a) return -1;
  const m = SOURCE_ALIAS_RE.exec(a);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 1 ? (n - 1) % TABLE_THEME_COLOR_COUNT : -1;
  }
  if (isReportContextAlias(a)) return -1;
  const ordered = sources.filter(s => !isReportContextAlias(s.alias));
  const idx = ordered.findIndex(s => s.alias === a);
  return idx >= 0 ? idx % TABLE_THEME_COLOR_COUNT : -1;
}

/** 本报表独立色类（table-theme-colors.css .ttc-report）：本报表引用整条、本报表各表的圆点 / 表 chip 都用它。 */
export const REPORT_TABLE_CLASS = 'ttc-report';

/** 别名 + 来源顺序 → ttc 色类（规则见 tableColorIndex）；本报表上下文别名（bt… / rpt-…）→ 本报表独立色；
 *  其余无色返回空串。 */
export function tableColorClassFor(alias: string | null | undefined, sources: ReadonlyArray<AliasOrdered> = []): string {
  if (isReportContextAlias((alias ?? '').trim())) return REPORT_TABLE_CLASS;
  const i = tableColorIndex(alias, sources);
  return i >= 0 ? `ttc-${i}` : '';
}

/** token 消费形态（tint）+ 来源顺序回退。braces（3.4）`{…}` token 路径用：本报表字段沿用既有 form_field 绿、
 *  不走本报表独立色（3.4 语义不动，独立色只用于 brackets 引用与各面圆点）。 */
export function tokenTableClassFor(alias: string | null | undefined, sources: ReadonlyArray<AliasOrdered> = []): string {
  if (isReportContextAlias((alias ?? '').trim())) return '';
  const c = tableColorClassFor(alias, sources);
  return c ? `ttc-themed ${c}` : '';
}

/**
 * 显式来源在文本里的写法（`表名` / 同表多实例 `表名(2)`，与 kimpoSqlRefCompletion.buildReferenceCandidates
 * 的 table 字段、bracketText 的插入片段同一口径）→ ttc 色类。查不到返回空串。
 */
export function tableColorClassByLabel(label: string, sources: SourceTableLite[]): string {
  const want = label.trim();
  for (const s of sources) {
    if (isReportContextAlias(s.alias)) continue;
    if (`${s.name}${instanceSuffix(s.alias, s.dataTableId, sources)}` === want) return tableColorClassFor(s.alias, sources);
  }
  return '';
}

/** 整条方括号引用内的部件：table=表名（加粗）、field=字段名、punc=括号 / 点号 / `本报表.` 前缀（压暗）。 */
export interface LabeledTextSegPart {
  text: string;
  role: 'table' | 'field' | 'punc';
}

/** 文本切段产物：kind 沿用 token-colors.css 的语义类名口径，tableClass 为空串时按原语义色渲染。
 *  brackets（V4）语法的整条引用 `[表].[字段]` / `本报表.[表].[字段]` 是一段（kind=source_field / form_field，
 *  tableClass=ttc-themed ttc-N / ttc-report 给淡底 + 表色文字），parts 给出表名 / 字段 / 标点三种部件供逐段渲染。 */
export interface LabeledTextSeg {
  text: string;
  kind: 'raw' | 'source_field' | 'form_field' | 'system_var';
  tableClass: string;
  parts?: LabeledTextSegPart[];
}

/** 把整条引用文本（`本报表.[表].[字段]` / `[表].[字段]`）拆成 parts：前缀与括号点号为 punc，表名 table，字段 field。 */
export function bracketRefParts(text: string): LabeledTextSegPart[] {
  const parts: LabeledTextSegPart[] = [];
  const first = text.indexOf('[');
  if (first < 0) return [{ text, role: 'field' }];
  if (first > 0) parts.push({ text: text.slice(0, first), role: 'punc' });
  const last = text.lastIndexOf('[');
  if (last === first) {
    // 单段 `[x]`
    parts.push({ text: '[', role: 'punc' }, { text: text.slice(first + 1, text.length - 1), role: 'field' }, { text: ']', role: 'punc' });
    return parts;
  }
  const tableClose = text.lastIndexOf(']', last);
  parts.push({ text: '[', role: 'punc' });
  parts.push({ text: text.slice(first + 1, tableClose), role: 'table' });
  parts.push({ text: text.slice(tableClose, last + 1), role: 'punc' }); // `].[`（含点号周围空白）
  parts.push({ text: text.slice(last + 1, text.length - 1), role: 'field' });
  parts.push({ text: ']', role: 'punc' });
  return parts;
}

/**
 * brackets（V4）语法的方括号引用切段（方案 A 淡底胶囊）：`[表].[字段]` 整条一段 source_field，tableClass=
 * `ttc-themed ttc-N`（淡底 + 表色文字，表名 / 字段 / 标点见 parts）；`本报表.[表].[字段]` 整条一段 form_field，
 * tableClass=`ttc-themed ttc-report`（本报表独立蓝）；来源里查不到的表整条无色（tableClass 空，按 source_field
 * 既有蓝渲染）；单段 `[x]` 命中系统变量目录时 → system_var，否则连同方括号按 raw 保留。字符串字面量内的方括号
 * 不是引用（复用 scanKimpoSql 的引号铁律）。没有 `[` 的文本原样一段 raw。
 */
function splitBracketRefs(text: string, sources: SourceTableLite[], systemVars: SystemVariableDef[]): LabeledTextSeg[] {
  if (!text.includes('[')) return [{ text, kind: 'raw', tableClass: '' }];
  const out: LabeledTextSeg[] = [];
  const toks = scanKimpoSql(text);
  let cursor = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const tok = toks[i];
    if (tok.kind === 'ref-table') {
      const field = toks[i + 1];
      const hasField = !!field && field.from >= tok.to && (field.kind === 'ref' || field.kind === 'ref-source' || field.kind === 'ref-var' || field.kind === 'ref-report');
      const end = hasField ? field.to : tok.to;
      if (tok.from > cursor) out.push({ text: text.slice(cursor, tok.from), kind: 'raw', tableClass: '' });
      const whole = text.slice(tok.from, end);
      // 暂存来源（tok.staging）与本报表同款独立着色角色（REPORT_TABLE_CLASS）——但不能像显式来源
      // 那样按 tok.table（此时是列名，不是表名）去 tableColorClassByLabel 查主题色，会查不到或
      // 误撞同名来源表；见 kimpoSqlHighlight.HighlightToken.staging 字段注释。
      const cls = tok.report || tok.staging ? REPORT_TABLE_CLASS : tableColorClassByLabel(tok.table ?? '', sources);
      out.push({
        text: whole,
        kind: tok.report || tok.staging ? 'form_field' : 'source_field',
        tableClass: cls ? `ttc-themed ${cls}` : '',
        parts: bracketRefParts(whole)
      });
      cursor = end;
      if (hasField) i += 1;
      continue;
    }
    if (tok.kind === 'ref' || tok.kind === 'ref-source' || tok.kind === 'ref-var' || tok.kind === 'ref-report') {
      const body = text.slice(tok.from + 1, tok.to - 1).trim();
      if (systemVars.some(v => v.label === body)) {
        if (tok.from > cursor) out.push({ text: text.slice(cursor, tok.from), kind: 'raw', tableClass: '' });
        out.push({ text: text.slice(tok.from, tok.to), kind: 'system_var', tableClass: '' });
        cursor = tok.to;
      }
    }
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), kind: 'raw', tableClass: '' });
  return out;
}

/** 与 rawSerialize.ts / textSource.ts 的 FIELD_TOKEN 同一口径：花括号内不再嵌套花括号。 */
const FIELD_TOKEN = /\{([^{}]*)\}/g;

/**
 * 把文本表达式按 {…} 标记切成逐段 token：
 *   - 标记解析成来源字段（alias=t*）→ kind='source_field' + 表主题色类；
 *   - 解析成本报表字段（alias=bt* / form_field）→ kind='form_field'（既有绿色，不占主题色）；
 *   - 解析成系统变量 → kind='system_var'；
 *   - 解析不到 → 连同花括号按 'raw' 保留（不臆造归属）；
 *   - 标记之间的普通文本（运算符/常量/函数名）→ 'raw'。
 * 解析判据复用 resolveTextLabel（与 lower-text 请求侧同一份），不另发明一套。
 */
export function splitLabeledTextSegments(
  text: string,
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[]
): LabeledTextSeg[] {
  const segs: LabeledTextSeg[] = [];
  let cursor = 0;
  FIELD_TOKEN.lastIndex = 0;
  for (let m = FIELD_TOKEN.exec(text); m; m = FIELD_TOKEN.exec(text)) {
    if (m.index > cursor) segs.push({ text: text.slice(cursor, m.index), kind: 'raw', tableClass: '' });
    const ref: ValueRef | null = resolveTextLabel(m[1], sources, forms, systemVars);
    if (ref?.kind === 'source_field') {
      const themed = tokenTableClassFor(ref.alias, sources);
      // alias=bt* 的 source_field 是本报表字段的既有编码形态（读取端按前缀分流），按 form_field 色渲染。
      segs.push({ text: m[0], kind: themed ? 'source_field' : 'form_field', tableClass: themed });
    } else if (ref?.kind === 'form_field') {
      segs.push({ text: m[0], kind: 'form_field', tableClass: '' });
    } else if (ref?.kind === 'system_var') {
      segs.push({ text: m[0], kind: 'system_var', tableClass: '' });
    } else {
      segs.push({ text: m[0], kind: 'raw', tableClass: '' });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor), kind: 'raw', tableClass: '' });
  // brackets（V4）语法：raw 段里的 `[表].[字段]` 再切成表段 + 字段段（braces 文本没有方括号引用，原样过）。
  return segs.flatMap(seg => (seg.kind === 'raw' ? splitBracketRefs(seg.text, sources, systemVars) : [seg]));
}
