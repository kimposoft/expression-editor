// 字段搜索匹配口径：从 FieldTreePanel.vue 原有内联实现原样抽出为纯函数，
// 供 FieldTreePanel（来源表/本报表/变量 三页签搜索）与 FieldTreeDock共享同一份
// 判据——按字段名 / 字段 ID 做大小写不敏感的包含匹配。两处调用方各自维护会产生口径漂移风险
// （如一处改成前缀匹配、另一处仍是包含匹配），故收敛到此处单一定义。
import type { TemplateField } from './types';

/**
 * 字段是否命中搜索关键字。
 * @param field 待判定字段
 * @param lowerKeyword 已 trim + toLowerCase 的关键字；空串恒匹配（即"未搜索"时不过滤）
 */
export function matchField(field: TemplateField, lowerKeyword: string): boolean {
  if (!lowerKeyword) return true;
  return (field.field_name ?? '').toLowerCase().includes(lowerKeyword) || (field.field_id ?? '').toLowerCase().includes(lowerKeyword);
}
