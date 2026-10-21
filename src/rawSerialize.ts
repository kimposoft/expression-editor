import type { ValueRef } from './types';
import type { TemplateField } from './types';
import { tableRoleOf } from './types';
import type { SystemVariableDef, TableFields } from './useExpressionContext';
import { textFunctionAliasOf, type TextPackLang } from './functionCatalog';

/**
 * 文本表达式的「可读字段标记 ⇄ 稳定字段引用」转换。
 *
 * 文本里字段写成 {…}（花括号便于正则识别），标记内文案仅供人读，具体格式按来源分流：
 * - 本报表主表 → {裸字段名}（无前缀）；本报表明细/扩展表 → {表 · 字段}（见 reportFieldLabel）；
 *
 * 文本 → 结构由服务端负责；结构 → 文本（serializeToText）只在「无 text_source 的结构节点第一次进
 * 文本模式」时用，是 best-effort：字段/常量/算术/已知函数别名能反写，CASE/开窗等写不出来得空串。
 */

/** 编辑器持有的来源表（含别名）。 */
export interface SourceTableLite {
  alias: string;
  dataTableId: string;
  name: string;
  fields: TemplateField[];
}
export type FormTableLite = TableFields & { alias?: string };

const FIELD_TOKEN = /\{([^{}]*)\}/g;
export const REPORT_PREFIX = '本报表.';
export const STAGING_PREFIX = '暂存表.';

/**
 * 本报表上下文表的**别名**判定。上下文表在模型里有两种别名身份：
 *   - `bt<i>`：3.4 编辑器自己按 ctx.tableFields 下标物化（ExpressionEditor.reportAlias）；
 *   - `rpt-<table_id>-<6hex>`：V4 文档往返回来的（v4/expressionModelAdapter sourceBindingToTable 用
 *     instance_id 当别名，见该文件 reportInstanceId）。
 * 凡按别名判「是否上下文表」的地方两种都要认。此前只认 bt*：取数配置面把同一张表既当本报表又当
 * 「历史数据」目录来源时，往返后的 rpt-* 上下文表被 instanceSuffix 当成同表的第二个显式实例，
 * 字段树/插入文本给目录来源凭空追加 (1)，而适配层 catalogSourceAlias 登记的别名没有后缀，服务端
 * 报「找不到来源实例 表(1)」、设计无法保存。
 */
export const REPORT_INSTANCE_ALIAS_PREFIX = 'rpt-';
export function isReportContextAlias(alias: string | undefined): boolean {
  return !!alias && (alias.startsWith('bt') || alias.startsWith(REPORT_INSTANCE_ALIAS_PREFIX));
}
const MID_DOT = '·';

function fieldName(fields: TemplateField[], fieldId?: string): string {
  return fields.find(f => f.field_id === fieldId)?.field_name ?? fieldId ?? '';
}

/**
 * 同一数据表被多次加入时的实例序号后缀「(N)」；唯一则空。labelOfRef 与 resolveLabel 须用同一 sources 排序保持一致。
 * **只统计显式来源(非 bt* 与 rpt-* 上下文表，判据 isReportContextAlias)**：显式来源与「本报表上下文」是两个独立概念——前者走「数据表(N).字段」、
 * 后者走 reportFieldLabel，不共享编号命名空间（否则显式表会被上下文表干扰
 * 编号、并致名↔ID 解析失败）；本报表各表天然不重复（一表一别名），故不需要、也没有 (N) 序号。
 */
export function instanceSuffix(alias: string | undefined, dataTableId: string, sources: SourceTableLite[]): string {
  const same = sources.filter(s => s.dataTableId === dataTableId && !isReportContextAlias(s.alias));
  if (same.length <= 1) return '';
  const idx = same.findIndex(s => s.alias === alias) + 1;
  return idx > 0 ? `(${idx})` : '';
}

function reportFieldLabel(alias: string | undefined, tableName: string, fieldLabel: string, forms: FormTableLite[]): string {
  const ft = forms.find(f => f.alias === alias);
  const isMain = !!ft && tableRoleOf(ft.table, forms.map(f => f.table)) === 'main';
  return isMain ? fieldLabel : `${tableName} ${MID_DOT} ${fieldLabel}`;
}

