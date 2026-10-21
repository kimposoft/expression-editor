/**
 * writeModelAdapter —— V4 写节点文档（V4WriteNodeDocument）⇄ 3.4 查询模型（ExpressionModel）双向适配
 *。
 *
 * 为什么需要它：三写动作（新增/修改/删除数据）的配置面沿取数已验证的路线换轨——挂载成熟的
 * ExpressionEditor（3.4 本体，写模式④段已实现，见 ExpressionEditor.vue「写目标」相关代码），而权威
 * 模型是 V4 写节点文档（./writeNodeDocument.ts）。本文件只做「模型形状翻译」，语义与
 * ./expressionModelAdapter.ts（取数节点的同角色适配器）逐条对齐——**来源/关联/筛选段与取数节点
 * 完全同构**（两种节点文档共用同一个 V4QueryDefinition 形状），故直接复用该文件抽出的两个纯函数
 * `v4QueryToModelSource`/`modelToV4Query`，不重复实现；本文件只新增写节点专属的目标段
 * （target/assignments/dedupe）翻译。
 *
 * 两侧结构的对应关系：
 * - `operation` ↔ `TargetSpec.operation`：字面量同值（''|insert|update|delete，3.4 侧多一个空串
 *   表示"取数回填"，写节点适配器只产出/消费三个写值）。
 * - 三个操作统一：`target.data_table_id`/`template_id` ↔ `TargetSpec.target_data_table_id`/
 *   `target_template_id`（跨模板写目标表身份，不经来源段指认——update/delete 不再走
 *   `target_alias`≡`instance_id` 的"查询它并写它"寻址，决议 ⑧ 撤销该约定）；`target_table_role`
 *   是 3.4 TargetSpec 的字段，V4WriteTarget 没有对应字段（Go 侧未落码）——正向翻译时"顺手"从已
 *   翻译好的来源段里查（目标表若恰好也是来源段的一员，如「隐含来源/引用即入源」机制补入的配对表，
 *   沿用其角色），查不到就留空，任务书硬约束：不为此新增宿主查询点。
 * - `V4WriteTarget.instance_id`（@deprecated，决议 ⑧ 之前 update/delete 的唯一寻址方式）：仅供
 *   正向翻译读兼容——`data_table_id` 缺省而 `instance_id` 有值时，按它在 query.sources 里反查
 *   对应实例的 data_table_id/template_id 折算成新形状；反向翻译（保存）永不产出该字段。
 * - `assignments[]` ↔ `TargetSpec.outputs[]`（`{target_field_id, expression}`，表达式走
 *   `v4ExpressionToValueRef`/`valueRefToV4Expression`，purpose 恒 'output'，写模式输出不携带
 *   fill_strategy/separator——与取数填充的多策略语义无关，3.4 侧 setWriteOutputExpr 已保证这两个
 *   字段不出现，本适配器不重复剥离）；表达式稳定 ID 用 `asg_<target_field_id>`（Go schema 未强制
 *   格式，取一个可读、按字段幂等的形态，避免每次往返都换 ID）。
 * - `parent`（@deprecated，决议 ⑧ 撤销「父记录锚定」配置项）：正向翻译不再消费该字段（doc.parent
 *   即便存在也不翻成 target.parent——父记录改由查询结果推导，不再有独立配置）；反向翻译永不产出
 *   doc.parent（`...prev` 展开前先剔除该键，防止旧文档的 parent 透过展开残留）。
 * - `dedupe` ↔ `dedupe_field_ids`/`dedupe_scope`：`field_ids` 非空数组才产出 dedupe 段，
 *   `scope` 缺省回落 'all'（与 3.4 TargetSpec.dedupe_scope 注释「''/all(全表，缺省)」同口径）。
 * - `max_affected_rows`：不在 ExpressionModel 里（它是节点 params 的兄弟键，由动作设计器「选项」
 *   浮层维护），本适配器原样保留 `prev.max_affected_rows`（反向翻译靠 `...prev` 展开自然带过，
 *   不显式覆盖）。
 *
 * 表达式承载与「未编辑」判据（isUneditedAgainstPrev）与取数节点完全一致，见
 * ./expressionModelAdapter.ts 文件头「表达式的承载」段与 valueRefToV4Expression 注释，本文件不重复
 * 展开。
 */
import type { ExpressionModel, TargetSpec } from '../types';
import {
  v4ExpressionToValueRef,
  valueRefToV4Expression,
  v4QueryToModelSource,
  modelToV4Query,
  isWriteTargetSourceAlias,
  type V4ModelAdapterContext
} from './expressionModelAdapter';
import type { V4WriteAssignment, V4WriteDedupe, V4WriteNodeDocument, V4WriteOperation, V4WriteTarget } from './writeNodeDocument';

/** 写节点表达式的稳定引用 ID 前缀：按目标字段 ID 派生（`asg_<field_id>`），同一字段多次往返恒
 *  同一 ID，避免每次保存都换 expression_id 导致服务端把它当"新表达式"重新绑定。 */
