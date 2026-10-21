import type { ConditionGroup, ExpressionModel } from './types';

export function isConditionGroupEffectivelyEmpty(group: ConditionGroup | null | undefined): boolean {
  if (!group) return true;
  for (const item of group.items) {
    if (item.predicate) return false;
    if (item.group && !isConditionGroupEffectivelyEmpty(item.group)) return false;
  }
  return true;
}

export function writeWhereMissing(_model: Pick<ExpressionModel, 'target' | 'where' | 'where_expr' | 'where_text_source'>): boolean {
  return false;
}