/**
 * 由字段引用算出可读标签（不含花括号）。
 * bt* 别名=本报表上下文表 → reportFieldLabel；
 * 显式来源（跨模板/数据源）→ 沿用既有 `数据表(N).字段` 格式（同表多实例追加 (N)）——规格另要求
 * 跨模板改用 `模板名 · 字段` 并配青绿色，本轮未做（需新增模板名传参 + 新增色板类目，详见任务汇报）。
 */
export function labelOfRef(ref: ValueRef, sources: SourceTableLite[], forms: FormTableLite[]): string {
  if (ref.kind === 'form_field') {
    const ft = forms.find(t => t.table.data_table_id === ref.table_id);
    if (ft) return `${REPORT_PREFIX}${ft.table.table_name}.${fieldName(ft.fields, ref.field_id)}`;
    return ref.field_id ?? '';
  }
  if (ref.kind === 'source_field') {
    const st = sources.find(t => t.alias === ref.alias);
    if (st) {
      const fname = fieldName(st.fields, ref.field_id);
      if (isReportContextAlias(ref.alias)) return reportFieldLabel(ref.alias, st.name, fname, forms);
      return `${st.name}${instanceSuffix(ref.alias, st.dataTableId, sources)}.${fname}`;
    }
    const ft = forms.find(t => t.alias === ref.alias);
    if (ft) return reportFieldLabel(ref.alias, ft.table.table_name, fieldName(ft.fields, ref.field_id), forms);
    return ref.field_id ?? '';
  }
  return '';
}

/** 解析单个标签（不含花括号）→ 字段引用；解析不到返回 null。 */
export function resolveLabel(label: string, sources: SourceTableLite[], forms: FormTableLite[]): ValueRef | null {
  const raw = label.trim();
  if (raw.startsWith(REPORT_PREFIX)) {
    // 旧格式反解：目前仍由 form_field kind 分支产出（本轮未动该分支），故保留。
    const rest = raw.slice(REPORT_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot < 0) return null;
    const tableName = rest.slice(0, dot);
    const fName = rest.slice(dot + 1);
    const ft = forms.find(t => t.table.table_name === tableName);
    const fld = ft?.fields.find(f => f.field_name === fName);
    if (ft && fld && ft.alias) return { kind: 'source_field', alias: ft.alias, field_id: fld.field_id };
    return null;
  }
  const midDotIdx = raw.indexOf(MID_DOT);
  if (midDotIdx >= 0) {
    const tableName = raw.slice(0, midDotIdx).trim();
    const fName = raw.slice(midDotIdx + MID_DOT.length).trim();
    const ft = forms.find(t => t.table.table_name === tableName);
    const fld = ft?.fields.find(f => f.field_name === fName);
    if (ft && fld && ft.alias) return { kind: 'source_field', alias: ft.alias, field_id: fld.field_id };
    return null;
  }
  const dot = raw.indexOf('.');
  if (dot < 0) {
    const mainForm = forms.find(f => tableRoleOf(f.table, forms.map(x => x.table)) === 'main');
    const fld = mainForm?.fields.find(f => f.field_name === raw);
    if (mainForm && fld && mainForm.alias) return { kind: 'source_field', alias: mainForm.alias, field_id: fld.field_id };
    return null;
  }
  let tableName = raw.slice(0, dot);
  const fName = raw.slice(dot + 1);
  // 解析同表多实例后缀「(N)」→ 选第 N 个同名来源。
  let instance = 1;
  const m = tableName.match(/^(.*)\((\d+)\)$/);
  if (m) {
    tableName = m[1];
    instance = parseInt(m[2], 10);
  }
  // 非「本报表.」前缀 → 只匹配显式来源（排除 bt* 上下文表，与 instanceSuffix 命名空间一致）。
  const sameName = sources.filter(t => t.name === tableName && !t.alias?.startsWith('bt'));
  const st = sameName[instance - 1] ?? sameName[0];
  const fld = st?.fields.find(f => f.field_name === fName);
  if (st && fld) return { kind: 'source_field', alias: st.alias, field_id: fld.field_id };
  return null;
}

