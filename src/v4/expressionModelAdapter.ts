/**
 * expressionModelAdapter —— V4 取数节点文档（V4ExtractNodeDocument）⇄ 3.4 查询模型（ExpressionModel）
 * 双向适配（共享前端包 · 设计态）。
 *
 * 为什么需要它：取数配置面的 UI 换轨为直接挂载成熟的 ExpressionEditor（3.4 本体，五个场景共用、
 * 已按 V4 规格改造过目标段，且 2026-09-02 起恒为表达式模式），而权威模型仍是 V4 节点文档。
 * 本文件只做「模型形状翻译」，不改任何一侧的语义，也不发请求——表达式的绑定/降级由
 * ./v4ExpressionHostAdapter.ts 在 host 层承接。
 *
 * 两侧结构的对应关系（差异仅四处，其余逐字同构）：
 * - 来源：3.4 `source.tables[]`（以 alias 为稳定标识）↔ V4 `query.sources[]`（以 instance_id 为
 *   稳定标识）。**3.4 的 alias 一律取 V4 的 instance_id**：3.4 的 alias 是模型内标识符（结构化
 *   引用按它绑定），V4 的 instance_id 同样是稳定标识，两者一一对应。
 *   V4 自己的 `alias` 则是**显示别名**，且不只是显示：服务端 v4/bind 解析设计态文本 `[表].[字段]`
 *   时，表段就按作用域里各来源的 alias 逐字匹配（只有 tokenize 之后的 `#{rN}` 才按稳定 ref 绑定）。
 *   所以目录来源的 alias 必须与编辑器展示给用户、并由 ⊞ 拾取 / ƒ 字段树插入的表名**逐字一致**——
 *   反向翻译时按 ctx.tableLabelOf 查目录重算（见 catalogSourceAlias），不能用 instance_id 占位
 *  。
 * - 关联：3.4 `source.joins[]` 用 left_alias/right_alias ↔ V4 `query.joins[]` 用
 *   left_instance_id/right_instance_id，按上面的 alias=instance_id 约定直接对应。
 * - 排序（用户 2026-09-08 改判）：V4 在每个 `targets[].order_by`（按目标字段 ID），3.4 另有一份顶层
 *   `order_by`（按表达式匹配）。**V4 是权威侧且逐目标独立**，两侧不互灌：正反向都只搬
 *   `targets[].order_by` ↔ `TargetSpec.order_by`，顶层那份留给 3.4 链路自己用。
 *   改判前反向写的是 `hit?.order_by`（原样保留上一版文档），而编辑器的排序下拉写的是顶层 order_by，
 *   两条通道从不相交 ⇒ V4 壳下用户设的排序保存即丢、重开恒显示"不排序"（本次修复的根因）。
 * - 分组：3.4 有 group_by/having，V4 没有（V4 无 HAVING，见引擎侧口径）。正向恒不产出，反向恒忽略。
 *
 * 表达式的承载：V4 的表达式是「token 化文本 + 稳定引用绑定表」（V4ExpressionDocument），3.4 的
 * 表达式本体是结构化 ValueRef、文本只作 sidecar（TextSource，注释原话「执行面永远不读它」）。
 * 本适配把 V4 文本放进 `ValueRef.text_source.text`，ValueRef 本体填 kind='raw' 占位——V4 链路的
 * 执行面读的是 V4 文档自己的 source_text，不读这个占位；3.4 UI 侧读 text_source 显示原文，正是
 * 恒表达式模式下的既有渲染路径。往返只以 text_source.text 为准，占位不参与回写。
 */

import type {
  ChartTargetSpec,
  ConditionGroup,
  ExpressionModel,
  CompareOp,
  JoinPredicate,
  JoinSpec,
  OutputMapping,
  SourceSpec,
  SourceTable,
  TargetSpec,
  TextSource,
  TextSourceRef,
  ValueRef
} from '../types';
import type {
  V4ChartTarget,
  V4ChartValueSlot,
  V4ExtractNodeDocument,
  V4FillOutput,
  V4FillTarget,
  V4QueryDefinition,
  V4QueryOptions } from './nodeDocument';
import type { V4ExpressionDocument, V4ExpressionRefWire, V4JoinDefinition, V4SourceBinding } from './definition';

/** 适配所需的外部上下文：本报表来源要落 template_id，V4 文档里只存 table_id。 */
export interface V4ModelAdapterContext {
  /** 当前模板 ID：V4 的 report 来源（kind='report'）落 3.4 SourceTable 时的 template_id。 */
  templateId: string;
  appId?: string;
  /**
   * 可读文本查询口（可选）：V4 文档里存的是 token 化源码（`[标签]#{rN}`），直接显示给用户是乱码；
   * 真正可读的原文要经 host.restore 还原（改名后显示新名）。还原是异步的、且要按当前目录解析，
   * 不适合放在本纯函数里，故由调用方预先 restore 好，按 expression_id 供本适配查询。
   * 未提供、或查不到该表达式时回退 token 化源码本身——宁可显示原样，也不显示空白。
   */
  readableTextOf?: (expressionId: string, tokenizedText: string) => string;
  /**
   * 字段显示名查询口（可选）：关联 ON 由 3.4 的结构化谓词反向生成 V4 表达式时，token 形态
   * `[标签]#{rN}` 里的标签要取字段的可读名。查不到时回退 field_id——标签只影响显示，
   * 真正的绑定靠 refs 里的 (instance_id, field_id)。
   */
  fieldLabelOf?: (instanceId: string, fieldId: string) => string;
  /**
   * 按 alias（即 instance_id）反查来源绑定（可选）：关联 ON 由 3.4 结构化谓词反生成 V4 引用时，
   * **引用种类必须跟着来源种类走**——引擎侧 definition.toRefBinding 按 ref.kind 分三条路查
   * Scope：source_field 查 Scope.Sources（键=source_instance_id），report_field 查
   * Scope.Report（键=table_id），两者不通用。本报表来源的字段若产成 source_field，编译期必报
   * 「引用的来源字段（实例 rpt-… 字段 …）在给定 Scope 内找不到」。
   * 缺省不提供时一律按 source_field 处理（跨模板来源的既有行为不变）。
   */
  sourceOf?: (alias: string) => V4SourceBinding | undefined;
  /**
   * 数据表显示名查询口：反向翻译目录来源时据此重算 V4 显示别名（alias）。
   * 必须与编辑器给来源行 / 字段树 / ⊞ 拾取器用的表名**同源**——两边都是数据表的 table_name
   * （编辑器经 host.listTables，配置面经 V4 目录 candidates[].label，服务端两处都取
   * fields.TableName）——这样用户插入的 `[表].[字段]` 才能被服务端作用域按 alias 逐字解析。
   * 未提供、或查不到该表时回退当前别名（新加来源即 instance_id 占位）——宁可保持原样，也不猜。
   * 同时用于本报表上下文表（report 绑定的 alias，见 reportSourceBinding）：配置面须能按 data_table_id 查到
   * 当前模板各表的显示名（V4 目录 report.tables[].label）。
   */
  tableLabelOf?: (source: { app_id?: string; template_id: string; data_table_id: string }) => string | undefined;
  /**
   * 视图显示名查询口：反向翻译视图来源时据此重算 V4 显示别名（alias），
   * 道理与 tableLabelOf 对数据表来源完全一致——必须与编辑器给来源行/字段树/⊞ 拾取器用的视图名
   * **同源**，用户插入的 `[视图].[列]` 文本才能被服务端作用域按 alias 逐字解析。未提供、或查不到
   * 该视图时回退 fallback（当前别名），不擅自改，见 viewSourceAlias 头注释。
   */
  viewLabelOf?: (viewId: string) => string | undefined;
  /**
   * 当前节点的「上一步暂存区」生产者节点 ID（可选）。反向翻译新增暂存来源时写进
   * V4SourceBindingStaging.producer_node_id——服务端保存闸据此在同一份动作文档里找到 producer、
   * 读它的 staging_target.columns 推导暂存列。
 */
  stagingProducerNodeId?: string;
  /**
   * 上一步暂存区生产者节点的显示名（可选，2026-09-07 语法检查修复）。反向翻译暂存来源时据此
   * 重算 V4 显示别名（alias）——与目录来源 catalogSourceAlias 同一原则：alias 理应与编辑器展示
   * 给用户、并写进文本表段的名称一致。取值来源是 ExpressionEditor.vue 的
   * props.stagingSource.producerLabel（该 props 与本字段同源，见 sourceTablesForInput 对 staging
   * 用它作来源行 name）。
 */
  stagingProducerLabel?: string;
}

/**
 * 目录来源的 V4 显示别名：按 ctx.tableLabelOf 查到的表名，同表多实例时按加入顺序
 * 追加 `(1)(2)…`——与编辑器 rawSerialize.instanceSuffix 是**同一条规则**（同表多实例在字段树/拾取器
 * 里就是这样区分的），两边必须逐字一致，否则用户插入的 `[表(2)].[字段]` 服务端仍解析不到。
 *
 * 为什么每次回写都重算、而不是「首次落定后沿用」：本配置面（3.4 编辑器换轨壳）没有改别名的 UI，
 * alias 唯一的来源就是目录表名；表在目录里改名后，沿用旧名会让已存文本里的 `[旧名].[字段]` 与
 * 新作用域再次错位。查不到表名（目录未加载 / 跨应用候选缺席）时回退 fallback，不擅自改。
 *
 * 只对 template 种类的非上下文来源计数：view / external / staging 的 data_table_id 恒空串或合成键，
 * 本报表上下文表（is_context / bt* 别名）在编辑器的 instanceSuffix 里同样被排除。
 */
