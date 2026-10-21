// 写模式（修改/新增/删除数据）「自赋值」兜底判据（用户 09-10 反馈：修改扩展表按名称填充成
// 自赋值——某条填充表达式的引用只有目标实例的同一字段，执行后值恒不变，用户却看不出配置有问题）。
//
// 本文件只负责**判定**，不负责阻断——自赋值不是非法配置（服务端不会因此拒绝保存，执行也不会报
// 错），只是"填了等于没填"，属于设计态该提示、不该拦截的一类问题（同 ExpressionNotice 的 info 档）。
// 抽成独立、不依赖组件内部状态的纯模块，供 ExpressionEditor.vue ④段每行下方渲染兜底提示，也
// 便于插件侧 surface（如 记录控件插件）复用同一判据——host/上下文相关的"目标字段自身
// 的 V4 文本引用长什么样"由调用方通过 `selfRefText` 参数传入（各语法/宿主目录解析方式不同，不
// 在本文件内耦合）。
import type { ExpressionModel, ValueRef } from './types';

/**
 * 单条填充表达式是否「自赋值」：引用的就是写目标字段自己。
 * - braces（3.4）语法：表达式仍是结构化 `{kind:'source_field', alias, field_id}`，直接比对
 *   alias/field_id 是否恰是目标实例自身的这一个字段。
 * - brackets（V4）语法：拾取入口落盘前已经过 pickedRefForSyntax 转成 `{kind:'raw', text}`（结构化
 *   引用信息不再随表达式保留），故改按**全文本比对**——`selfRefText` 是调用方按当前来源/字段目录
 *   算出的「目标字段自身」应该长成的 V4 文本（即 `valueRefToBracketText({kind:'source_field',
 *   alias: targetAlias, field_id: targetFieldId}, ...)` 的结果），与表达式原文逐字相等才判定为
 *   自赋值——只覆盖"整条表达式就是这一个引用、不掺任何其它计算"的最简形态（与用户反馈的场景一致），
 *   不解析、不猜测更复杂的表达式（如把自身字段套进函数调用），那些不属于本兜底判据要覆盖的范围。
 *   `selfRefText` 传 undefined（调用方目录数据未就位算不出）时，raw 分支恒判"非自赋值"——不误报。
 */
export function isWriteSelfAssignmentExpr(
  expression: ValueRef | null | undefined,
  targetAlias: string,
  targetFieldId: string,
  selfRefText: string | undefined
): boolean {
  if (!expression) return false;
  if (expression.kind === 'source_field') {
    return expression.alias === targetAlias && expression.field_id === targetFieldId;
  }
  if (expression.kind === 'raw' && selfRefText !== undefined) {
    return (expression.text ?? '').trim() === selfRefText.trim();
  }
  return false;
}

/** 目标字段自身「自赋值」应长成的 V4 文本，调用方按当前来源/字段目录解析——见上方
 *  isWriteSelfAssignmentExpr 的 selfRefText 参数注释。签名抽出来单独命名，供
 *  writeSelfAssignmentFieldIds 的调用方读起来更直白。 */
export type WriteSelfAssignmentTextResolver = (targetFieldId: string) => string | undefined;

/**
 * 扫描写模式目标（model.target）的全部填充输出，返回「自赋值」的 target_field_id 集合——
 * ExpressionEditor.vue ④段据此在对应行下方渲染 info 级兜底提示（不阻断保存/执行）。
 * `targetAlias` 是写目标实例的确定性别名（`targetSourceAlias(model.target.target_data_table_id)`，
 * 见 v4/expressionModelAdapter.ts），由调用方传入而不是本函数内部现算——本文件不依赖 v4 适配层，
 * 保持零耦合，便于插件侧独立复用。
 */
export function writeSelfAssignmentFieldIds(
  model: Pick<ExpressionModel, 'target'>,
  targetAlias: string,
  selfRefTextFor: WriteSelfAssignmentTextResolver
): Set<string> {
  const result = new Set<string>();
  for (const o of model.target.outputs ?? []) {
    if (isWriteSelfAssignmentExpr(o.expression, targetAlias, o.target_field_id, selfRefTextFor(o.target_field_id))) {
      result.add(o.target_field_id);
    }
  }
  return result;
}
