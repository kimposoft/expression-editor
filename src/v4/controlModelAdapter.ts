/**
 * controlModelAdapter —— 表格编辑器字段控件候选查询文档（V4ControlQueryDocument）⇄ 3.4 查询模型（ExpressionModel）
 * 双向适配。
 *
 * 为什么需要它：表格编辑器控件设置面（select / radio / checkbox 从数据、list、cascader）沿取数 / 写节点已验证的
 * 路线换轨——挂载成熟的 ExpressionEditor（①来源 ②筛选），权威模型是 V4 控件查询文档
 * （./controlNodeDocument.ts）。本文件只做「模型形状翻译」：
 *
 * - 来源 / 关联 / 筛选段与取数节点**完全同构**（共用 V4QueryDefinition），直接复用
 *   ./expressionModelAdapter.ts 的 `v4QueryToModelSource` / `modelToV4Query`——本报表引用自动入源、
 *   恒真默认关联随文档落库但设计态隐藏、目录来源角色回填，全部继承，不重复实现。
 * - `columns[]` ↔ `TargetSpec{target_kind:'staging'}.outputs[]`：控件输出列与暂存列同构（自由命名的
 *   column_id + 显示名 + 表达式），借用暂存目标形态让 ExpressionEditor 的 reconcile / 字段树对输出列
 *   一视同仁；`target_field_id` = column_id、`target_field_label` = name。表达式稳定 ID 用
 *   `col:<column_id>`（按列幂等，避免每次往返换 expression_id 被服务端当新表达式）。
 * - `order_by[]` ↔ `TargetSpec.order_by[]`（TargetOrderKey 与 V4ControlOrderBy 逐字同构）。
 * - `query.options.distinct / take` ↔ `model.distinct / limit`（候选去重与「最多返回」，缺省 distinct=true）。
 * - `search` / `cascade`：3.4 模型无处安放，由表格编辑器「选项」气泡 / 级联配置直接改文档；反向翻译经
 *   `...prev` 原样带过，只做一件事：列被删除时把 `search.columns` 里已不存在的 column_id 剔掉（悬空引用
 *   会被服务端保存闸拒）；cascade 引用的列不自动改写（交给设置面校验提示，避免悄悄改用户配置）。
 *
 * 表达式承载与「未编辑」判据与取数节点完全一致，见 ./expressionModelAdapter.ts 文件头。
 */
import type { ExpressionModel, TargetSpec } from '../types';
import {
  v4ExpressionToValueRef,
  valueRefToV4Expression,
  v4QueryToModelSource,
  modelToV4Query,
  type V4ModelAdapterContext
} from './expressionModelAdapter';
import type { V4ControlColumn, V4ControlQueryDocument } from './controlNodeDocument';

/** 输出列表达式的稳定引用 ID：按 column_id 派生，同一列多次往返恒同一 ID。 */
function controlColumnExpressionId(columnId: string): string {
  return `col:${columnId}`;
}

/**
 * 把 V4 控件查询文档翻译成 ExpressionEditor 能直接消费的 ExpressionModel。
 *
 * schema_version 固定 2（同取数 / 写节点）；筛选只产出 where_text_source（恒表达式模式）；输出列落成一个
 * `target_kind='staging'` 的目标（见文件头），既是 `target` 也是 `targets[0]`。
 */
export function v4ControlDocToExpressionModel(doc: V4ControlQueryDocument, ctx: V4ModelAdapterContext): ExpressionModel {
  const { source, where_text_source } = v4QueryToModelSource(doc.query, ctx);
  const target: TargetSpec = {
    target_template_id: '',
    target_data_table_id: '',
    target_kind: 'staging',
    outputs: doc.columns.map(c => ({
      target_field_id: c.column_id,
      target_field_label: c.name,
      expression: v4ExpressionToValueRef(c.expression, ctx)
    })),
    distinct: doc.query.options.distinct
  };
  if (doc.order_by && doc.order_by.length > 0) {
    target.order_by = doc.order_by.map(o => ({ target_field_id: o.target_field_id, direction: o.direction }));
  }
  if (typeof doc.query.options.take === 'number') {
    target.take = doc.query.options.take;
  }
  const model: ExpressionModel = {
    schema_version: 2,
    source,
    target,
    targets: [target],
    distinct: doc.query.options.distinct,
    limit: doc.query.options.take
  };
  if (where_text_source) {
    model.where_text_source = where_text_source;
  }
  return model;
}

/**
 * 把编辑器改动过的 ExpressionModel 写回 V4 控件查询文档。query 段经 modelToV4Query 翻译（与取数节点完全同构）；
 * 输出列 / 排序 / 去重 / 限量由本函数处理；search / cascade 等表格编辑器专属段以 prev 为底经 `...prev` 原样带过
 * （search.columns 会剔掉已不存在的列）。
 */
export function expressionModelToV4ControlDoc(
  model: ExpressionModel,
  prev: V4ControlQueryDocument,
  ctx: V4ModelAdapterContext
): V4ControlQueryDocument {
  const query = modelToV4Query(model, prev.query, ctx);
  const target = (model.targets ?? []).find(t => t?.target_kind === 'staging') ?? model.target;
  const prevColumnById = new Map(prev.columns.map(c => [c.column_id, c]));
  const columns: V4ControlColumn[] = (target?.outputs ?? []).map(o => {
    const prevCol = prevColumnById.get(o.target_field_id);
    return {
      column_id: o.target_field_id,
      name: o.target_field_label !== undefined ? o.target_field_label.trim() || o.target_field_id : prevCol?.name ?? o.target_field_id,
      expression: valueRefToV4Expression(
        o.expression,
        prevCol?.expression.expression_id ?? controlColumnExpressionId(o.target_field_id),
        'output',
        prevCol?.expression,
        ctx
      )
    };
  });
  const columnIds = new Set(columns.map(c => c.column_id));

  // 去重 / 限量：目标级优先，其次模型顶层，最后沿用 prev。
  const distinct = target?.distinct ?? model.distinct ?? prev.query.options.distinct;
  const takeCandidate = target?.take ?? model.limit ?? prev.query.options.take;
  const take =
    typeof takeCandidate === 'number' && Number.isFinite(takeCandidate) && Math.floor(takeCandidate) >= 1
      ? Math.floor(takeCandidate)
      : undefined;
  query.options = { ...query.options, distinct, take };
  if (take === undefined) delete query.options.take;

  const orderBySource = target?.order_by ?? prev.order_by;
  const orderBy = (orderBySource ?? [])
    .filter(o => columnIds.has(o.target_field_id))
    .map(o => ({ target_field_id: o.target_field_id, direction: o.direction }));

  const next: V4ControlQueryDocument = { ...prev, query, columns };
  if (orderBy.length > 0) next.order_by = orderBy;
  else delete next.order_by;
  if (prev.search) {
    next.search = { ...prev.search, columns: prev.search.columns.filter(id => columnIds.has(id)) };
  }
  return next;
}