export function catalogSourceAlias(
  t: SourceTable,
  tables: SourceTable[],
  ctx: V4ModelAdapterContext,
  fallback: string
): string {
  const label = ctx.tableLabelOf?.({ app_id: t.app_id, template_id: t.template_id, data_table_id: t.data_table_id })?.trim();
  if (!label) return fallback;
  const same = tables.filter(
    x =>
      !x.is_context &&
      !x.alias.startsWith('bt') &&
      (x.source_type === 'template' || x.source_type === undefined) &&
      x.data_table_id === t.data_table_id &&
      x.template_id === t.template_id
  );
  if (same.length <= 1) return label;
  const idx = same.findIndex(x => x.alias === t.alias) + 1;
  return idx > 0 ? `${label}(${idx})` : label;
}

export function viewSourceAlias(t: SourceTable, tables: SourceTable[], ctx: V4ModelAdapterContext, fallback: string): string {
  const label = ctx.viewLabelOf?.(t.view_id ?? '')?.trim();
  if (!label) return fallback;
  const same = tables.filter(x => x.source_type === 'view' && x.view_id === t.view_id);
  if (same.length <= 1) return label;
  const idx = same.findIndex(x => x.alias === t.alias) + 1;
  return idx > 0 ? `${label}(${idx})` : label;
}

/**
 * 剔除「不填充」占位输出行——送往服务端之前的收口。
 *
 * 为什么不在 expressionModelToV4Doc 里直接丢：编辑期每次改动都要经「模型 → 文档 → 模型」往返，丢了
 * 占位行会把用户「先选填充方式、再配表达式」的中间态当场抹掉（填充方式挂在那条映射上）。故与 3.4
 * 编辑器 finalize ① 同一口径：编辑期保留，**送往服务端前**（收口保存 / 整节点编译预览）剔除。
 *
 * 判据只看 source_text 是否为空白——占位行没有引用；「refs 非空而文本为空」的形状不存在。
 */
export function stripUnconfiguredOutputs(doc: V4ExtractNodeDocument): V4ExtractNodeDocument {
  return {
    ...doc,
    targets: doc.targets.map(t => {
      const outputs = t.outputs.filter(o => (o.expression?.source_text ?? '').trim() !== '');
      // 排序键跟着输出走：被剔掉的未配置输出若还留在 order_by 里，服务端 extractdoc 解码闸会以
      // 「order_by[i].target_field_id 未出现在本目标 outputs 里」整份拒绝——预览链路上那等于一条
      // 与用户当前动作对不上的报错（同本函数剔除未配置输出的初衷）。
      const fieldIDs = new Set(outputs.map(o => o.target_field_id));
      const orderBy = t.order_by?.filter(o => fieldIDs.has(o.target_field_id));
      return { ...t, outputs, order_by: orderBy && orderBy.length > 0 ? orderBy : undefined };
    }),
    staging_target: doc.staging_target
      ? {
          ...doc.staging_target,
          columns: doc.staging_target.columns.filter(c => (c.expression?.source_text ?? '').trim() !== '')
        }
      : doc.staging_target
  };
}

/**
 * 暂存列空列名的「实时预览专用」兜底：用户刚新建一列、还没来得及填
 * 列名时，若这份文档就拿去跑编译预览 / 语法检查，服务端 extractdoc 解码闸会先报「name 不能为空」，
 * 把这一刻真正该展示给用户的诊断（多半是表达式本身还没写）整个淹没——用户看到一句跟他当前动作
 * （正在起名，还没碰表达式）对不上的报错。
 */
export function fillEmptyStagingNamesForPreview(doc: V4ExtractNodeDocument): V4ExtractNodeDocument {
  if (!doc.staging_target) return doc;
  return {
    ...doc,
    staging_target: {
      ...doc.staging_target,
      columns: doc.staging_target.columns.map(c =>
        c.name.trim() === '' && c.column_id ? { ...c, name: c.column_id } : c
      )
    }
  };
}

/**
 * 本报表上下文表 → V4 report 绑定。instance_id 沿用编辑器的 bt* 别名（正向翻译
 * alias=instance_id 的约定天然闭环）；alias 取目录表名（查不到时沿用旧绑定别名，再退 instance_id）；
 * table_role 取编辑器标的角色（缺省沿用旧绑定，再退 main）。
 */
export function reportSourceBinding(t: SourceTable, ctx: V4ModelAdapterContext, prev?: V4SourceBinding): V4SourceBinding {
  const prevReport = prev && prev.kind === 'report' ? prev : undefined;
  const label = ctx.tableLabelOf?.({ app_id: t.app_id, template_id: t.template_id, data_table_id: t.data_table_id })?.trim();
  return {
    kind: 'report',
    instance_id: reportInstanceId(t),
    alias: label || prevReport?.alias || t.alias,
    table_id: t.data_table_id,
    table_role: (t.role === 'detail' ? 'detail' : t.role === 'main' ? 'main' : undefined) ?? prevReport?.table_role ?? 'main'
  };
}

/** 本报表上下文表的判定：is_context 且别名是编辑器的 bt* 或文档的 rpt-*（两种身份，见 reportInstanceId）。 */
export function isReportContextTable(t: SourceTable): boolean {
  return !!t.is_context && (t.alias.startsWith('bt') || t.alias.startsWith(REPORT_INSTANCE_PREFIX));
}

/** V4 报表来源实例 ID 前缀。 */
export const REPORT_INSTANCE_PREFIX = 'rpt-';

/**
 * 本报表上下文表的 V4 实例 ID。服务端保存闸要求 `rpt-<table_id>-<6位hex>`，
 * 编辑器侧的 bt* 别名只是「第 i 张本报表表」的索引，不能直接当实例 ID。这里按 table_id 派生一个
 * **确定性**的 6 位 hex（FNV-1a），同一张表在任何会话都得到同一个 ID——refs 里的
 * source_instance_id、关联的左右实例 ID 都据此稳定。已经是 rpt-* 形态（文档往返回来的）原样沿用。
 */
export function reportInstanceId(t: Pick<SourceTable, 'alias' | 'data_table_id'>): string {
  if (t.alias.startsWith(REPORT_INSTANCE_PREFIX)) return t.alias;
  return `${REPORT_INSTANCE_PREFIX}${t.data_table_id}-${fnv1a6(t.data_table_id)}`;
}

function fnv1a6(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6);
}

/** 从 rpt-<table_id>-<6hex> 反解 table_id（不是该形态返回 undefined）。 */
export function reportInstanceTableId(instanceId: string): string | undefined {
  if (!instanceId.startsWith(REPORT_INSTANCE_PREFIX)) return undefined;
  const body = instanceId.slice(REPORT_INSTANCE_PREFIX.length);
  const dash = body.lastIndexOf('-');
  return dash > 0 ? body.slice(0, dash) : undefined;
}

export const STAGING_INSTANCE_PREFIX = 'stg-';

/**
 *
 * producerNodeId 为空串时仍按同一公式生成、不抛错——这是「上一步暂存区」生产者信息缺失的异常
 * 形态（正常链路里 ctx.stagingProducerNodeId 恒非空），交给服务端保存闸按 producer_node_id
 * 校验去拦截，不在本纯函数里特判。
 */
export function stagingInstanceId(producerNodeId: string): string {
  return `${STAGING_INSTANCE_PREFIX}${producerNodeId}-${fnv1a6(producerNodeId)}`;
}

export const WRITE_TARGET_SOURCE_ALIAS_PREFIX = 'tgt-';

/** 见 WRITE_TARGET_SOURCE_ALIAS_PREFIX 注释：写模式「目标」相关来源的确定性别名（=V4 instance_id）。 */
export function targetSourceAlias(dataTableId: string): string {
  return `${WRITE_TARGET_SOURCE_ALIAS_PREFIX}${dataTableId}`;
}

/**
 * 判定一个别名（=V4 instance_id）是否属于写模式「目标」相关来源（is_write_target 语义）。
 *
 * 修法：`is_write_target` 不再是唯一判据来源——该标记原属**因**（有意登记为目标相关来源），但其
 * **可靠外部标志**是别名本身恒为 `tgt-<data_table_id>` 形态（targetSourceAlias 确定性派生，唯一
 * 登记入口 ExpressionEditor.vue upsertWriteTargetSource 恒用此形态起别名）——这一形态本身落在 V4
 * 文档的 instance_id 里，往返不丢。故所有"是否是目标相关来源"的判据（reconcileWriteTargetSources/
 * joinStatusOf/chip 展示/modelToV4Query 隐藏关联合成）改为「`is_write_target` 为真 **或** 别名匹配
 * 本判据」，双保险；`v4WriteDocToExpressionModel` 读入时额外按本判据把 `is_write_target` 重新打上
 * （见该函数），使其它只认 `is_write_target` 字段、暂未改判据的旧读者也能拿到正确值。
 */
export function isWriteTargetSourceAlias(alias: string): boolean {
  return alias.startsWith(WRITE_TARGET_SOURCE_ALIAS_PREFIX);
}

