/**
 * 文本表达式 sidecar 的前端工具：
 *   - derivedStableId：与后端 textmodel.derivedStableID 逐字一致的稳定 ID 派生；
 *   - buildLowerTextRefs：把文本里按序出现的 {…} 标记解析成 lower-text 请求的 refs[]；
 *   - restoreTextFromSource：重开编辑器时按 text_source.refs[].stable_id 反查当前字段名重绘原文
 *     （字段改名同步）；
 *   - runeToUtf16Index：把服务端诊断的 rune 偏移换算成 textarea 的 UTF-16 下标（高亮/定位用）。
 *
 * 本文件只做纯计算，不做 IO / 响应式，便于单测。字段标签 ⇄ 引用的解析口径沿用 rawSerialize.ts
 * （resolveLabel / labelOfRef），系统变量按目录 label 解析（文本里系统变量也写成 {当前日期} 形态——
 * 表达式引擎 词法器把 `@x` 判成参数引用（ALICE_TEXTMODEL_PARAMETER_UNSUPPORTED），旧的 `@var_id` 写法在
 * 文本模式里走不通，故统一走花括号 + refs 绑定，目标 kind=system_var）。
 */
import type { LowerTextRef, TextSource, ValueRef } from './types';
import type { SystemVariableDef } from './useExpressionContext';
import { labelOfRef, resolveLabel, type FormTableLite, type SourceTableLite } from './rawSerialize';

/** 与 rawSerialize.ts FIELD_TOKEN 同一口径：花括号内不再嵌套花括号。 */
const FIELD_TOKEN = /\{([^{}]*)\}/g;

export function derivedStableId(target: ValueRef): string {
  switch (target.kind) {
    case 'source_field':
      return `source_field:${target.alias ?? ''}:${target.field_id ?? ''}`;
    case 'form_field':
      return `form_field:${target.table_id ?? ''}:${target.field_id ?? ''}`;
    case 'system_var':
      return `system_var:${target.var_id ?? ''}`;
    case 'const':
      return `const:${target.value === undefined ? '' : JSON.stringify(target.value)}`;
    default:
      return target.kind;
  }
}

/** 稳定 ID → 结构化引用（derivedStableId 的反函数；只认三种可绑定目标，其余返回 null）。 */
export function refOfStableId(stableId: string): ValueRef | null {
  const sep = stableId.indexOf(':');
  if (sep < 0) return null;
  const kind = stableId.slice(0, sep);
  const rest = stableId.slice(sep + 1);
  if (kind === 'system_var') return rest ? { kind: 'system_var', var_id: rest } : null;
  if (kind === 'source_field' || kind === 'form_field') {
    const dot = rest.indexOf(':');
    if (dot < 0) return null;
    const first = rest.slice(0, dot);
    const fieldId = rest.slice(dot + 1);
    if (!fieldId) return null;
    return kind === 'source_field' ? { kind, alias: first, field_id: fieldId } : { kind, table_id: first, field_id: fieldId };
  }
  return null;
}

/** 解析单个标签 → 引用：先按字段目录（rawSerialize.resolveLabel），再按系统变量目录 label 精确匹配。 */
export function resolveTextLabel(
  label: string,
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[]
): ValueRef | null {
  const field = resolveLabel(label, sources, forms);
  if (field) return field;
  const trimmed = label.trim();
  const v = systemVars.find(sv => sv.label === trimmed || sv.var_id === trimmed);
  return v ? { kind: 'system_var', var_id: v.var_id } : null;
}

/** 引用 → 显示标签（不含花括号）：字段走 labelOfRef；系统变量取目录 label（未命中回落 var_id）。 */
export function labelOfTextRef(
  ref: ValueRef,
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[]
): string {
  if (ref.kind === 'system_var') return systemVars.find(sv => sv.var_id === ref.var_id)?.label ?? ref.var_id ?? '';
  return labelOfRef(ref, sources, forms);
}

/**
 * 把文本里按序出现的每个 {…} 标记解析成 lower-text 请求 refs[]（与后端「第 i 个占位符绑定 refs[i]」
 * 同约定）。同一字段出现两次就产出两条（服务端 TextSource.Refs 会按稳定 ID 去重，请求侧不必去重）。
 * 解析不到的标签收进 unresolved，调用方据此拦下确认。
 */
export function buildLowerTextRefs(
  text: string,
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[]
): { refs: LowerTextRef[]; unresolved: string[] } {
  const refs: LowerTextRef[] = [];
  const unresolved: string[] = [];
  for (const m of text.matchAll(FIELD_TOKEN)) {
    const label = m[1].trim();
    const target = resolveTextLabel(label, sources, forms, systemVars);
    if (!target) {
      unresolved.push(m[1]);
      continue;
    }
    refs.push({ label, stable_id: derivedStableId(target), target });
  }
  return { refs, unresolved };
}

/**
 * 重开编辑器：按 text_source 恢复文本模式显示。原文里每个 {标签} 按「降级当时记下的标签」在
 * text_source.refs 里找到稳定 ID，再反查**当前**字段名重绘（字段改名自动同步）。
 * 为什么按标签而不按位置：服务端 TextSource.Refs 按稳定 ID去重、只记首次使用顺序，与原文占位符
 * 不再一一对应，位置映射会错位；标签在降级时由前端传入且同一稳定 ID 恒同标签，按它查是唯一可靠键。
 * 反查不到（来源表已被移除等）时保留原标签——用户至少看得到当初写的是什么，再降级时会由
 * unresolved 提示拦下。
 */
export function restoreTextFromSource(
  source: TextSource,
  sources: SourceTableLite[],
  forms: FormTableLite[],
  systemVars: SystemVariableDef[]
): string {
  const refs = source.refs ?? [];
  return source.text.replace(FIELD_TOKEN, (whole, raw: string) => {
    const label = raw.trim();
    const hit = refs.find(r => (r.label ?? '').trim() === label);
    if (!hit) return whole;
    const ref = refOfStableId(hit.stable_id);
    if (!ref) return whole;
    const current = labelOfTextRef(ref, sources, forms, systemVars);
    // labelOfRef 解析不到来源时回落裸 field_id（rawSerialize 既有行为）——那不是可读标签，保留原标签。
    if (!current || current === ref.field_id) return whole;
    return `{${current}}`;
  });
}

/** 服务端诊断的 rune（Unicode 码点）偏移 → JS 字符串的 UTF-16 下标（textarea.setSelectionRange 用）。
 *  BMP 内字符两者相等；仅含增补平面字符（emoji 等）时才会偏移，故逐码点累加而不是直接用。 */
export function runeToUtf16Index(text: string, runeOffset: number): number {
  if (runeOffset <= 0) return 0;
  let runes = 0;
  let idx = 0;
  for (const ch of text) {
    if (runes >= runeOffset) break;
    idx += ch.length;
    runes += 1;
  }
  return idx;
}
