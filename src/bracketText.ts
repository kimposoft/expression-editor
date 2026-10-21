/**
 * bracketText —— 把「点一下就落定」的结构化 ValueRef 写成 表达式引擎 V4 的 KimpoSQL 文本。
 *
 * 为什么需要这一层：
 * V4 取数文档里表达式的权威形态是**纯文本**（`source_text` + 服务端 tokenize 产出的 `refs`），
 * 没有结构化节点这一说。而 3.4 编辑器的若干「原子拾取」入口（输出行的 ⊞ 快捷选择、条件右值的
 * 字段/变量/空值选择）是直接产出结构化 ValueRef 的——它们在 V4 模式下走到适配层
 * （v4/expressionModelAdapter.ts valueRefToV4Expression）时翻不出文本，被压成 `source_text: ''`，
 * 服务端按「不能为空」整份拒绝，用户表现为**节点保存不了**。
 *
 * 修法不是给适配层补一个「结构化 → 文本」的完整打印器（3.4 模型即将随 W5 退役，为它写一份
 * 长期维护的双向翻译是浪费），而是**让 V4 路径一开始就不产生结构化**：拾取入口在 brackets
 * 语法下直接落文本（`{ kind:'raw', text }`），适配层退化为纯搬运，3.4 拆除时本文件与 raw
 * 占位一起消失。
 *
 * 与 AdvancedExpressionPanel（ƒ 表达式弹窗）的关系：那条路本来就是文本模式（CodeMirror +
 * insertAtCursor），字段树点选同样经本文件的 valueRefToBracketText 落文本——两处只有一份口径。
 *
 * 三种引用各有服务端认可的唯一写法：显式来源 `[来源别名].[字段]`、
 * 本报表 `本报表.[表].[字段]`（3 段保留前缀）、系统变量 `系统变量.当前时间`（语言包无引号点路径）。
 * 早先按 3.4 显示标签一刀切成 `[a].[b]` 的做法只对显式来源成立——本报表主表字段的标签是裸字段名、
 * 明细是 `表 · 字段`、系统变量是 `[标签]`，三者服务端全解析不到。
 */

import { REPORT_PREFIX, STAGING_PREFIX, instanceSuffix, type FormTableLite, type SourceTableLite, isReportContextAlias } from './rawSerialize';
import type { SystemVariableTokenResolver } from './host';
import type { SystemVariableDef } from './useExpressionContext';
import type { TemplateField, ValueRef } from './types';

/** 服务端 v4/bind 保留前缀：`本报表.[表].[字段]`。 */
export const REPORT_TEXT_PREFIX = '本报表';

/** 本报表字段的 V4 文本引用：`本报表.[表显示名].[字段显示名]`——与服务端 tokenize 的 LastLabel 同一格式。 */
export function reportBracketToken(tableName: string, fieldName: string): string {
  return `${REPORT_TEXT_PREFIX}.[${tableName}].[${fieldName}]`;
}

export const STAGING_TEXT_PREFIX = '暂存表';

/** 暂存列的 V4 文本引用：`暂存表.[列显示名]`——与服务端 tokenize 的 LastLabel 同一格式。 */
export function stagingBracketToken(fieldName: string): string {
  return `${STAGING_TEXT_PREFIX}.[${fieldName}]`;
}

/** 拾取落文本的可选口：系统变量文本标记解析（见 host.ts SystemVariableTokenResolver）。 */
export interface BracketTextOptions {
  systemVariableToken?: SystemVariableTokenResolver;
}

function fieldNameOf(fields: TemplateField[] | undefined, fieldId?: string): string {
  return fields?.find(f => f.field_id === fieldId)?.field_name ?? fieldId ?? '';
}

/**
 * 把一个可读标签写成 V4（brackets / WORKFINE 方言）的字段引用标记：`[表].[字段]`。
 *
 * 「本报表.」前缀在 V4 侧不存在（本报表各表在 V4 里就是普通来源、各有别名），故剥掉；
 * 其余按**最后一个**点拆成「表 . 字段」两段分别包方括号——标签本身含点号的极端情况据此切分，
 * 与 V4 目录里「别名不含点」的约定一致。
 */
export function bracketFieldToken(label: string): string {
  // 暂存来源与本报表不同：服务端只认保留前缀形态 `暂存表.[列]`，没有「暂存表也是普通来源」这一说
  // （对照 valueRefToBracketText 的 source_field 分支），故这里不是剥掉转普通表，而是原样落
  // stagingBracketToken——与下面「剥掉本报表前缀」刻意相反，不要按同一套逻辑合并。
  if (label.startsWith(STAGING_PREFIX)) return stagingBracketToken(label.slice(STAGING_PREFIX.length));
  const stripped = label.startsWith(REPORT_PREFIX) ? label.slice(REPORT_PREFIX.length) : label;
  const dot = stripped.lastIndexOf('.');
  if (dot < 0) return `[${stripped}]`;
  return `[${stripped.slice(0, dot)}].[${stripped.slice(dot + 1)}]`;
}

/** 字符串字面量的 KimpoSQL 写法：单引号包裹，内部单引号按 SQL 惯例翻倍转义。 */
function sqlStringLiteral(raw: string): string {
  return `'${raw.replace(/'/g, "''")}'`;
}