/** 恒真关联条件 `1 = 1`（服务端 v4/bind 按 join_on 绑定为合法谓词，SQL 渲染即 `ON 1 = 1`）。 */
export function alwaysTrueJoinOn(expressionID: string): V4ExpressionDocument {
  return { expression_id: expressionID, purpose: 'join_on', source_text: '1 = 1', refs: [] };
}

/**
 * 是否为「本报表上下文表的隐式关联」：ON 恒真且任一端是 kind=report 来源。
 *
 * 这类关联由本适配层写回时为「每个非根来源恰好被引入一次」补出（expressionModelToV4Doc 末尾「默认关联」段）
 * 或由 3.4 reconcile ② 的本报表主+明细自动关联落成（bothReport ⇒ 恒真 INNER），用户从未配过它——它是生成 IR /
 * 运行期的信息，**设计态不展示**。v4DocToExpressionModel
 * 据此不把它翻进 3.4 模型；用户为本报表表手配的真实 ON（非恒真）不在此列。
 */
export function isImplicitReportJoin(
  join: V4ExtractNodeDocument['query']['joins'][number],
  reportInstanceIds: ReadonlySet<string>
): boolean {
  return isDefaultJoinOn(join.on) && (reportInstanceIds.has(join.left_instance_id) || reportInstanceIds.has(join.right_instance_id));
}

/** 是否为本适配层补出的恒真默认关联（只认这一种形态；用户手写的 `1 = 1` 也同样可被真关联替代，无害）。 */
export function isDefaultJoinOn(on: V4ExpressionDocument | undefined): boolean {
  return !!on && on.source_text.replace(/\s+/g, '') === '1=1' && !(on.refs?.length);
}

/** 3.4 侧 sidecar 的固定填充值：V4 链路不消费 pack_revision/digest（它们是 3.4 lower-text 的
 *  版本与校验字段），但类型必填，故给稳定占位——绝不参与任何判等或校验。 */
const V4_SIDECAR_PACK_REVISION = 'alice-v4';
const V4_SIDECAR_DIGEST = '';

// ── 表达式：V4ExpressionDocument ⇄ ValueRef（文本走 text_source） ──────────────────────────────

/** V4 稳定引用 → 3.4 sidecar 引用项。两侧都是「稳定 ID + 显示标签」二元组，逐字对应。 */
function refsToTextSourceRefs(refs: V4ExpressionRefWire[] | undefined): TextSourceRef[] {
  return (refs ?? []).map(r => ({
    stable_id: (r as { ref_id?: string; stable_id?: string }).ref_id ?? (r as { stable_id?: string }).stable_id ?? '',
    // 标签两个名字都认：V4 wire 的字段叫 last_label（`[表].[字段]` 文本），3.4 sidecar 叫 label。
    // 编辑区按它给引用染类型色（kimpoSqlHighlight.buildRefKindMap）——只认 label 会让打开节点时
    // 所有引用退回通用引用色，与 v4ExpressionHostAdapter.toTextSourceRefs 同口径。
    label: (r as { label?: string }).label ?? (r as { last_label?: string }).last_label
  }));
}

/** V4 表达式文档 → 3.4 ValueRef（本体 raw 占位 + 原文挂 text_source）。 */
export function v4ExpressionToValueRef(
  expr: V4ExpressionDocument | undefined,
  ctx?: V4ModelAdapterContext
): ValueRef {
  const tokenized = expr?.source_text ?? '';
  // 显示用可读原文：有 restore 结果就用它，否则退回 token 化源码（见 readableTextOf 注释）。
  const text = expr && ctx?.readableTextOf ? ctx.readableTextOf(expr.expression_id, tokenized) : tokenized;
  const sidecar: TextSource = {
    text,
    pack_revision: V4_SIDECAR_PACK_REVISION,
    digest: V4_SIDECAR_DIGEST,
    refs: refsToTextSourceRefs(expr?.refs)
  };
  return { kind: 'raw', text, text_source: sidecar };
}

/** 3.4 ValueRef → V4 表达式文档。以 text_source.text 为准（恒表达式模式下用户编辑的就是它）；
 *  没有 sidecar 时退回 ValueRef.text（raw 本体），仍取不到则空串。
 *  refs 不在此处重建——绑定表由 host 层 tokenize 产出，本函数只负责搬运既有值（prev）或留空，
 *  交给保存前的 tokenize 统一刷新。
 */
export function valueRefToV4Expression(
  ref: ValueRef | undefined,
  expressionId: string,
  purpose: V4ExpressionDocument['purpose'],
  prev?: V4ExpressionDocument,
  ctx?: V4ModelAdapterContext
): V4ExpressionDocument {
  const text = ref?.text_source?.text ?? ref?.text ?? '';
  if (prev && isUneditedAgainstPrev(text, prev, ctx)) {
    // 文本未变：整份沿用上一份（token 形态源码 + 绑定表 + 摘要），不把已绑定的引用无谓清空。
    return {
      expression_id: expressionId,
      purpose,
      source_text: prev.source_text,
      refs: prev.refs,
      normalized_digest: prev.normalized_digest
    };
  }
  // 变了：以用户文本为准、绑定表留空，等保存前的 tokenize 重绑。
  return { expression_id: expressionId, purpose, source_text: text, refs: [], normalized_digest: undefined };
}

/** 「未编辑」判据：文本等于 prev 的 token 形态源码（restore 尚未返回 / 失败时正向翻译
 *  回退的就是它），或等于 prev 经 ctx.readableTextOf 的可读渲染（正向翻译交给编辑器的形态）。
 *  没给 readableTextOf 的调用方（老宿主 / 单测恒等实现）退回原口径。 */
function isUneditedAgainstPrev(text: string, prev: V4ExpressionDocument, ctx?: V4ModelAdapterContext): boolean {
  if (text === prev.source_text) return true;
  if (!ctx?.readableTextOf) return false;
  return text === ctx.readableTextOf(prev.expression_id, prev.source_text);
}

// ── 来源与关联 ────────────────────────────────────────────────────────────────────────────────

/** V4 来源绑定 → 3.4 来源表。alias 取 instance_id（见文件头「alias 一律取 instance_id」）。 */
function sourceBindingToTable(src: V4SourceBinding, ctx: V4ModelAdapterContext): SourceTable {
  if (src.kind === 'report') {
    return {
      alias: src.instance_id,
      source_type: 'template',
      template_id: ctx.templateId,
      data_table_id: src.table_id,
      // 本报表来源即「当前表单上下文」，3.4 侧用 is_context 表达同一语义。
      is_context: true,
      role: src.table_role
    };
  }
  if (src.kind === 'unit') {
    // 单位行来源只在服务端展开期合成，永远不会写进任何节点文档；这里收到即是数据损坏。
    throw new Error('unit 来源不应出现在节点文档中（只由服务端展开期合成）');
  }
  if (src.kind === 'staging') {
    // 暂存区来源：3.4 约定 template_id/data_table_id 恒空串、is_context 恒 false（见 SourceTable 注释）。
    // alias 仍取 instance_id（`stg-<producer_node_id>-<6hex>`）——与目录/本报表来源同一约定，保持
    // 「3.4 alias 即 V4 稳定标识」的全局规则不开例外；编辑器给用户看的显示名（暂存来源行 name）
    // 走 props.stagingSource.producerLabel 单独渲染，不经过这个 alias。往返因此稳定：反向翻译
    // （expressionModelToV4Doc）按 t.alias 是否已是 stg- 形态判定「是否已落库」，命中即原样沿用，
    // 不会因为 alias 恒等于 instance_id 而误判成「新加来源」重新派生一次。
    return {
      alias: src.instance_id,
      source_type: 'staging',
      template_id: '',
      data_table_id: '',
      is_context: false
    };
  }
  if (src.kind === 'view') {
    // 视图来源：3.4 约定 template_id/data_table_id 恒空串（视图不是模板数据表，
    // 见 types.ts SourceTable.view_id 字段注释），view_id/app_id 原样透传。alias 仍取 instance_id
    // （与其余来源同一「3.4 alias 即 V4 稳定标识」全局规则），显示名走 sourceDisplayName（编辑器侧
    // 按 view_id 另查视图名渲染，不经过这个 alias）。
    return {
      alias: src.instance_id,
      source_type: 'view',
      template_id: '',
      data_table_id: '',
      is_context: false,
      view_id: src.view_id,
      app_id: src.app_id || undefined
    };
  }
  if (src.kind === 'external') {
    // 外部数据表来源：3.4 约定 template_id/data_table_id
    // 恒空串（同 view 约定，见 types.ts SourceTable.external_object_id 字段注释），V4 的
    // external_stable_id 落 3.4 侧的 external_object_id（两侧字段名不同，语义同一个稳定标识）；
    // app_id 原样透传（V4 该分支必填，这里仍按 || undefined 写法与 view/catalog 分支保持同一形状，
    // 空字符串不会出现——服务端 schema 已拒绝空 app_id）。alias 仍取 instance_id（同一全局规则）。
    return {
      alias: src.instance_id,
      source_type: 'external',
      template_id: '',
      data_table_id: '',
      is_context: false,
      external_object_id: src.external_stable_id,
      app_id: src.app_id || undefined
    };
  }
  return {
    alias: src.instance_id,
    source_type: 'template',
    template_id: src.template_id,
    data_table_id: src.data_table_id,
    is_context: false,
    app_id: src.app_id || undefined
  };
}