function writeAssignmentExpressionId(fieldId: string): string {
  return `asg_${fieldId}`;
}

/**
 * 「写目标不能是视图」的具名错误：视图是查询产物，不是可写入的物理表——V4 写
 * 节点文档的 target 段（新增/修改/删除）语义上恒指向数据表，服务端 writedoc 也没有"写视图"这条
 * 通路。按 code（而非 message 文案）匹配，四语言展示文案见 locales 的 `errMsg.writeTargetCannotBeView`
 * key（本类的 message 固定为该 key 的 zh-CN 值——本文件是纯 TS 适配层，拿不到 useT()/inject 的
 * Vue 上下文，无法在此直接本地化；调用方若要在 UI 上展示随语言切换的提示，应 catch 本错误后按
 * `error instanceof WriteTargetCannotBeViewError`（或 `error.code`）识别，再自行 `t('errMsg.writeTargetCannotBeView')`
 * 取本地化文案，不要依赖 message 原文）。
 */
export class WriteTargetCannotBeViewError extends Error {
  readonly code = 'WRITE_TARGET_CANNOT_BE_VIEW';
  constructor() {
    super('写目标不能是视图来源：视图不支持写入（新增/修改/删除），请改选数据表作为写目标');
    this.name = 'WriteTargetCannotBeViewError';
  }
}

/**
 * 把 V4 写节点文档翻译成 ExpressionEditor 能直接消费的 ExpressionModel（写模式）。
 *
 * schema_version 固定 2（同取数节点 v4DocToExpressionModel）；来源/关联/筛选段直接复用
 * v4QueryToModelSource（与取数节点逐字同构，见文件头注释）。
 */
export function v4WriteDocToExpressionModel(
  doc: V4WriteNodeDocument,
  ctx: V4ModelAdapterContext
): ExpressionModel {
  const { source, where_text_source } = v4QueryToModelSource(doc.query, ctx);

  for (const t of source.tables) {
    if (isWriteTargetSourceAlias(t.alias)) t.is_write_target = true;
  }

  const target: TargetSpec = {
    target_template_id: ctx.templateId,
    target_data_table_id: '',
    outputs: doc.assignments.map(a => ({
      target_field_id: a.target_field_id,
      expression: v4ExpressionToValueRef(a.expression, ctx)
    })),
    operation: doc.operation
  };

  // 目标先行：三个操作统一按 target.template_id/data_table_id 直接给目标身份，
  // 不再区分 insert 与 update/delete 两套映射。
  if (doc.target.data_table_id) {
    target.target_template_id = doc.target.template_id ?? '';
    target.target_data_table_id = doc.target.data_table_id;
  } else if (doc.target.instance_id) {
    // @deprecated 读兼容：决议 ⑧ 之前的旧 update/delete 文档只落 instance_id（指向 query.sources
    // 里已经在场的那条来源实例，"查询它并写它"），按其 data_table_id/template_id 折算成新形状；
    // 反向翻译（下方 expressionModelToV4WriteDoc）不会再写出 instance_id，读一次即"脱敏"。
    const st = source.tables.find(t => t.alias === doc.target.instance_id);
    if (st) {
      target.target_template_id = st.template_id;
      target.target_data_table_id = st.data_table_id;
    }
  }
  // 写目标角色（主表/扩展表）：V4WriteTarget 无独立 table_role 字段，顺手从已翻译好的来源段里查
  // （目标表若恰好也出现在 source.tables，如「隐含来源/引用即入源」机制补入的配对表，沿用其角色）；
  // 取不到留空——编辑器侧 onSelectWriteTarget 会在用户下一次交互时按 tableMeta 补全，本适配器不为此
  // 新增宿主查询点（任务书硬约束）。
  target.target_table_role = source.tables.find(
    t => t.template_id === target.target_template_id && t.data_table_id === target.target_data_table_id
  )?.role;

  // parent（@deprecated，决议 ⑧ 撤销「父记录锚定」配置项）：doc.parent 即便存在（存量文档）也不
  // 翻译——父记录改由查询结果推导，编辑器不再有任何配置入口读到它。

  if (doc.dedupe) {
    target.dedupe_field_ids = doc.dedupe.field_ids;
    target.dedupe_scope = doc.dedupe.scope;
  }

  const model: ExpressionModel = {
    schema_version: 2,
    source,
    target,
    distinct: doc.query.options.distinct,
    limit: doc.query.options.take
  };
  if (where_text_source) {
    model.where_text_source = where_text_source;
  }
  return model;
}

/**
 * 把编辑器改动过的 ExpressionModel 写回 V4 写节点文档。query 段经 modelToV4Query 翻译（与取数节点
 * 完全同构，见文件头注释）；目标段（operation/target/assignments/parent/dedupe）是写节点专属信息，
 * 在本函数内处理。以 prev（改动前的 V4 写节点文档）为底——max_affected_rows 等写节点独有、3.4 模型
 * 无处安放的信息经 `...prev` 展开原样带过。
 */
