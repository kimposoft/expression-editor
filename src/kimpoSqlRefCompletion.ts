/**
 * kimpoSqlRefCompletion —— 表达式编辑区「字段 / 本报表 / 系统变量」补全的**纯逻辑**。
 *
 * 与 kimpoSqlCompletion.ts（函数补全）同款分层：CodeMirror 相关的部分留在 ExpressionSqlEditor.vue，候选集、
 * 触发判定、筛选都在这里，用纯函数钉判据。
 *
 * ── 候选集口径（唯一一条硬约束）────────────────────────────────────────────
 * 候选片段 **必须与 ⊞ 拾取 / ƒ 字段树点选同一份口径产出**（bracketText.valueRefToBracketText），不能在
 * 这里第三次手写 `[表].[字段]` 的拼法——显式来源 `[来源(N)].[字段]`、本报表 `本报表.[表].[字段]`、
 * 系统变量 `系统变量.xxx`，三者各自只有一种服务端认可的写法，写法漂移一次就是一批「找不到」诊断。
 * braces（3.4）语法下候选是 `{可读标签}`，同样复用 labelOfTextRef。
 *
 * ── 触发形态 ──────────────────────────────────────────────────────────────
 *   token 模式：`[xx`（方括号起头）或标识符前缀（含 CJK，如 `数量`、`当前`）⇒ 整段插入候选片段；
 *              前面紧邻 `本报表.` 时只列本报表候选，且替换区间从 `本报表` 起（否则会落成 `本报表.本报表.[…]`）；
 *              紧邻 `暂存表.` 时同款只列暂存列候选（暂存表是虚拟单表，没有 field 模式的 `[表].[xx` 形态，
 *              只在 token 模式收口）。
 *   field 模式：`[表].[xx` / `本报表.[表].[xx` ⇒ 只补该表的字段，插入 `[字段]` 接在尾部。
 *   引号铁律：光标在字符串字面量内不弹（同函数补全）。
 */
import type { FormTableLite, SourceTableLite } from './rawSerialize';
import { instanceSuffix, isReportContextAlias } from './rawSerialize';
import type { SystemVariableDef } from './useExpressionContext';
import { valueRefToBracketText, type BracketTextOptions } from './bracketText';
import { labelOfTextRef } from './textSource';
import { COMPLETION_IDENT, insideStringLiteral } from './kimpoSqlCompletion';
import type { ValueRef } from './types';

/** 一条引用候选。 */
export interface ReferenceCandidate {
  // 'staging'：暂存来源（Phase B 动作暂存区）列候选，与显式来源分开一枚 kind——服务端只认保留
  // 前缀写法 `暂存表.[列]`（bracketText.stagingBracketToken），不能落进 'source' 那套 `[名].[列]`
  // 拼法；分开 kind 也让 `暂存表.` 前缀触发时能只筛出这一组（referenceCompletionContext.stagingOnly）。
  kind: 'source' | 'report' | 'var' | 'staging';
  /** 落进文本的片段（与 ⊞/ƒ 拾取同一份口径）。 */
  snip: string;
  /** 列表主文案：字段名 / 变量名。 */
  label: string;
  /** 列表右侧：所属表（「来源 · 入库流水」/「本报表 · 采购明细」）或「系统变量」。 */
  detail: string;
  /** 匹配用：该字段所属表在文本里的写法（来源别名(N) / 本报表表名）；系统变量为空串。 */
  table: string;
}

/** 分组文案（由调用方按语言包传入，本模块不碰 i18n）。 */
export interface ReferenceGroupLabels {
  source: string;
  report: string;
  variable: string;
}

const MID_DOT = ' · ';

/**
 * 产出候选集：显式来源各字段 + 本报表各表字段 + 系统变量。
 * 产不出片段（形态不受支持、目录缺项）的条目直接跳过——宁可少一条候选，也不给出服务端不认的写法。
 */