/** V4 表达式里可能出现的比较算子（按长度倒序匹配，避免 `<` 抢在 `<=` 前面命中）。 */
const JOIN_OPS: Array<{ text: string; op: CompareOp }> = [
  { text: '<>', op: 'neq' },
  { text: '>=', op: 'gte' },
  { text: '<=', op: 'lte' },
  { text: '=', op: 'eq' },
  { text: '>', op: 'gt' },
  { text: '<', op: 'lt' }
];

/**
 * V4 关联 ON（表达式文本 + refs）→ 3.4 结构化谓词数组。
 *
 * 只认「若干条 `引用 算子 引用`、以 AND 相连」这一种形态——它正是 3.4 关联 UI 能表达的全集
 * （多条 `字段 op 字段` 取与）。认不出来（含函数调用、OR、常量比较等更复杂的表达式）时返回
 * undefined，调用方据此把 on 留空：3.4 UI 会显示「未关联」提示，用户可用结构化 UI 重配一条，
 * 而不是拿到一个被截断的错误结构。
 */
/** 一个操作数「恰好是单个引用占位」时返回其 ref_id，否则返回 undefined。
 *  占位的完整形态是 `[标签]#{rN}`——标签里不会出现 `]`（tokenize 侧保证），故可用非贪婪匹配。 */
function soleRefID(operand: string): string | undefined {
  const m = /^\s*\[[^\]]*\]#\{(r\d+)\}\s*$/.exec(operand);
  return m ? m[1] : undefined;
}

function joinOnToPredicates(
  on: V4ExpressionDocument | undefined,
  leftInstanceID: string,
  rightInstanceID: string
): JoinPredicate[] | undefined {
  const text = on?.source_text?.trim();
  if (!text || !on?.refs?.length) return undefined;
  const refByID = new Map(on.refs.map(r => [r.ref_id, r]));
  const clauses = text.split(/\s+AND\s+/i);
  const out: JoinPredicate[] = [];
  for (const clause of clauses) {
    // 算子按 JOIN_OPS 顺序（长的在前）取首个命中，避免 `<` 抢在 `<=` 前面。
    const hit = JOIN_OPS.find(o => clause.includes(o.text));
    if (!hit) return undefined;
    const cut = clause.indexOf(hit.text);
    // 两侧操作数必须**各自恰好是一个引用占位**：只数「占位个数 == 2」是不够的——
    // `UPPER([单号]#{r1}) = [单号]#{r2}` 同样是两个占位一个算子，却带着函数调用，
    // 按两元谓词降级会把 UPPER 静默丢掉，保存后语义就变了（本判据由往返单测钉住）。
    const lid = soleRefID(clause.slice(0, cut));
    const rid = soleRefID(clause.slice(cut + hit.text.length));
    if (!lid || !rid) return undefined;
    const l = refByID.get(lid);
    const r = refByID.get(rid);
    if (!l || !r) return undefined;
    // 字段可以为空：那是「用户刚点＋关联条件、还没选字段」的正常中间态（3.4 的 addOn 就是
    // push 一条 field_id='' 的空谓词）。此前这里把空字段当非法整条丢弃，而配置面的
    // ExpressionModel 是每次从权威 V4 文档重算的 computed——新加的空谓词往返一圈即被抹掉，
    // UI 上表现为「＋ 关联条件点了没反应」。保留空谓词，由保存闸在收口时拒绝未配完的关联。
    // 两种引用种类都要认：source_field 的实例在 source_instance_id 上，report_field 的本报表
    // 来源同样把实例记在 source_instance_id（多副本消歧用），取不到才回落到关联的左右实例。
    out.push({
      // field_id 缺省即空串：那是「刚加的条件行、还没选字段」的中间态，3.4 侧同样以空串表达。
      left: { alias: l.source_instance_id ?? leftInstanceID, field_id: l.field_id ?? '' },
      op: hit.op,
      right: { alias: r.source_instance_id ?? rightInstanceID, field_id: r.field_id ?? '' }
    });
  }
  return out.length ? out : undefined;
}

/**
 * 3.4 结构化谓词数组 → V4 关联 ON（token 形态文本 + refs）。
 *
 * 直接产出 token 化源码（`[标签]#{rN}`）与绑定表，**不经 tokenize**：结构化谓词里的
 * (alias=instance_id, field_id) 已经是绑定所需的全部信息，再让服务端按文本反查一遍既多一次
 * 往返、又可能因标签重名而失败。故保存收口时关联 ON 不参与 tokenize（见插件侧 finalize 实现）。
 */
function predicatesToJoinOn(
  preds: JoinPredicate[],
  expressionID: string,
  ctx: V4ModelAdapterContext
): V4ExpressionDocument {
  const refs: V4ExpressionRefWire[] = [];
  const parts: string[] = [];
  for (const p of preds) {
    const opText = JOIN_OPS.find(o => o.op === p.op)?.text ?? '=';
    const mk = (fr: { alias: string; field_id: string }): string => {
      const refID = `r${refs.length + 1}`;
      const label = ctx.fieldLabelOf?.(fr.alias, fr.field_id) ?? fr.field_id;
      const src = ctx.sourceOf?.(fr.alias);
      // fr.field_id 可能是空串（未配完的中间态，见 joinOnToPredicates 同款注释）——照样产出
      // 占位引用，使这条谓词能原样往返回来，不在编辑途中被抹掉。
      // 引用种类跟着来源种类走（见 V4ModelAdapterContext.sourceOf 注释）：本报表来源产
      // report_field 并带上 table_id（引擎按 table_id 查 Scope.Report），其余产 source_field——
      // 视图来源同目录来源一样落 source_field：服务端
      // ExpressionRefKind 并无独立的"视图字段"档位，按 source_instance_id 反查 Scope.Sources 即可
      // 定位到视图目录，关联 ON 里视图实例照常按这条通用分支参与，无需特判。
      // source_instance_id 两种都带：report_field 用它在同表多副本时消歧。
      // 暂存来源的字段引用是第三种种类：staging_field，按 staging_column_id 定位（引擎侧
      // toRefBinding 的三条路之一，查的是 Scope.Staging 而非 Sources/Report）。
      if (src?.kind === 'staging') {
        refs.push({
          ref_id: refID,
          kind: 'staging_field',
          source_instance_id: fr.alias,
          staging_column_id: fr.field_id,
          last_label: label
        });
        return `[${label}]#{${refID}}`;
      }
      refs.push(
        src?.kind === 'report'
          ? {
              ref_id: refID,
              kind: 'report_field',
              source_instance_id: fr.alias,
              table_id: src.table_id,
              field_id: fr.field_id,
              last_label: label
            }
          : {
              ref_id: refID,
              kind: 'source_field',
              source_instance_id: fr.alias,
              field_id: fr.field_id,
              last_label: label
            }
      );
      return `[${label}]#{${refID}}`;
    };
    const left = mk(p.left);
    const right = mk(p.right);
    parts.push(`${left} ${opText} ${right}`);
  }
  return {
    expression_id: expressionID,
    purpose: 'join_on',
    source_text: parts.join(' AND '),
    refs
  };
}

// ── 目录来源主+明细自动 record_id 关联─────────────────────────────────────────────
//
// 背景：3.4 reconcile ②「自动 record_id 关联」对同模板 `${template_id}::src` 分组（用户显式加入的
// 同模板主表+明细表，与本报表 `${template_id}::ctx` 分组同一段代码、只是 key 不同）同样产出
// `auto_record_id:true, on:[]` 的关联；但两者语义不同——ctx 分组两侧是运行期物化的临时表（无
// record_id 列可等，只能落 `1 = 1` 恒真 ON，见下方 bothReport 分支），src 分组两侧是真实数据表
// 实例，V4 目录已给每个 catalog 实例追加系统字段 sys:record_id（所有表）/ sys:parent_record_id
// （仅明细，另一张卡在改服务端目录）——理应按它们合成真正的父子关联，而不是回落 source_text=''
// 空洞。

/** V4 目录系统字段字面量（与服务端 V4 目录 wire 的 field_id 逐字对应，见 V4CatalogField.system 注释）。 */
const SYS_FIELD_RECORD_ID = 'sys:record_id';
const SYS_FIELD_PARENT_RECORD_ID = 'sys:parent_record_id';

/**
 * 目录主+明细自动 record_id 关联的 ON 谓词合成。
 *
 * 角色判定权威：3.4 `SourceTable.role`（src/types.ts:329），由 `tableRoleOf`（同文件 :137-144）
 * 在用户经 SourceTreePicker 加入来源时写入（见 ExpressionEditor.vue onSelectSources `role: it.role`）。
 * 必须恰好一主一明细，缺角色或两侧同角色时返回 undefined——调用方据此保持现状（沿用旧 ON /
 * 留空兜底）并打警告，绝不静默合成一个方向猜错的父子关联。
 *
 * 产出的谓词形态 `[明细].[parent_record_id] = [主表].[record_id]`（左=明细，右=主表，与 3.4 reconcile
 * ②「主表左、明细右」的既有关联方向一致，仅在 ON 表达式内部换成父子键比较）。
 */
