import type { ExpressionModel, MatchKey, ValueRef, ConditionItem } from './types';

/** 本报表隐式 context 表别名前缀（bt0=主表/bt1..=扩展），与显式来源 t1/t2 不冲突。 */
export const REPORT_ALIAS_PREFIX = 'bt';

/** 由 context 别名解析其 data_table_id（宿主提供，隔离 ctx 依赖便于测试）；未知返回 null。 */
export type ResolveContextDataTable = (alias: string) => string | null;

/** ref 是否指向「目标明细表」的字段：kind=source_field + bt* 别名 + 该别名对应 data_table_id 等于目标表。 */
function isTargetDetailFieldRef(m: ExpressionModel, v: ValueRef | undefined, resolve: ResolveContextDataTable): boolean {
  if (!v || v.kind !== 'source_field' || !v.alias || !v.field_id) return false;
  if (!v.alias.startsWith(REPORT_ALIAS_PREFIX)) return false;
  const dt = resolve(v.alias);
  return !!dt && dt === m.target.target_data_table_id;
}

/** ref 是否为「来源侧」字段：source_field 且别名非本报表 context（即显式来源表 t1/t2…）。 */
function isPlainSourceFieldRef(v?: ValueRef | null): boolean {
  return !!v && v.kind === 'source_field' && !!v.alias && !v.alias.startsWith(REPORT_ALIAS_PREFIX) && !!v.field_id;
}

/** 把一对「目标明细字段 ↔ 来源字段」等值端点转成匹配键；不构成该形态返回 null。
 *  a/b 允许 undefined——K1 引入 is_null/is_not_null 判空算子后 Predicate.right 变为可选字段，
 *  这里防御性兜底（调用方仅在 op=eq 时才会传入，正常数据下恒有值，但类型层面须兼容缺失）。 */
function pairToMatchKey(m: ExpressionModel, a: ValueRef | undefined, b: ValueRef | undefined, resolve: ResolveContextDataTable): MatchKey | null {
  if (!a || !b) return null;
  if (isTargetDetailFieldRef(m, a, resolve) && isPlainSourceFieldRef(b)) return { source_expr: b, form_field_id: a.field_id! };
  if (isTargetDetailFieldRef(m, b, resolve) && isPlainSourceFieldRef(a)) return { source_expr: a, form_field_id: b.field_id! };
  return null;
}

/**
 * 从条件段提取「目标明细字段 = 来源字段」等式为内存匹配键，并**原地移除**已提取的等式：
 *   - 结构化 where：移除顶层 AND（未整组取反）里 op=eq 的匹配谓词，其余谓词保留。
 *   文本模式写的 `{明细.d} = {来源.a}` 经 lower-text 降级后就是同一形状的结构化谓词，自然走同一条路。
 *
 * 返回提取到的匹配键（可能为空）。调用方负责与「row_match 输出」派生的匹配键合并，并在其后重新收集
 * 别名以回收不再被引用的明细上下文表。
 */
export function extractConditionMatchKeys(m: ExpressionModel, resolve: ResolveContextDataTable): MatchKey[] {
  const keys: MatchKey[] = [];

  // 结构化 where：顶层 AND 且未整组取反时才剥离（与后端 splitMatchKeyWhere 语义一致）。
  const w = m.where;
  if (w && w.logic === 'and' && !w.negate) {
    const kept: ConditionItem[] = [];
    for (const it of w.items) {
      if (it.predicate && it.predicate.op === 'eq') {
        const mk = pairToMatchKey(m, it.predicate.left, it.predicate.right, resolve);
        if (mk) { keys.push(mk); continue; } // 剥离出 where
      }
      kept.push(it);
    }
    if (kept.length !== w.items.length) {
      if (kept.length === 0) m.where = undefined;
      else w.items = kept;
    }
  }

  return keys;
}