export function buildReferenceCandidates(
  syntax: 'braces' | 'brackets',
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[],
  labels: ReferenceGroupLabels,
  opts: BracketTextOptions = {}
): ReferenceCandidate[] {
  const out: ReferenceCandidate[] = [];
  const snipOf = (ref: ValueRef): string | undefined => {
    if (syntax === 'brackets') return valueRefToBracketText(ref, sources, forms, systemVars, opts);
    const label = labelOfTextRef(ref, sources, forms, systemVars);
    return label ? `{${label}}` : undefined;
  };
  for (const source of sources) {
    // 本报表上下文表：bt* 不在 sources 里（编辑器把它们放 forms）；V4 往返回来的 rpt-* 会混在
    // sources 里（见 rawSerialize.isReportContextAlias），forms 段已按本报表形态给出候选，这里跳过，
    // 否则会多一组把它当显式来源的 `[表].[字段]` 候选。
    if (isReportContextAlias(source.alias)) continue;
    // Phase B 暂存来源（dataTableId==='__staging__'）：候选独立一组（kind='staging'），不落进下面
    // 的显式来源分支——那会按 source.name（拓扑 producerLabel，不是可寻址表名）拼出服务端解析不到
    // 的 `[产出名].[列]`，与 bracketText.valueRefToBracketText 的同一处理保持一致。detail 沿用
    // 「来源」分组文案展示（最小改动，不新增分组 i18n key），table 留空——暂存表没有 field 模式。
    if (source.dataTableId === '__staging__') {
      for (const field of source.fields ?? []) {
        const snip = snipOf({ kind: 'source_field', alias: source.alias, field_id: field.field_id });
        if (snip) out.push({ kind: 'staging', snip, label: field.field_name, detail: `${labels.source}${MID_DOT}${source.name}`, table: '' });
      }
      continue;
    }
    const table = `${source.name}${instanceSuffix(source.alias, source.dataTableId, sources)}`;
    for (const field of source.fields ?? []) {
      const snip = snipOf({ kind: 'source_field', alias: source.alias, field_id: field.field_id });
      if (snip) out.push({ kind: 'source', snip, label: field.field_name, detail: `${labels.source}${MID_DOT}${table}`, table });
    }
  }
  for (const form of forms) {
    const table = form.table.table_name;
    for (const field of form.fields ?? []) {
      const snip = snipOf({ kind: 'source_field', alias: form.alias, field_id: field.field_id });
      if (snip) out.push({ kind: 'report', snip, label: field.field_name, detail: `${labels.report}${MID_DOT}${table}`, table });
    }
  }
  for (const sv of systemVars) {
    const snip = snipOf({ kind: 'system_var', var_id: sv.var_id });
    if (snip) out.push({ kind: 'var', snip, label: sv.label, detail: labels.variable, table: '' });
  }
  return out;
}

/** 补全触发上下文（按光标前文本判定）。from 是替换区间起点（UTF-16 下标）。
 *  stagingOnly 与 reportOnly 同款（紧邻 `暂存表.` 时只列暂存列候选），可选——非暂存前缀时干脆不带
 *  这个键（而不是恒 false），避免所有既有 reportOnly 判据的 toEqual 断言因多一个键而炸。 */
export type ReferenceCompletionContext =
  | { mode: 'token'; from: number; typed: string; reportOnly: boolean; stagingOnly?: boolean }
  | { mode: 'field'; from: number; typed: string; table: string; report: boolean };

const REPORT_PREFIX_TAIL = /本报表\s*\.\s*$/;
/** 暂存来源保留前缀（`暂存表.[列]`，与 bracketText.STAGING_TEXT_PREFIX 同一写法）。只在 token 模式生效——
 *  暂存表是虚拟单表，没有 field 模式的 `[表].[xx` 二段形态。 */
const STAGING_PREFIX_TAIL = /暂存表\s*\.\s*$/;
const FIELD_TAIL = /(本报表\s*\.\s*)?\[([^\]]+)\]\s*\.\s*\[([^\]]*)$/;
const BRACKET_TAIL = /\[([^\]]*)$/;
const IDENT_TAIL = new RegExp(`${COMPLETION_IDENT.source}$`);

/** token 模式的保留前缀判定：`本报表.`/`暂存表.` 谁先命中用谁，二者互斥。返回调整后的 from 与
 *  reportOnly/stagingOnly——两个 token 触发分支（方括号起头 / 标识符前缀）共用同一份判据，抽出来
 *  避免两处各写一遍容易漂移。 */