function catalogRecordIdJoinPredicates(
  leftTable: SourceTable | undefined,
  rightTable: SourceTable | undefined,
  leftInstanceId: string,
  rightInstanceId: string
): JoinPredicate[] | undefined {
  if (!leftTable || !rightTable) return undefined;
  const leftIsMain = leftTable.role === 'main' && rightTable.role === 'detail';
  const rightIsMain = rightTable.role === 'main' && leftTable.role === 'detail';
  if (!leftIsMain && !rightIsMain) return undefined;
  const mainInstanceId = leftIsMain ? leftInstanceId : rightInstanceId;
  const detailInstanceId = leftIsMain ? rightInstanceId : leftInstanceId;
  return [
    {
      left: { alias: detailInstanceId, field_id: SYS_FIELD_PARENT_RECORD_ID },
      op: 'eq',
      right: { alias: mainInstanceId, field_id: SYS_FIELD_RECORD_ID }
    }
  ];
}

/**
 * 判定某关联 ON 是否为本适配层合成的「目录主+明细自动 record_id」关联（供反向 joinDefinitionToSpec
 * 识别回 auto_record_id:true，见该函数注释）：refs 恰好两条、字段分别是 sys:record_id 与
 * sys:parent_record_id（顺序不限）、种类均为 source_field，且文本是这两条引用的单条等式（不含
 * AND、不含函数调用——复用 joinOnToPredicates 同一颗粒度的「能否降级成单条等值谓词」判据）。
 * 判据只认字段字面量+形状，不认「是不是本适配层生成的」——用户在关联设计器里手动配出同样两个
 * 系统字段的等式，语义上就是这同一种父子关联，理应同等识别。
 */
function isCatalogRecordIdJoinOn(on: V4ExpressionDocument | undefined): boolean {
  const refs = on?.refs;
  if (!refs || refs.length !== 2) return false;
  if (!refs.every(r => r.kind === 'source_field')) return false;
  const fieldIds = refs.map(r => r.field_id).sort();
  if (fieldIds[0] !== SYS_FIELD_PARENT_RECORD_ID || fieldIds[1] !== SYS_FIELD_RECORD_ID) return false;
  // 形状必须真是「单条等式」——两个占位符恰好各出现一次、算子为 eq，防止「refs 恰好没清干净、
  // 文本却被改成别的形式（如 OR / 函数包裹）」的边缘态被误判成自动关联。
  const preds = joinOnToPredicates(on, '', '');
  return !!preds && preds.length === 1 && preds[0].op === 'eq';
}

/** V4 关联 → 3.4 关联。ON 尽量降级成结构化谓词（3.4 UI 能编辑的形态）；降不下来时留空，
 *  由 UI 提示未关联。auto_record_id 缺省 false（V4 无「自动 record_id 联合」语义，所有关联条件
 *  都显式写在 ON 里）；命中 isCatalogRecordIdJoinOn 时例外识别回 true 且 on 置空——
 *  否则这条本应由 3.4 reconcile 自动维护的父子关联会被当成手配谓词展示，用户一旦手改就再也回不到
 *  「自动」形态，且 reconcile ②「关联是否已存在」的判据（按 auto_record_id 而非 ON 内容）也会失灵、
 *  在下一次调和时重复补一条。 */
function joinDefinitionToSpec(join: V4ExtractNodeDocument['query']['joins'][number]): JoinSpec {
  const isCatalogAutoRecordId = isCatalogRecordIdJoinOn(join.on);
  return {
    left_alias: join.left_instance_id,
    right_alias: join.right_instance_id,
    join_type: join.join_type,
    auto_record_id: isCatalogAutoRecordId,
    on: isCatalogAutoRecordId ? undefined : joinOnToPredicates(join.on, join.left_instance_id, join.right_instance_id)
  };
}

/**
 * 目录来源角色回填。
 *
 * 角色从 join 自身的系统列引用推出，不查目录：isCatalogRecordIdJoinOn 已把该关联判定为「目录主+
 * 明细自动 record_id」关联（唯一携带角色信息之处）——带 sys:parent_record_id 引用的一侧是明细，
 * 另一侧（sys:record_id）是主表，与 catalogRecordIdJoinPredicates 合成时的方向定义一致。只在来源
 * 尚无 role 时回填，不覆盖 report/staging 来源已有的角色（它们各自的正向翻译已给出权威角色）。
 */
function applyCatalogRoleFromJoins(tables: SourceTable[], joins: V4ExtractNodeDocument['query']['joins']): void {
  const byInstanceId = new Map(tables.map(t => [t.alias, t])); // alias 即 instance_id（正向约定）
  for (const j of joins) {
    if (!isCatalogRecordIdJoinOn(j.on)) continue;
    for (const ref of j.on.refs) {
      const t = byInstanceId.get(ref.source_instance_id ?? '');
      if (!t || t.role) continue;
      if (ref.field_id === SYS_FIELD_PARENT_RECORD_ID) t.role = 'detail';
      else if (ref.field_id === SYS_FIELD_RECORD_ID) t.role = 'main';
    }
  }
}

// ── 目标 ──────────────────────────────────────────────────────────────────────────────────────

/** V4 输出 → 3.4 输出映射。fill_strategy/separator 两侧同名同义，直接透传。 */
function fillOutputToMapping(out: V4FillOutput, ctx: V4ModelAdapterContext): OutputMapping {
  return {
    target_field_id: out.target_field_id,
    expression: v4ExpressionToValueRef(out.expression, ctx),
    fill_strategy: out.fill_strategy,
    separator: out.separator
  };
}

/** V4 填充目标 → 3.4 目标。clear/auto_row_match 两侧逐字同构（ClearSpec 的注释原文即「V4 取数
 *  填充规格」），直接透传；target_template_id 取当前模板——取数的填充目标恒是本报表各表。 */
function fillTargetToSpec(target: V4FillTarget, ctx: V4ModelAdapterContext, options: V4QueryOptions): TargetSpec {
  return {
    target_template_id: ctx.templateId,
    target_data_table_id: target.target_data_table_id,
    target_table_role: target.table_role,
    outputs: target.outputs.map(o => fillOutputToMapping(o, ctx)),
    clear: target.clear,
    auto_row_match: target.auto_row_match,
    trim_empty_rows_after_fill: target.trim_empty_rows_after_fill,
    distinct: target.distinct ?? true,
    take: target.take === undefined ? options.take : target.take >= 1 ? target.take : undefined,
    // 逐目标排序（用户 2026-09-08：排序下拉此前是悬空控件，见文件头「排序」段）：V4 是权威侧，
    // 正向原样带进 3.4 目标供编辑器读；V4 没配时留 undefined（"本模型没编辑过排序"，反向回落上一版文档）。
    order_by: target.order_by
  };
}

// ── 图表目标 ─────────────────────────────────────────────────────────────────────────────────
// 两侧承载同一套语义，组织方式不同：3.4 的 mapping 是「按 form 判别的联合」（每种形态只带自己
// 用到的字段），V4 的 slots 是「扁平可选槽位」+ 顶层 layout/aggregate。故按 chart_form 分档互转。
// 位置也不同：3.4 的 chart_targets 挂在 TargetSpec 内，V4 挂在文档顶层——正向统一挂到首个目标上
// （3.4 的图表 tab 就从那里读），反向再收回顶层。

/** V4 图表目标 → 3.4 图表目标（表达式一律经 v4ExpressionToValueRef，走可读文本通道）。 */
function v4ChartToSpec(chart: V4ChartTarget, ctx: V4ModelAdapterContext): ChartTargetSpec {
  const e = (x: Parameters<typeof v4ExpressionToValueRef>[0]): ValueRef => v4ExpressionToValueRef(x, ctx);
  const base = { chart_id: chart.chart_id, row_limit: chart.row_limit };
  if (chart.chart_form === 'nameValue') {
    return {
      ...base,
      chart_form: 'nameValue',
      mapping: { form: 'nameValue', name: e(chart.slots.name), value: e(chart.slots.value), aggregate: chart.aggregate }
    };
  }
  if (chart.chart_form === 'points') {
    return {
      ...base,
      chart_form: 'points',
      mapping: {
        form: 'points',
        x: e(chart.slots.x),
        y: e(chart.slots.y),
        series: chart.slots.series ? e(chart.slots.series) : undefined
      }
    };
  }
  // categorySeries：wide 用 values[]（每项一系列），long 用 series+value 两列。
  const layout = chart.layout ?? 'wide';
  return {
    ...base,
    chart_form: 'categorySeries',
    mapping: {
      form: 'categorySeries',
      layout,
      category: e(chart.slots.category),
      values: layout === 'wide'
        ? (chart.slots.values ?? []).map(v => ({ name_key: v.name_key, expression: e(v.expression) }))
        : undefined,
      series: layout === 'long' && chart.slots.series ? e(chart.slots.series) : undefined,
      value: layout === 'long' && chart.slots.value ? e(chart.slots.value) : undefined,
      aggregate: chart.aggregate
    }
  };
}

/** 3.4 图表目标 → V4 图表目标。以 prev（同 chart_id 的旧值）为底，保住 V4 独有的 expression_id
 *  等绑定身份；表达式按槽位逐个回写（文本以 text_source 为准，同其余各段口径）。 */