/**
 * 结构化 ValueRef → KimpoSQL 文本。返回 undefined 表示「这个形态没有对应的文本写法」，
 * 调用方应保持原值不动（而不是落一个空串——那会把「不填充」与「填空串」坍缩，见
 * ExpressionEditor.isEmptyExpr 的三态口径）。
 *
 * 三态（其实是四态）在这里必须逐个区分，不能压平：
 *   - `{kind:'const'}`（value 缺省）  = **不填充** ⇒ 返回 undefined，保持占位态，由 finalize 剔除；
 *   - `{kind:'const', value:null}`    = **填 NULL** ⇒ `NULL`；
 *   - `{kind:'const', value:''}`      = **填空串** ⇒ `''`；
 *   - `{kind:'const', value:'x'}`     = 填常量   ⇒ `'x'`。
 */
export function valueRefToBracketText(
  ref: ValueRef | null | undefined,
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[],
  opts: BracketTextOptions = {}
): string | undefined {
  if (!ref) return undefined;
  switch (ref.kind) {
    case 'source_field': {
      // 本报表上下文表（bt* 别名，见 ExpressionEditor.reportAlias）：服务端只认 3 段保留形态
      // `本报表.[表].[字段]`——不能沿用 3.4 的显示标签（主表裸字段名 / 明细 `表 · 字段`），那是给人看的。
      const form = forms.find(f => f.alias === ref.alias);
      if (form) return reportBracketToken(form.table.table_name, fieldNameOf(form.fields, ref.field_id));
      // 显式来源：`[来源别名(N)].[字段]`——别名与适配层 catalogSourceAlias 同源（表名 + 同表多实例序号）。
      const source = sources.find(s => s.alias === ref.alias);
      if (!source) return undefined;
      // V4 文档往返回来的本报表上下文表（rpt-* 别名，不在 forms 里而混在 sources 里，见 rawSerialize
      // isReportContextAlias）：同样只认 3 段保留形态——若当显式来源写成 `[表].[字段]`，同一张表既做本报表
      // 又做「历史数据」目录来源时，服务端会把它解析成同名的目录来源，语义正好反了。
      if (isReportContextAlias(ref.alias)) return reportBracketToken(source.name, fieldNameOf(source.fields, ref.field_id));
      // Phase B 暂存来源（dataTableId==='__staging__'，见 ExpressionEditor.sourceTablesForInput）：
      // 同样只认保留前缀形态——若按下面的显式来源写法拼 `[产出名].[列]`，服务端按别名找不到这个
      // 「来源」（暂存表不是一张登记在 query.sources 里的普通表），tokenize/diagnose 报错
      //。source.name 此时是拓扑 producerLabel（人类可读展示名，不是
      // 引用寻址用的表名），不能进最终文本。
      if (source.dataTableId === '__staging__') return stagingBracketToken(fieldNameOf(source.fields, ref.field_id));
      const alias = `${source.name}${instanceSuffix(ref.alias, source.dataTableId, sources)}`;
      return `[${alias}].[${fieldNameOf(source.fields, ref.field_id)}]`;
    }
    case 'form_field': {
      const form = forms.find(f => f.table.data_table_id === ref.table_id);
      return form ? reportBracketToken(form.table.table_name, fieldNameOf(form.fields, ref.field_id)) : undefined;
    }
    case 'system_var': {
      // 系统变量 = 语言包登记的无引号点路径（`系统变量.当前时间`），由 V4 目录经解析口给出；目录缺席时
      // 用 3.4 目录的显示名拼一个**可见的**近似写法——宁可让服务端报「找不到」给用户看，也不能压成空串
      // 静默丢掉。
      const token = opts.systemVariableToken?.(ref.var_id ?? '');
      if (token) return token;
      const label = systemVars.find(sv => sv.var_id === ref.var_id)?.label ?? ref.var_id ?? '';
      return label ? `系统变量.${label}` : undefined;
    }
    case 'const': {
      if (ref.value === undefined) return undefined; // 「不填充」占位态：不是一个表达式
      if (ref.value === null) return 'NULL';
      if (typeof ref.value === 'number' || typeof ref.value === 'boolean') return String(ref.value);
      return sqlStringLiteral(String(ref.value));
    }
    default:
      // func/window/case/raw 等：raw 本身已是文本（调用方不该送进来）；其余结构化形态在 V4 首版
      // 「仅表达式输入」边界下不会由拾取入口产出，真出现时保持原值、不擅自猜一种写法。
      return undefined;
  }
}

/**
 * 拾取入口落值前的统一收口：brackets（V4）语法下把结构化拾取值转成 raw 文本节点，
 * braces（3.4）语法下原样返回。
 *
 * 抽成纯函数而不是写在组件里，理由同 matchKeyExtract.ts 的既有约定——语法分支是有判据价值的
 * 语义（错了会让 V4 节点整份存不下来），必须能被单测直接钉住，不能只活在组件内部。
 */
export function pickedRefForSyntax(
  ref: ValueRef | null,
  syntax: 'braces' | 'brackets',
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[],
  opts: BracketTextOptions = {}
): ValueRef | null {
  if (syntax !== 'brackets' || !ref || ref.kind === 'raw') return ref;
  const text = valueRefToBracketText(ref, sources, forms, systemVars, opts);
  return text === undefined ? ref : { kind: 'raw', text };
}
