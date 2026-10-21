/**
 * viewModelAdapter —— 视图定义文档（V4ViewDocument，见 ./viewDefinition.ts）⇄ 3.4 查询模型
 * （ExpressionModel）双向适配。
 *
 * 为什么需要它：视图设计器要挂载成熟的 ExpressionEditor（3.4 本体，①来源
 * ②筛选）编辑视图的查询部分，而权威模型是视图定义文档。本文件只做「模型形状翻译」，与
 * ./expressionModelAdapter.ts（取数节点）、./controlModelAdapter.ts（表格编辑器控件）同一角色分工：
 *
 * - 来源 / 关联 / 筛选段与取数节点**完全同构**（视图查询体 regular.query / group.query 都是
 *   V4QueryDefinition，见 ./viewDefinition.ts 头注释「视图不提供排序与前 N 条」），直接复用
 *   ./expressionModelAdapter.ts 的 `v4QueryToModelSource` / `modelToV4Query`，不重复实现。
 * - 「列」不借道 3.4 TargetSpec/OutputMapping（不像取数节点的暂存目标、表格编辑器控件的候选列那样把
 *   输出列塞进 `target.outputs`）：视图列有「某组该列显式留空（null）」这一取数/控件两条既有链路
 *   都不存在的语义，OutputMapping.expression 是必填的非空 ValueRef，硬塞进去会丢失"真正的 null"
 *   与"用户还没填"两种状态的区分。故视图列改用本文件自己的 V4ViewColumnModel 数组，与
 *   ExpressionModel 平级返回，由调用方（视图设计器的列表格 UI）自行渲染，不复用 ExpressionEditor
 *   内建的目标段 UI。
 * - 常规视图 = 一份 ExpressionModel + 一份列清单（column_id/name/value 三元组，顺序=doc.columns
 *   声明顺序）+ 排除重复开关；组合视图 = 共享列声明（column_id/name）+ 合并方式 + 每个数据组各自
 *   一份 ExpressionModel + 该组的逐列取值（顺序同上，value 可为 null）。
 *
 * 表达式承载（ValueRef 本体 raw 占位 + text_source 挂原文）与「未编辑」判据，与取数/控件节点完全
 * 一致，直接复用 ./expressionModelAdapter.ts 的 `v4ExpressionToValueRef`/`valueRefToV4Expression`，
 * 见该文件头注释「表达式的承载」段，本文件不重复展开。
 */
import type { ExpressionModel, TargetSpec, ValueRef } from '../types';
import {
  v4ExpressionToValueRef,
  valueRefToV4Expression,
  v4QueryToModelSource,
  modelToV4Query,
  type V4ModelAdapterContext
} from './expressionModelAdapter';
import type { V4ExpressionDocument } from './definition';
import {
  VIEW_DOCUMENT_SCHEMA_VERSION,
  emptyViewQuery,
  isRegularView,
  isCombinedView,
  type V4ViewDocument,
  type V4ViewGroup,
  type V4ViewSetMode
} from './viewDefinition';

/**
 * 视图列 UI 模型：显示名 + 取值。value=null 仅组合视图数据组允许（该组在这一列输出空值，见
 * ./viewDefinition.ts V4ViewGroup.values 注释）；常规视图的 value 恒非 null——`RegularBody.values`
 * 不接受 null（常规视图没有"某列输出空值"的概念），regularModelToV4ViewDoc 对常规视图遇到 null
 * 按"未配置"防御性兜底（回退成空文本 ValueRef，与包内其余表达式适配器"未配置=空 source_text"
 * 同一惯例），不会把 null 真的写进 regular.values。两种视图共用同一个类型是为了让常规/组合两条
 * 编辑面共用同一套「视图列表格」组件，不必为常规视图单独声明一个 value 恒非空的窄类型。
 */
export interface V4ViewColumnModel {
  column_id: string;
  name: string;
  value: ValueRef | null;
}

/**
 * 常规视图 ↔ 编辑器模型的往返载体：一份 ExpressionModel（来源/关联/筛选，经 v4QueryToModelSource/
 * modelToV4Query 翻译）+ 按 doc.columns 声明顺序排列的列清单 + 排除重复开关。
 * distinct=undefined 表示"文档没有显式配置过"（对应后端 RegularBody.Distinct 的指针语义，生效值
 * 按 effectiveViewDistinct 解释，见 ./viewDefinition.ts）——往返必须原样保留这一"未配置"状态，不能
 * 在这一层就垫成 true，否则"用户从未碰过这个开关"与"用户显式打开"就再也区分不出来了。
 */
export interface V4RegularViewModel {
  model: ExpressionModel;
  columns: V4ViewColumnModel[];
  distinct?: boolean;
}