function chartSpecToV4(spec: ChartTargetSpec, prev: V4ChartTarget | undefined, ctx: V4ModelAdapterContext): V4ChartTarget {
  const slotID = (slot: string): string => `chart:${spec.chart_id}:${slot}`;
  // 🔴 空槽位必须**缺席**，不能落成 source_text:'' 的空表达式（2026-09-07）：后端按槽位存在性判形态
  // （见 extractdoc.validateChartSlots），一个空壳表达式会被当成"该槽位已配置"，然后在表达式层报
  //「source_text 不能为空」——用户看到的是一句与他的操作对不上的错。可选槽位（动态系列的 series、
  // count 聚合下的 value）不填就是不填，缺席才是它的正确形状。
  const conv = (ref: ValueRef | undefined, slot: string, prevExpr?: V4ExpressionDocument) => {
    if (!ref) return undefined;
    // 判据与 valueRefToV4Expression 取文本的口径逐字一致（text_source.text → text → 空）：
    // 它算出来是空串的，落进文档就是 source_text:''，等价于没配。
    if (!(ref.text_source?.text ?? ref.text ?? '').trim()) return undefined;
    return valueRefToV4Expression(ref, prevExpr?.expression_id ?? slotID(slot), 'output', prevExpr, ctx);
  };
  const m = spec.mapping;
  if (m.form === 'nameValue') {
    return {
      chart_id: spec.chart_id,
      chart_form: 'nameValue',
      row_limit: spec.row_limit,
      aggregate: m.aggregate,
      slots: {
        name: conv(m.name, 'name', prev?.slots.name),
        value: conv(m.value, 'value', prev?.slots.value)
      }
    };
  }
  if (m.form === 'points') {
    return {
      chart_id: spec.chart_id,
      chart_form: 'points',
      row_limit: spec.row_limit,
      slots: {
        x: conv(m.x, 'x', prev?.slots.x),
        y: conv(m.y, 'y', prev?.slots.y),
        series: conv(m.series, 'series', prev?.slots.series)
      }
    };
  }
  const values: V4ChartValueSlot[] = (m.values ?? []).map((v, i) => ({
    name_key: v.name_key,
    expression: valueRefToV4Expression(
      v.expression,
      prev?.slots.values?.[i]?.expression.expression_id ?? slotID(`value${i}`),
      'output',
      prev?.slots.values?.[i]?.expression,
      ctx
    )
  }));
  return {
    chart_id: spec.chart_id,
    chart_form: 'categorySeries',
    layout: m.layout,
    row_limit: spec.row_limit,
    aggregate: m.aggregate,
    slots: {
      category: conv(m.category, 'category', prev?.slots.category),
      series: conv(m.series, 'series', prev?.slots.series),
      value: conv(m.value, 'value', prev?.slots.value),
      values: values.length ? values : undefined
    }
  };
}

// ── 正向：V4 文档 → 3.4 模型 ──────────────────────────────────────────────────────────────────

export function v4QueryToModelSource(
  query: V4QueryDefinition,
  ctx: V4ModelAdapterContext
): { source: SourceSpec; where_text_source?: TextSource } {
  const reportInstanceIds = new Set(query.sources.filter(s => s.kind === 'report').map(s => s.instance_id));
  const source: SourceSpec = {
    tables: query.sources.map(s => sourceBindingToTable(s, ctx)),
    joins: query.joins.filter(j => !isImplicitReportJoin(j, reportInstanceIds)).map(joinDefinitionToSpec)
  };
  // 目录来源角色回填：
  // 必须在 source.tables 构建完成之后执行——ExpressionEditor.vue reconcile ②按 role 判定主/明细，
  // role 缺失会让上面已正确合成的目录主+明细关联被当场剔除。
  applyCatalogRoleFromJoins(source.tables, query.joins);

  const filterTokenized = query.filter?.source_text ?? '';
  const filterText =
    query.filter && ctx.readableTextOf
      ? ctx.readableTextOf(query.filter.expression_id, filterTokenized)
      : filterTokenized;
  const where_text_source: TextSource | undefined = filterText
    ? {
        text: filterText,
        pack_revision: V4_SIDECAR_PACK_REVISION,
        digest: V4_SIDECAR_DIGEST,
        refs: refsToTextSourceRefs(query.filter?.refs)
      }
    : undefined;
  return { source, where_text_source };
}

/**
 * 把 V4 取数节点文档翻译成 ExpressionEditor 能直接消费的 ExpressionModel。
 *
 * schema_version 固定 2（3.4 当前模型代际）；筛选只产出 where_text_source（恒表达式模式下 UI
 * 读它显示原文），不产出引导式 where——与「V4 首版仅表达式输入」边界一致。
 */
export function v4DocToExpressionModel(
  doc: V4ExtractNodeDocument,
  ctx: V4ModelAdapterContext
): ExpressionModel {
  const { source, where_text_source } = v4QueryToModelSource(doc.query, ctx);

  const targets = doc.targets.map(t => fillTargetToSpec(t, ctx, doc.query.options));
  if (doc.staging_target) {
    targets.push({
      target_template_id: '',
      target_data_table_id: '',
      target_kind: 'staging',
      outputs: doc.staging_target.columns.map(c => ({
        target_field_id: c.column_id?.trim() || c.name,
        target_field_label: c.name,
        expression: v4ExpressionToValueRef(c.expression, ctx)
      }))
    });
  }
  // 3.4 的 target（单数）是必填字段，历史上代表「第一个目标」；多目标走 targets[]。
  const primaryTarget: TargetSpec = targets[0] ?? {
    target_template_id: ctx.templateId,
    target_data_table_id: '',
    outputs: []
  };

  const model: ExpressionModel = {
    schema_version: 2,
    source,
    target: primaryTarget,
    targets,
    distinct: doc.query.options.distinct,
    limit: doc.query.options.take
  };
  // 图表目标挂**顶层** model.chart_targets：这是 3.4 侧的权威位（modelTargets.writeTargets 每次
  // 回写都会把各 TargetSpec 内的 chart_targets 主动剥掉、只留顶层那一份 + model.target 上的兼容
  // 镜像）。此前写进 targets[0] 会被下一次 writeTargets 剥掉，用户新加的图表目标一往返即消失。
  if (doc.chart_targets?.length) {
    model.chart_targets = doc.chart_targets.map(c => v4ChartToSpec(c, ctx));
  }
  if (where_text_source) {
    model.where_text_source = where_text_source;
  }
  return model;
}

// ── 反向：3.4 模型 → V4 文档 ──────────────────────────────────────────────────────────────────

/**
 * 把编辑器改动过的 ExpressionModel 写回 V4 节点文档。
 *
 * 以 prev（改动前的 V4 文档）为底：V4 独有、3.4 模型无处安放的信息——instance_id 的种类
 * （catalog/report/staging）、用户改过的中文别名、关联的 ON 表达式文本、逐目标 order_by、图表
 * 目标——全部从 prev 按稳定标识回捞，只用模型里真正被编辑器改动的部分覆盖。这样即使 3.4 侧不认识
 * 某个 V4 字段，往返一次也不会把它丢掉。
 */
/**
 *
 * 修法：把「从不出现在任何 Join 右侧」的那条来源提到首位，其余顺序稳定不变（那正是根的定义）。
 * 找不到这样的来源时**原样返回**——那意味着环状引入或重复引入，是另一类真错误，交给服务端具名报错，
 * 不在这里悄悄改形状把问题盖掉。
 */
function withValidRoot(sources: V4SourceBinding[], joins: V4JoinDefinition[]): V4SourceBinding[] {
  if (sources.length < 2 || joins.length < 1) return sources;
  const introduced = new Set(joins.map(j => j.right_instance_id));
  const currentRoot = sources[0];
  if (!currentRoot || !introduced.has(currentRoot.instance_id)) return sources; // 根已合法
  const rootIndex = sources.findIndex(s => !introduced.has(s.instance_id));
  if (rootIndex < 1) return sources;
  const reordered = [...sources];
  const [root] = reordered.splice(rootIndex, 1);
  return root ? [root, ...reordered] : sources;
}