function reservedPrefixBefore(before: string, from: number): { from: number; reportOnly: boolean; stagingOnly: boolean } {
  const report = REPORT_PREFIX_TAIL.exec(before.slice(0, from));
  if (report) return { from: report.index, reportOnly: true, stagingOnly: false };
  const staging = STAGING_PREFIX_TAIL.exec(before.slice(0, from));
  if (staging) return { from: staging.index, reportOnly: false, stagingOnly: true };
  return { from, reportOnly: false, stagingOnly: false };
}

/**
 * 判定当前应弹哪种引用补全；不该弹返回 null。
 * explicit=true（Ctrl+Space 显式唤起）时允许空前缀列全量；否则标识符模式要求至少打了一个字符
 * （方括号模式打了 `[` 本身就是明确意图，允许空前缀）。
 */
export function referenceCompletionContext(before: string, explicit = false): ReferenceCompletionContext | null {
  if (insideStringLiteral(before)) return null;
  const field = FIELD_TAIL.exec(before);
  if (field) {
    const from = before.length - (field[3]?.length ?? 0) - 1; // 最后一个 `[` 的下标
    return { mode: 'field', from, typed: field[3] ?? '', table: field[2], report: !!field[1] };
  }
  const bracket = BRACKET_TAIL.exec(before);
  if (bracket) {
    const { from, reportOnly, stagingOnly } = reservedPrefixBefore(before, bracket.index);
    return stagingOnly
      ? { mode: 'token', from, typed: bracket[1] ?? '', reportOnly, stagingOnly }
      : { mode: 'token', from, typed: bracket[1] ?? '', reportOnly };
  }
  const ident = IDENT_TAIL.exec(before);
  if (ident) {
    const { from, reportOnly, stagingOnly } = reservedPrefixBefore(before, ident.index);
    return stagingOnly
      ? { mode: 'token', from, typed: ident[0], reportOnly, stagingOnly }
      : { mode: 'token', from, typed: ident[0], reportOnly };
  }
  return explicit ? { mode: 'token', from: before.length, typed: '', reportOnly: false } : null;
}

/** 一条可落选项：插入片段 + 替换起点。 */
export interface ReferenceCompletionOption {
  candidate: ReferenceCandidate;
  /** 实际插入的文本：token 模式=完整片段；field 模式=`[字段]`。 */
  insert: string;
  from: number;
}

/**
 * 按触发上下文筛候选。匹配大小写不敏感、**子串**命中（字段名多为中文，前缀匹配没有意义）：
 * token 模式看字段名 / 表名 / 片段全文（`本报` 能命中本报表候选、`入库` 能命中来源表）；
 * field 模式只看该表的字段名，且表的种类必须对上（`[表].[` 只补来源，`本报表.[表].[` 只补本报表）。
 */
export function matchReferenceCandidates(
  ctx: ReferenceCompletionContext,
  candidates: readonly ReferenceCandidate[]
): ReferenceCompletionOption[] {
  const needle = ctx.typed.trim().toLowerCase();
  const out: ReferenceCompletionOption[] = [];
  if (ctx.mode === 'field') {
    for (const c of candidates) {
      if (c.kind === 'var' || c.table !== ctx.table) continue;
      if (ctx.report ? c.kind !== 'report' : c.kind !== 'source') continue;
      if (needle && !c.label.toLowerCase().includes(needle)) continue;
      out.push({ candidate: c, insert: `[${c.label}]`, from: ctx.from });
    }
    return out;
  }
  for (const c of candidates) {
    if (ctx.reportOnly && c.kind !== 'report') continue;
    if (ctx.stagingOnly && c.kind !== 'staging') continue;
    if (
      needle &&
      !c.label.toLowerCase().includes(needle) &&
      !c.table.toLowerCase().includes(needle) &&
      !c.snip.toLowerCase().includes(needle)
    )
      continue;
    out.push({ candidate: c, insert: c.snip, from: ctx.from });
  }
  return out;
}