/** 常规视图的一个占位空目标：视图列不走 TargetSpec/OutputMapping（见文件头注释），但 ExpressionModel.target
 *  是必填字段（legacy 镜像位，见 types.ts ExpressionModel 头注释），故给一个空目标占位，
 *  ExpressionEditor 挂载视图查询体时不会渲染任何目标段 UI（视图设计器不透出③目标 tab）。 */
function emptyViewTarget(): TargetSpec {
  return { target_template_id: '', target_data_table_id: '', outputs: [] };
}

/** 表达式稳定 ID：视图列按 column_id 派生（`view:<column_id>`，同一列多次往返恒同一 ID，避免每次
 *  保存都换 expression_id 导致服务端把它当"新表达式"重新绑定，同 controlModelAdapter.ts
 *  controlColumnExpressionId 同一惯例）；组合视图的某个数据组内再叠一层 group_id 前缀
 *  （`view:<group_id>:<column_id>`）——同一列在不同数据组各自有独立的表达式，不能共用一个 ID。 */
function viewColumnExpressionId(columnId: string): string {
  return `view:${columnId}`;
}
function viewGroupColumnExpressionId(groupId: string, columnId: string): string {
  return `view:${groupId}:${columnId}`;
}

/**
 * 把常规视图文档翻译成 ExpressionEditor 能直接消费的 ExpressionModel + 列清单。
 * 仅接受 view_type='regular' 的文档（isRegularView 判别；不满足时抛错——调用方应先按 view_type
 * 分派，不应把组合视图文档误传进来）。
 */
export function v4ViewDocToRegularModel(doc: V4ViewDocument, ctx: V4ModelAdapterContext): V4RegularViewModel {
  if (!isRegularView(doc)) {
    throw new Error('v4ViewDocToRegularModel 只接受 view_type=regular 且 regular 段非空的视图文档');
  }
  const { source, where_text_source } = v4QueryToModelSource(doc.regular.query, ctx);
  const model: ExpressionModel = {
    schema_version: 2,
    source,
    target: emptyViewTarget(),
    distinct: doc.regular.query.options.distinct,
    limit: doc.regular.query.options.take
  };
  if (where_text_source) model.where_text_source = where_text_source;
  const columns: V4ViewColumnModel[] = doc.columns.map(c => ({
    column_id: c.column_id,
    name: c.name,
    value: v4ExpressionToValueRef(doc.regular!.values[c.column_id], ctx)
  }));
  return { model, columns, distinct: doc.regular.distinct };
}

/**
 * 把编辑器改动过的常规视图模型写回视图文档。查询段经 modelToV4Query 翻译（以 prev 的 regular.query
 * 为底，未命中/prev 非常规视图时退回 emptyViewQuery——如从组合视图切换成常规视图，或全新文档）；
 * 列清单直接以 input.columns 为准（顺序即 doc.columns 顺序），表达式按 column_id 命中 prev 对应列
 * 复用 expression_id/refs（未编辑判据同 valueRefToV4Expression）。
 */
export function regularModelToV4ViewDoc(
  input: V4RegularViewModel,
  prev: V4ViewDocument,
  ctx: V4ModelAdapterContext
): V4ViewDocument {
  const prevRegular = isRegularView(prev) ? prev.regular : undefined;
  const query = modelToV4Query(input.model, prevRegular?.query ?? emptyViewQuery(), ctx);
  const values: Record<string, V4ExpressionDocument> = {};
  for (const col of input.columns) {
    const prevExpr = prevRegular?.values[col.column_id];
    // 常规视图不接受 null 取值（见 V4ViewColumnModel 头注释）：防御性兜底成空文本 raw ValueRef，
    // 与包内"未配置=空 source_text"的既有惯例一致，不把字面 null 落进 regular.values。
    const value: ValueRef = col.value ?? { kind: 'raw', text: '' };
    values[col.column_id] = valueRefToV4Expression(
      value,
      prevExpr?.expression_id ?? viewColumnExpressionId(col.column_id),
      'output',
      prevExpr,
      ctx
    );
  }
  return {
    schema_version: VIEW_DOCUMENT_SCHEMA_VERSION,
    view_type: 'regular',
    columns: input.columns.map(c => ({ column_id: c.column_id, name: c.name })),
    regular: {
      query,
      values,
      // distinct 缺省语义原样保留：input.distinct 为 undefined 时不写这个键（omitempty 口径），
      // 不在这一层垫成 true——生效值由 effectiveViewDistinct 在展示处解释。
      ...(input.distinct !== undefined ? { distinct: input.distinct } : {})
    }
  };
}

/**
 * 组合视图一个数据组的 UI 模型：分组身份（group_id/label）+ 该组自己的 ExpressionModel（来源/关联/
 * 筛选）+ 该组在每一列的取值。values 与 V4CombinedViewModel.columns **逐项对应**（同下标、同
 * column_id，恒与列声明等长）——v4ViewDocToCombinedModel 装配时会给"文档缺失某列取值"的历史/异常
 * 数据补一个 null 占位，调用方不需要自行处理数组长度不一致或按 column_id 查找。
 */