export function expressionModelToV4WriteDoc(
  model: ExpressionModel,
  prev: V4WriteNodeDocument,
  ctx: V4ModelAdapterContext
): V4WriteNodeDocument {
  // 写目标不能是视图：正常 UI 路径的
  // 写目标单选器（ExpressionEditor.vue :single picker，onSelectWriteTarget）本就不放开视图叶子
  // （见该组件 write-target-pick 段落头注释「写目标段的 picker 仍不放开」），这里是对**直接构造
  // ExpressionModel** 的调用方（如未来新写法误把视图当数据表选用、或手写测试夹具）的兜底防线——
  // 一旦模型的写目标身份（target_data_table_id）指向了某条视图来源（用户/调用方误把视图的
  // view_id 当成 data_table_id 使用），一律具名拒绝、不静默转换成别的形态（如悄悄丢弃、当空
  // target 处理）。只在已选目标（target_data_table_id 非空）时才检查，避免把"还没选目标"的正常
  // 中间态（空串）与"某条视图恰好也是空 data_table_id"混为一谈而误报。
  const tgtDataTableId = model.target?.target_data_table_id;
  if (tgtDataTableId) {
    const targetIsView = (model.source?.tables ?? []).some(
      st => st.source_type === 'view' && (st.view_id === tgtDataTableId || st.data_table_id === tgtDataTableId)
    );
    if (targetIsView) throw new WriteTargetCannotBeViewError();
  }
  const query = modelToV4Query(model, prev.query, ctx);
  // 🔴 出口防御：正向根因（ExpressionEditor.vue reconcile 里按别名字符串
  // 而非 data_table_id 判"该本报表表是否已在场"）已在编辑器侧堵住，这里再加一道兜底——防止同类
  // 回归（未来任何新增的来源合成路径疏漏同一判等）越过设计态直接把非法文档打到服务端，让开发者在
  // 控制台就看见明确警告，而不是等用户点"测试"时才收到一句服务端拒绝。按 instance_id 去重、保留
  // 首条（sources[0] 是查询的根来源，语义上更权威的那一条，见 withValidRoot 头注释）。
  const seenSourceInstanceIds = new Set<string>();
  const dedupedSources = query.sources.filter(s => {
    if (seenSourceInstanceIds.has(s.instance_id)) {
      console.warn(
        `[expression-editor/v4] 写节点 query.sources 存在重复 instance_id，已剔除多余项（instance_id=${s.instance_id}）`
      );
      return false;
    }
    seenSourceInstanceIds.add(s.instance_id);
    return true;
  });
  if (dedupedSources.length !== query.sources.length) query.sources = dedupedSources;
  const tgt = model.target;
  // operation 正常链路恒由 ExpressionEditor.vue 的 ensureWriteOperation 按 props.writeOperation
  // 种入模型；取不到（如外部直接构造的模型）时回落 prev.operation，不产出非法的空串/取数值。
  const operation: V4WriteOperation =
    tgt.operation === 'insert' || tgt.operation === 'update' || tgt.operation === 'delete' ? tgt.operation : prev.operation;

  // 目标先行（决议 ⑧）：三个操作统一产出 {template_id, data_table_id}，不再产出 instance_id/
  // target_alias——update/delete 与 insert 同口径，目标表由①段选择器直接给出身份。
  const target: V4WriteTarget = {
    data_table_id: tgt.target_data_table_id || undefined,
    template_id: tgt.target_template_id || undefined
  };

  const prevAssignmentByField = new Map(prev.assignments.map(a => [a.target_field_id, a]));
  const assignments: V4WriteAssignment[] = (tgt.outputs ?? []).map(o => {
    const prevA = prevAssignmentByField.get(o.target_field_id);
    return {
      target_field_id: o.target_field_id,
      expression: valueRefToV4Expression(
        o.expression,
        prevA?.expression.expression_id ?? writeAssignmentExpressionId(o.target_field_id),
        'output',
        prevA?.expression,
        ctx
      )
    };
  });

  const dedupe: V4WriteDedupe | undefined =
    tgt.dedupe_field_ids && tgt.dedupe_field_ids.length > 0
      ? { field_ids: tgt.dedupe_field_ids, scope: tgt.dedupe_scope ?? 'all' }
      : undefined;

  // parent（@deprecated，决议 ⑧ 撤销）：新文档永不产出该字段——`...prev` 展开会带回旧文档可能
  // 携带的 parent 键，这里显式从 prev 里剔除后再展开，避免"读入-原样保存"时它透过展开残留下来。
  const { parent: _droppedLegacyParent, ...prevWithoutParent } = prev;

  return {
    ...prevWithoutParent,
    query,
    operation,
    target,
    assignments,
    dedupe
  };
}