/** 解析整段文本里所有 {…} 标记（按序）→ refs；附未解析标签列表（供 UI 拦截）。 */
export function parseTextRefs(
  text: string,
  sources: SourceTableLite[],
  forms: FormTableLite[]
): { refs: ValueRef[]; unresolved: string[] } {
  const refs: ValueRef[] = [];
  const unresolved: string[] = [];
  for (const m of text.matchAll(FIELD_TOKEN)) {
    const ref = resolveLabel(m[1], sources, forms);
    if (ref) refs.push(ref);
    else unresolved.push(m[1]);
  }
  return { refs, unresolved };
}

/** 把按序出现的 {…} 标签按 refs 重写为当前字段名（rename 同步刷新）。 */
export function relabelText(text: string, refs: ValueRef[], sources: SourceTableLite[], forms: FormTableLite[]): string {
  let i = 0;
  return text.replace(FIELD_TOKEN, () => {
    const ref = refs[i++];
    return ref ? `{${labelOfRef(ref, sources, forms)}}` : '{?}';
  });
}

/** serializeToText 的可选口径：文本模式别名语言包 + 系统变量目录。不传时沿用改造前行为
 *  （函数名大写、系统变量写 @var_id）——那只对只读展示历史 raw 节点有意义，进文本模式的调用方必须传。 */
export interface SerializeTextOptions {
  /** 函数别名语言包（zh→合计(、en→SUM(），见 functionCatalog.textPackLangOf。 */
  lang?: TextPackLang;
  /** 系统变量目录：有它时系统变量写成 {当前日期} 花括号形态（lower-text 按 refs 绑定），否则退回 @var_id。 */
  systemVars?: SystemVariableDef[];
}

/** 结构化值 → 文本（无 text_source 的结构节点第一次进文本模式）。字段→{标签}，算术/函数/常量原样写出；
 *  带 text_source 的节点请走 textSource.ts restoreTextFromSource（原文优先，不从结构反推）。 */
export function serializeToText(
  v: ValueRef | null | undefined,
  sources: SourceTableLite[],
  forms: FormTableLite[],
  opts: SerializeTextOptions = {}
): string {
  if (!v) return '';
  if (v.kind === 'raw') return relabelText(v.text ?? '', v.refs ?? [], sources, forms);
  return serialize(v, sources, forms, opts);
}

function serialize(v: ValueRef, sources: SourceTableLite[], forms: FormTableLite[], opts: SerializeTextOptions): string {
  switch (v.kind) {
    case 'source_field':
    case 'form_field':
      return `{${labelOfRef(v, sources, forms)}}`;
    case 'system_var': {
      const sv = opts.systemVars?.find(x => x.var_id === v.var_id);
      return sv ? `{${sv.label}}` : `@${v.var_id}`;
    }
    case 'const': {
      const val = v.value;
      // 四动作口径：「不填充」= value 键缺省（undefined）必须反渲染成**空文本**——
      // 若落进下面的字符串分支会写成带引号的 ''，用户打开 ƒ 面板什么都不改点确定，就会沿
      // "非空文本 → 降级"路径落成 {kind:'const', value:''}（主动填空串），不填充悄悄变成清空字段。
      if (val === undefined) return '';
      // 空值常量（value===null）须显式写成裸 SQL 关键字 NULL——若落进下面的字符串分支，
      // `String(val ?? '')` 会把 null 折成 ''，导致切到自由文本模式后「空值」悄悄退化成
      // 空字符串常量（两种语义完全不同）。
      if (val === null) return 'NULL';
      if (typeof val === 'number' || typeof val === 'boolean') return String(val);
      return `'${String(val ?? '').replace(/'/g, "''")}'`;
    }
    case 'func': {
      const name = (v.name ?? '').toLowerCase();
      const args = (v.args ?? []).map(a => serialize(a, sources, forms, opts));
      const arith: Record<string, string> = { add: '+', sub: '-', mul: '*', div: '/' };
      if (arith[name]) return `(${args.join(` ${arith[name]} `)})`;
      const alias = opts.lang ? textFunctionAliasOf(name, opts.lang) : null;
      return `${alias ?? name.toUpperCase()}(${args.join(', ')})`;
    }
    default:
      return '';
  }
}