export function modelToV4Query(
  model: Pick<ExpressionModel, 'source' | 'where_text_source' | 'distinct' | 'limit'>,
  prevQuery: V4QueryDefinition,
  ctx: V4ModelAdapterContext
): V4QueryDefinition {
  const prevSourceById = new Map(prevQuery.sources.map(s => [s.instance_id, s]));
  const tables = model.source?.tables ?? [];
  const sources: V4SourceBinding[] = tables.map(t => {
    // alias 即 instance_id（正向约定）：命中即沿用原绑定（保住 kind/关联等 V4 独有信息）。
    // 目录来源的显示别名例外——每次回写都按当前目录重算（理由见 catalogSourceAlias 头注释）；
    // 查不到表名时 fallback=原别名，等价于原样沿用。
    const hit = prevSourceById.get(t.alias);
    // 3.4 编辑器物化出来的本报表上下文表（bt* 别名 + is_context，见 ExpressionEditor.reportAlias/reconcile）：
    // 落 V4 的 report 绑定（引擎按 table_id 查 Scope.Report，运行期物化为临时表）。显示别名按目录表名重算，
    // 与 ⊞/ƒ 写进文本的 `本报表.[表].[字段]` 表段逐字一致（服务端 resolveReportField 按 Label 匹配）。
    // 非 bt 前缀的 report 绑定（V4 原生编辑器/demo 产出的 rpt-* 实例）不经此路径，仍原样沿用 hit。
    if (isReportContextTable(t)) return reportSourceBinding(t, ctx, hit);
    if (hit) {
      if (hit.kind === 'catalog') return { ...hit, alias: catalogSourceAlias(t, tables, ctx, hit.alias) };
      if (hit.kind === 'view') return { ...hit, alias: viewSourceAlias(t, tables, ctx, hit.alias) };
      return hit;
    }
    if (t.source_type === 'staging') {
      const producerNodeID = ctx.stagingProducerNodeId ?? '';
      const instanceID = t.alias.startsWith(STAGING_INSTANCE_PREFIX) ? t.alias : stagingInstanceId(producerNodeID);
      return {
        kind: 'staging',
        instance_id: instanceID,
        // alias：显示别名，取上游生产者的显示名（与 catalogSourceAlias 同一原则，见
        // V4ModelAdapterContext.stagingProducerLabel 注释）；查不到时回退 t.alias，不擅自留空。
        alias: ctx.stagingProducerLabel?.trim() || t.alias,
        producer_node_id: producerNodeID,
        // output_schema_revision：producer 输出列集的修订号。首版固定 'v1'——引擎侧目前不做版本
        // 比对（无人写、无人读），留常量而不是伪造一个摘要，避免让它看起来像有语义。
        output_schema_revision: 'v1'
      };
    }
    // 编辑器新加的**视图来源**：3.4 侧的 SourceTable
    // 对 view 恒把 template_id/data_table_id 留空（见 ExpressionEditor.vue onSelectSources 视图
    // 分支、types.ts SourceTable.view_id 注释），落成 catalog 会产出 template/table 为空的非法
    // 绑定、被保存闸拒。instance_id 沿用 t.alias（与目录来源同一「新加来源用 alias 当 instance_id」
    // 全局规则）；显示别名按视图名重算（查不到时退回 t.alias，不用 instance_id 占位，原则同
    // catalogSourceAlias）；app_id 与目录来源同一兜底顺序——来源自带的 app_id 优先，取不到（当前
    // 应用的视图 picker 不下发）按 ctx.appId 补齐。
    if (t.source_type === 'view') {
      return {
        kind: 'view',
        instance_id: t.alias,
        alias: viewSourceAlias(t, tables, ctx, t.alias),
        app_id: t.app_id || ctx.appId || '',
        view_id: t.view_id ?? ''
      };
    }
    if (t.source_type === 'external') {
      return {
        kind: 'external',
        instance_id: t.alias,
        alias: t.alias,
        app_id: t.app_id || ctx.appId || '',
        external_stable_id: t.external_object_id ?? ''
      };
    }
    // 其余新加来源：3.4 侧只能给出 template/table 身份，一律落 catalog 种类；显示别名按目录表名
    // 重算（查不到时才退回 instance_id 占位；本报表来源不经此路径新增，由 V4 侧自己的入口产出）。
    return {
      kind: 'catalog',
      instance_id: t.alias,
      alias: catalogSourceAlias(t, tables, ctx, t.alias),
      // 跨应用来源带 app_id；当前应用的表 picker 不给，按 ctx.appId 补齐（见 V4ModelAdapterContext.appId）。
      app_id: t.app_id || ctx.appId || '',
      template_id: t.template_id,
      data_table_id: t.data_table_id
    };
  });

  // 3.4 别名 → V4 实例 ID（目录/暂存来源两者相同；本报表上下文表 bt* → rpt-*，见 reportInstanceId）。
  const instanceIdOf = new Map<string, string>();
  tables.forEach((t, i) => instanceIdOf.set(t.alias, sources[i].instance_id));
  const idOf = (alias: string): string => instanceIdOf.get(alias) ?? alias;
  const isReportInstance = (id: string): boolean => sources.some(s => s.instance_id === id && s.kind === 'report');
  // 按 instance_id 反查来源绑定（种类 + template_id）：目录主+明细自动 record_id 关联
  // 要判定「两侧都是同模板 catalog 实例」，见下方 bothCatalogSameTemplate。
  const sourceById = new Map(sources.map(s => [s.instance_id, s]));
  const ctxForJoinOn: V4ModelAdapterContext = { ...ctx, sourceOf: alias => sourceById.get(alias) ?? ctx.sourceOf?.(alias) };

  const prevJoinByPair = new Map(
    prevQuery.joins.map(j => [`${j.left_instance_id}\u0000${j.right_instance_id}`, j])
  );
  const joins = (model.source?.joins ?? []).map((j, idx) => {
    const leftId = idOf(j.left_alias);
    const rightId = idOf(j.right_alias);
    const hit = prevJoinByPair.get(`${leftId}\u0000${rightId}`);
    const expressionID = hit?.on.expression_id ?? `join:${leftId}:${rightId}`;
    // ON 以编辑器里的结构化谓词为准：有谓词就重新生成 token 形态；一条都没有（用户还没配、或
    // 正向降级失败导致 UI 上是空的）时沿用旧 ON——避免把降不下来的复杂表达式在用户没碰它的
    // 情况下抹掉。
    // 本报表主+明细的自动 record_id 关联（3.4 reconcile ②，on 恒空）：V4 的本报表材料已按锚定行收窄
    //，两张临时表之间不需要也没有 record_id 列可等——
    // 落成恒真 ON 的 INNER JOIN（cross 语义），与下方默认关联同一口径。
    const bothReport = isReportInstance(leftId) && isReportInstance(rightId);
    const leftSrc = sourceById.get(leftId);
    const rightSrc = sourceById.get(rightId);
    const bothCatalogSameTemplate =
      !bothReport &&
      leftSrc?.kind === 'catalog' &&
      rightSrc?.kind === 'catalog' &&
      leftSrc.template_id === rightSrc.template_id;
    let catalogAutoOn: V4ExpressionDocument | undefined;
    if (j.auto_record_id && !(j.on && j.on.length) && bothCatalogSameTemplate) {
      if (hit && isCatalogRecordIdJoinOn(hit.on)) {
        // 往返稳定（doc→model→doc）：上一份文档的这条关联已是本适配层合成的形态，原样复用——
        // 3.4 模型翻译回目录 SourceTable 时不携带 role（V4SourceBindingCatalog 无 table_role 字段，
        // 见 sourceBindingToTable），纯往返场景下方 catalogRecordIdJoinPredicates 会因查不到角色
        // 而误判，此处优先信任「上一份文档已经是合法自动关联」这一更强的事实，不重新生成。
        catalogAutoOn = hit.on;
      } else {
        const leftTable = tables.find(t => t.alias === j.left_alias);
        const rightTable = tables.find(t => t.alias === j.right_alias);
        const preds = catalogRecordIdJoinPredicates(leftTable, rightTable, leftId, rightId);
        if (preds) {
          catalogAutoOn = predicatesToJoinOn(preds, expressionID, ctxForJoinOn);
        } else {
          // 角色缺失或两侧同角色：不合成，落到下方 hit?.on 兜底，只记警告——静默合成一个方向
          // 猜错的父子关联比「保存时报 ON 为空让用户重配」更危险。
          console.warn(
            '[expression-editor/v4] 目录来源自动 record_id 关联角色缺失或不成一主一明细，跳过 ON 合成' +
              `（left=${j.left_alias} right=${j.right_alias} template=${leftSrc?.template_id ?? ''}）`
          );
        }
      }
    }
    const translatedOn = j.on?.map(p => ({
      left: { alias: idOf(p.left.alias), field_id: p.left.field_id },
      op: p.op,
      right: { alias: idOf(p.right.alias), field_id: p.right.field_id }
    }));
    const on =
      translatedOn && translatedOn.length
        ? predicatesToJoinOn(translatedOn, expressionID, ctxForJoinOn)
        : bothReport && j.auto_record_id
          ? alwaysTrueJoinOn(expressionID)
          : catalogAutoOn ?? (hit?.on ?? { expression_id: expressionID, purpose: 'join_on' as const, source_text: '', refs: [] });
    return {
      join_id: hit?.join_id ?? `${leftId}:${rightId}`,
      sequence: idx + 1,
      left_instance_id: leftId,
      right_instance_id: rightId,
      join_type: (bothReport && j.auto_record_id ? 'inner' : j.join_type) as 'inner' | 'left',
      on
    };
  });
  // 默认关联：
  // V4 的 Join 图要求每个非根来源恰好被一条关联引入，而 3.4 里本报表上下文表
  // 是「参数」不是 FROM 项，用户从不为它配关联。这里给每个尚未被引入的 report 来源补一条从根来源出发、
  // ON 恒真（`1 = 1`）的 INNER JOIN：主表恒 0/1 行时与「拿当前表单值当参数」等价，明细 N 行即锚定行语义。
  // 用户若在关联设计器里显式配了含该表的关联，则以用户的为准（此处只补缺）。
  // 悬空关联剔除：本报表引用被清掉后调和剔除了 report 来源，但正向翻译落进 3.4 模型
  // 的那条默认关联（`1 = 1`，降不成结构化谓词故 on 为空）仍留在 model.source.joins 里 ⇒ 回写出
  // 「Join 右侧不在来源清单内」。两侧任一实例不在本次 sources 里的关联一律不回写——服务端本就会拒。
  const instanceSet = new Set(sources.map(s => s.instance_id));
  const liveJoins = joins.filter(j => instanceSet.has(j.left_instance_id) && instanceSet.has(j.right_instance_id));
  // 默认关联去重：用户后来在关联设计器里为同一 report 来源配了真关联时，早先补的恒真默认关联让位
  //（同一非根来源必须恰好被引入一次）。
  const introducedCount = new Map<string, number>();
  for (const j of liveJoins) introducedCount.set(j.right_instance_id, (introducedCount.get(j.right_instance_id) ?? 0) + 1);
  joins.length = 0;
  joins.push(
    ...liveJoins.filter(j => !(isDefaultJoinOn(j.on) && (introducedCount.get(j.right_instance_id) ?? 0) > 1))
  );
  joins.forEach((j, i) => { j.sequence = i + 1; });

  const writeTargetInstanceIds = new Set<string>();
  tables.forEach((t, i) => {
    if (t.is_write_target || isWriteTargetSourceAlias(t.alias)) writeTargetInstanceIds.add(sources[i].instance_id);
  });
  const pairedWriteTargetInstanceIds = new Set<string>();
  for (const j of joins) {
    if (writeTargetInstanceIds.has(j.left_instance_id) && writeTargetInstanceIds.has(j.right_instance_id)) {
      pairedWriteTargetInstanceIds.add(j.left_instance_id);
      pairedWriteTargetInstanceIds.add(j.right_instance_id);
    }
  }

  // 🔴 根必须在补默认关联**之前**定下来：这段合成是「从根出发引入尚未被引入的
  // report 来源」，根选错就会给本该当根的那张表补一条反向关联，与用户已有的关联凑成环——之后再想
  // 归一根也找不到「从不出现在任何 Join 右侧」的来源了。先归一，再合成。
  const orderedSources = withValidRoot(sources, joins);
  const rootId = orderedSources[0]?.instance_id;
  const introduced = new Set(joins.map(j => j.right_instance_id));
  for (const s of orderedSources) {
    const needsHiddenDefaultJoin = s.kind === 'report' || pairedWriteTargetInstanceIds.has(s.instance_id);
    if (!needsHiddenDefaultJoin || s.instance_id === rootId || introduced.has(s.instance_id) || !rootId) continue;
    const expressionID = `join:${rootId}:${s.instance_id}`;
    const hit = prevJoinByPair.get(`${rootId}\u0000${s.instance_id}`);
    const reusablePlaceholder = hit?.on && isDefaultJoinOn(hit.on) ? hit.on : undefined;
    joins.push({
      join_id: hit?.join_id ?? `${rootId}:${s.instance_id}`,
      sequence: joins.length + 1,
      left_instance_id: rootId,
      right_instance_id: s.instance_id,
      join_type: 'inner',
      on: reusablePlaceholder ?? alwaysTrueJoinOn(expressionID)
    });
    introduced.add(s.instance_id);
  }

  const filterText = model.where_text_source?.text ?? '';
  return {
    sources: orderedSources,
    joins,
    filter: filterText
      ? valueRefToV4Expression(
          { kind: 'raw', text: filterText, text_source: model.where_text_source },
          prevQuery.filter?.expression_id ?? 'filter',
          'filter',
          prevQuery.filter,
          ctx
        )
      : undefined,
    options: {
      ...prevQuery.options,
      distinct: model.distinct ?? false,
      take: model.limit
    }
  };
}