export interface V4ViewGroupModel {
  group_id: string;
  label: string;
  model: ExpressionModel;
  values: Array<{ column_id: string; value: ValueRef | null }>;
}

/**
 * 组合视图 ↔ 编辑器模型的往返载体：共享列声明（column_id/name，组间共用同一份，与常规视图的
 * columns 同一形状）+ 合并方式（undefined=文档未显式配置过，生效值按 effectiveViewSetMode 解释，
 * 同 V4RegularViewModel.distinct 的"缺省语义原样保留"原则）+ 各数据组（保留文档里的原始顺序）。
 */
export interface V4CombinedViewModel {
  columns: Array<{ column_id: string; name: string }>;
  set_mode?: V4ViewSetMode;
  groups: V4ViewGroupModel[];
}

/**
 * 把组合视图文档翻译成编辑器可消费的模型（每组各自一份 ExpressionModel）。
 * 仅接受 view_type='combined' 的文档（isCombinedView 判别；不满足时抛错，同 v4ViewDocToRegularModel）。
 */
export function v4ViewDocToCombinedModel(doc: V4ViewDocument, ctx: V4ModelAdapterContext): V4CombinedViewModel {
  if (!isCombinedView(doc)) {
    throw new Error('v4ViewDocToCombinedModel 只接受 view_type=combined 且 combined 段非空的视图文档');
  }
  const columns = doc.columns.map(c => ({ column_id: c.column_id, name: c.name }));
  const groups: V4ViewGroupModel[] = doc.combined.groups.map(g => {
    const { source, where_text_source } = v4QueryToModelSource(g.query, ctx);
    const model: ExpressionModel = {
      schema_version: 2,
      source,
      target: emptyViewTarget(),
      distinct: g.query.options.distinct,
      limit: g.query.options.take
    };
    if (where_text_source) model.where_text_source = where_text_source;
    const values = columns.map(c => {
      // g.values[c.column_id] 三态：真表达式 / 显式 null（该组该列留空）/ 键缺失（历史或异常数据，
      // 按"留空"兜底，不因数组下标对不齐而抛错——见本函数头注释「补一个 null 占位」）。
      const raw = g.values[c.column_id];
      return { column_id: c.column_id, value: raw == null ? null : v4ExpressionToValueRef(raw, ctx) };
    });
    return { group_id: g.group_id, label: g.label, model, values };
  });
  return { columns, set_mode: doc.combined.set_mode, groups };
}

/**
 * 把编辑器改动过的组合视图模型写回视图文档。每组的查询段各自经 modelToV4Query 翻译（以同 group_id
 * 的 prev 数据组为底；找不到——新增数据组——退回 emptyViewQuery）；每组每列的取值表达式按
 * (group_id, column_id) 命中 prev 对应表达式复用 expression_id/refs。
 */
export function combinedModelToV4ViewDoc(
  input: V4CombinedViewModel,
  prev: V4ViewDocument,
  ctx: V4ModelAdapterContext
): V4ViewDocument {
  const prevCombined = isCombinedView(prev) ? prev.combined : undefined;
  const prevGroupById = new Map((prevCombined?.groups ?? []).map(g => [g.group_id, g]));
  const groups: V4ViewGroup[] = input.groups.map(g => {
    const prevGroup = prevGroupById.get(g.group_id);
    const query = modelToV4Query(g.model, prevGroup?.query ?? emptyViewQuery(), ctx);
    const values: Record<string, V4ExpressionDocument | null> = {};
    for (const cell of g.values) {
      if (cell.value === null) {
        // 显式留空：原样落 null（组合视图的合法语义，不是"未配置"），不经 valueRefToV4Expression。
        values[cell.column_id] = null;
        continue;
      }
      // 复用 prev 同一 (group_id, column_id) 的表达式绑定；prev 该列此前是 null 或缺席时，
      // `?? undefined` 把 null 归一成 undefined 交给 valueRefToV4Expression 当"无历史"处理。
      const prevExpr = prevGroup?.values[cell.column_id] ?? undefined;
      values[cell.column_id] = valueRefToV4Expression(
        cell.value,
        prevExpr?.expression_id ?? viewGroupColumnExpressionId(g.group_id, cell.column_id),
        'output',
        prevExpr,
        ctx
      );
    }
    return { group_id: g.group_id, label: g.label, query, values };
  });
  return {
    schema_version: VIEW_DOCUMENT_SCHEMA_VERSION,
    view_type: 'combined',
    columns: input.columns.map(c => ({ column_id: c.column_id, name: c.name })),
    combined: {
      groups,
      // set_mode 缺省语义原样保留：input.set_mode 为 undefined 时不写这个键，同 regularModelToV4ViewDoc
      // 对 distinct 的处理原则。
      ...(input.set_mode !== undefined ? { set_mode: input.set_mode } : {})
    }
  };
}
