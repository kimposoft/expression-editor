/**
 *
 * 表达式引擎 V3.4 硬切后，前端不得返回、展示或猜测该文本的结构化语义，也不得从
 * 旧 `targets` 生成 best-effort 模型。这个 helper 因此只暴露 boolean，供设计器显示固定退役提示。
 */
export function hasLegacyKimpoSql(params: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(params, 'kimpo_sql');
}