/**
 * 把编辑器改动过的 ExpressionModel 写回 V4 取数节点文档。query 段（来源/关联/筛选/选项）经
 * modelToV4Query 翻译，目标段（填充目标/暂存目标/图表目标）是取数节点专属信息，仍在本函数内处理。
 */
export function expressionModelToV4Doc(
  model: ExpressionModel,
  prev: V4ExtractNodeDocument,
  ctx: V4ModelAdapterContext
): V4ExtractNodeDocument {
  const query = modelToV4Query(model, prev.query, ctx);

  const prevTargetByTable = new Map(prev.targets.map(t => [t.target_data_table_id, t]));
  // 暂存目标（target_kind='staging'，target_data_table_id 恒空）不进 targets——V4 把它放在文档
  // 顶层的 staging_target 上（形状见 nodeDocument.ts）。此处只把表目标挑出来，暂存目标在下方
  // 单独翻译；两者列的语义也不同：填充目标写真实字段 ID，暂存目标写编辑器生成的 column_id
  //。
  const tableTargets = (model.targets ?? [model.target])
    .filter(Boolean)
    .filter(t => t.target_kind !== 'staging' && t.target_data_table_id);
  const stagingTargetSpec = (model.targets ?? []).find(t => t?.target_kind === 'staging');
  const targets: V4FillTarget[] = tableTargets.map((t, idx) => {
    const hit = prevTargetByTable.get(t.target_data_table_id);
    const prevOutputByField = new Map((hit?.outputs ?? []).map(o => [o.target_field_id, o]));
    const autoMatchFieldIds = t.auto_row_match ? new Set((t.match_keys ?? []).map(k => k.form_field_id)) : null;
    return {
      target_id: hit?.target_id ?? `tgt-${t.target_data_table_id || idx}`,
      target_data_table_id: t.target_data_table_id,
      table_role: (t.target_table_role as V4FillTarget['table_role']) ?? hit?.table_role ?? 'main',
      outputs: (t.outputs ?? []).map(o => {
        const prevOut = prevOutputByField.get(o.target_field_id);
        let strategy = (o.fill_strategy as V4FillOutput['fill_strategy']) ?? prevOut?.fill_strategy ?? 'overwrite';
        if (autoMatchFieldIds?.has(o.target_field_id)) strategy = 'row_match';
        return {
          target_field_id: o.target_field_id,
          label: prevOut?.label,
          expression: valueRefToV4Expression(
            o.expression,
            prevOut?.expression.expression_id ?? `out:${t.target_data_table_id}:${o.target_field_id}`,
            'output',
            prevOut?.expression,
            ctx
          ),
          fill_strategy: strategy,
          separator: strategy === 'merge' ? (o.separator ?? prevOut?.separator) : undefined
        };
      }),
      clear: t.clear,
      auto_row_match: t.auto_row_match,
      trim_empty_rows_after_fill: t.trim_empty_rows_after_fill,
      distinct: t.distinct ?? true,
      take: typeof t.take === 'number' && Number.isFinite(t.take) && Math.floor(t.take) >= 1 ? Math.floor(t.take) : 0,
      // 逐目标排序（用户 2026-09-08 改判）：此前是「编辑器改不到它，原样保留 hit?.order_by」——
      // 而③目标字段行的「排序」下拉写的是 3.4 顶层 order_by，两边根本不通，用户设的排序保存即丢。
      // 现在下拉直接读写本目标的 order_by（见 ExpressionEditor.vue sortDirForIn/setSortIn），这里按它回写：
      // 有数组就以数组为准（空数组=用户清空了排序，折成 undefined 走 omitempty）；整键缺省才回落上一版
      // 文档（非 V4 路径 / 未经本编辑器的模型，不能误删存量排序）。
      order_by: t.order_by ? (t.order_by.length > 0 ? t.order_by : undefined) : hit?.order_by
    };
  });

  const next: V4ExtractNodeDocument = {
    ...prev,
    query,
    targets,
    // 图表目标：3.4 挂在首个目标内，收回文档顶层（见「图表目标」段注释）。首个目标不带
    // chart_targets 时保留 prev 的——编辑器在只渲染填充目标的场景下不会产出该字段，
    // 此时不能把已配好的图表当成「用户删掉了」。
    // 暂存目标：3.4 用 outputs[].target_field_id 承载 column_id（稳定键），
    // outputs[].target_field_label 承载显示名；V4 用 staging_target.columns[].column_id/name 对应。
    // 没有暂存目标时置 undefined（而非保留 prev）——它不像图表目标那样可能"编辑器没渲染所以没产出"，
    // ③目标段恒会把暂存目标一并回写。
    staging_target: stagingTargetSpec
      ? {
          columns: (stagingTargetSpec.outputs ?? []).map(o => {
            // 按 column_id 命中旧列（唯一权威定位键）；存量 prev（无 column_id）按 name===target_field_id
            // 回落一次——3.4 正向翻译时存量文档的 target_field_id 就是回填的 name，两者当时相等。
            const prevCol =
              prev.staging_target?.columns.find(c => (c.column_id ?? c.name) === o.target_field_id) ??
              prev.staging_target?.columns.find(c => c.name === o.target_field_id);
            return {
              column_id: o.target_field_id,
              name: o.target_field_label !== undefined ? o.target_field_label.trim() : o.target_field_id,
              expression: valueRefToV4Expression(
                o.expression,
                prevCol?.expression.expression_id ?? `stg:${o.target_field_id}`,
                'output',
                prevCol?.expression,
                ctx
              )
            };
          })
        }
      : undefined,
    chart_targets: (() => {
      // 顶层是权威位（见正向同款注释）；顶层缺省时退回 model.target 上的兼容镜像。
      const specs = model.chart_targets ?? model.target?.chart_targets;
      if (!specs) return prev.chart_targets;
      const prevByID = new Map((prev.chart_targets ?? []).map(c => [c.chart_id, c]));
      return specs.map(sp => chartSpecToV4(sp, prevByID.get(sp.chart_id), ctx));
    })()
  };
  return next;
}

/** 供只读展示/测试用的空条件组（V4 无引导式条件，本常量只在需要一个合法 ConditionGroup 占位时用）。 */
export const EMPTY_CONDITION_GROUP: ConditionGroup = { logic: 'and', items: [] };
