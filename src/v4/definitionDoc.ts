/**
 *
 * 本文件不发任何网络请求：tokenize（表达式原文 → 持久化用 token 化源码）/restore（token 化源码 →
 * 当前目录下可读文本）均由调用方（alice-v4-demo.vue）先行调用，把逐表达式的结果作为参数传入/传出——
 * buildDefinition/applyDefinitionToState 保持同步纯函数，vitest 直接断言输入输出即可，不需要 mock
 * fetch，也不需要挂载组件。
 *
 * expression_id 约定（与页面既有"表达式输入框"槽位 key 惯例对齐，一处定义两处复用：既是 tokenize/
 * restore 结果按表达式归位的 key，也是 ExtractDefinitionV4.$defs.ExpressionDocument.expression_id）：
 *   关联 ON = `join:<left_instance_id>:<right_instance_id>`；筛选 = `filter`；
 *   输出列 = `output:<target_field_id>`。
 */
import type {
  V4ExpressionDocument,
  V4ExpressionRefWire,
  V4ExtractDefinition,
  V4SourceBinding,
  V4SourceBindingCatalog
} from './definition';

/** 关联 ON 表达式的稳定 expression_id。 */
export function joinExpressionId(leftInstanceId: string, rightInstanceId: string): string {
  return `join:${leftInstanceId}:${rightInstanceId}`;
}

/** 输出列表达式的稳定 expression_id。 */
export function outputExpressionId(targetFieldId: string): string {
  return `output:${targetFieldId}`;
}

/** 筛选表达式的稳定 expression_id（唯一，无需按参数派生）。 */
export const FILTER_EXPRESSION_ID = 'filter';

/** 生成一个新的定义 ID（`def_` + 8 位随机 hex）：首次保存草稿时页面调用一次，之后沿用同一个 ID。
 *  优先用 crypto.getRandomValues（浏览器环境恒可用）；退回 Math.random 仅作兜底，不追求密码学强度
 *  ——definition_id 只是一个不需要保密的稳定标识符，冲突概率对 demo 页可忽略。 */
export function generateDefinitionId(): string {
  const bytes = new Uint8Array(4);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `def_${hex}`;
}

/** 生成一个新的暂存列稳定键：编辑器新增暂存列时调用
 *  一次，之后改显示名不再重生成；必须满足 `^[A-Za-z0-9_]+$`（唯一进临时表 DDL 的物理列名）。
 *  实现照抄 generateDefinitionId（同一套 crypto.getRandomValues/Math.random 回落写法），仅前缀不同。 */
export function generateStagingColumnId(): string {
  const bytes = new Uint8Array(4);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `col_${hex}`;
}

/** 组装 ExtractDefinitionV4 所需的输入：来源/关联/筛选/输出均已完成 tokenize（拿到 source_text+refs）。 */
export interface BuildDefinitionInput {
  definitionId: string;
  /** 上次保存返回的 revision；首次保存传 0（服务端按"首存/缺省"口径处理）。 */
  revision: number;
  label: string;
  /** 选中的来源实例 ID（首个为根）。 */
  sourceIds: string[];
  /** 当前目录的来源列表（用于按 instance_id 查出 alias/app_id/template_id/data_table_id 组装
   *  SourceBinding；catalog 未就绪或某个来源查不到时退回占位串，不让 undefined 落进请求体）。 */
  catalogSources: Array<{
    instance_id: string;
    alias: string;
    app_id?: string;
    template_id?: string;
    data_table_id?: string;
  }>;
  /** 恰好 0 或 1 条目录对目录关联（demo 页最多两个目录来源，故最多一条）。 */
  join: {
    leftInstanceId: string;
    rightInstanceId: string;
    joinType: 'inner' | 'left';
    doc: V4ExpressionDocument;
  } | null;
  /** 无筛选文本时传 null（filter 字段可选，缺省表示无业务 WHERE）。 */
  filterDoc: V4ExpressionDocument | null;
  /** 临时源（本报表/暂存表作为来源，D 卡新增）：与 catalogSources 分开传入——这些不是目录来源，
   *  没有 app_id/template_id/data_table_id 概念；kind='staging' 时 tableId/tableRole 不携带
   *  （producer_node_id/output_schema_revision 由 buildDefinition 内部固定填充）。 */
  tempSources?: Array<{
    instanceId: string;
    kind: 'report' | 'staging';
    alias: string;
    tableId?: string;
    tableRole?: 'main' | 'detail';
  }>;
  /** 追加关联（D 卡新增）：每个临时源对应恰好一条，right_instance_id 恒为该临时源实例 ID；
   *  留空 onText 的临时源在 collectExpressionDocsForSave 阶段已被跳过，不会出现在这里。追加顺序即
   *  join_id/sequence 的分配顺序（紧接在 join 之后，从当前 sequence 继续递增）。 */
  tempJoins?: Array<{
    leftInstanceId: string;
    rightInstanceId: string;
    joinType: 'inner' | 'left';
    doc: V4ExpressionDocument;
  }>;
  /** 已按"非空行"过滤好的输出列（调用方保证 tokenize 全部成功后才走到这里）；label 为该行显示名
   *  （D 卡追加，可选）——留空/未提供时不写进 definition，服务端编译时回退 target_field_id。 */
  outputs: Array<{ targetFieldId: string; doc: V4ExpressionDocument; label?: string }>;
  distinct: boolean;
  /** 仅前 N 条（查询选项卡新增）：0/undefined 均视为"不限"，不写进 definition.options.take。 */
  take?: number;
  /** 排序（查询选项卡新增）：空数组/undefined 均视为"不排序"，不写进 definition.options.order_by。 */
  orderBy?: Array<{ targetFieldId: string; direction: 'asc' | 'desc' }>;
}

const PLACEHOLDER_IDENTITY = '';

/** 组装 ExtractDefinitionV4（服务端 schema：extract_definition_v4.schema.json）。纯函数，不做业务
 *  合法性校验（如"至少一个输出"）——那类校验属调用方在收集 outputs 阶段的职责。 */
export function buildDefinition(input: BuildDefinitionInput): V4ExtractDefinition {
  const catalogSources: V4SourceBindingCatalog[] = input.sourceIds.map(id => {
    const src = input.catalogSources.find(s => s.instance_id === id);
    return {
      kind: 'catalog',
      instance_id: id,
      alias: src?.alias ?? id,
      app_id: src?.app_id ?? PLACEHOLDER_IDENTITY,
      template_id: src?.template_id ?? PLACEHOLDER_IDENTITY,
      data_table_id: src?.data_table_id ?? PLACEHOLDER_IDENTITY
    };
  });
  // 临时源（D 卡）：report/staging 两个变体，staging 的 producer_node_id/output_schema_revision
  // 首版固定常量，不接受调用方传入。
  const tempSources: V4SourceBinding[] = (input.tempSources ?? []).map(t =>
    t.kind === 'report'
      ? {
          kind: 'report' as const,
          instance_id: t.instanceId,
          alias: t.alias,
          table_id: t.tableId ?? '',
          table_role: t.tableRole ?? 'main'
        }
      : {
          kind: 'staging' as const,
          instance_id: t.instanceId,
          alias: t.alias,
          producer_node_id: 'staging_area',
          output_schema_revision: 'v1'
        }
  );
  const sources: V4SourceBinding[] = [...catalogSources, ...tempSources];

  const joins: V4ExtractDefinition['joins'] = [];
  let sequence = 1;
  if (input.join) {
    joins.push({
      join_id: `join_${sequence}`,
      sequence,
      left_instance_id: input.join.leftInstanceId,
      right_instance_id: input.join.rightInstanceId,
      join_type: input.join.joinType,
      on: input.join.doc
    });
    sequence += 1;
  }
  for (const tj of input.tempJoins ?? []) {
    joins.push({
      join_id: `join_${sequence}`,
      sequence,
      left_instance_id: tj.leftInstanceId,
      right_instance_id: tj.rightInstanceId,
      join_type: tj.joinType,
      on: tj.doc
    });
    sequence += 1;
  }

  return {
    schema_version: 'alice.extract/v4',
    syntax_profile: 'kimposql.mssql/v1',
    definition_id: input.definitionId,
    revision: input.revision,
    label: input.label,
    sources,
    joins,
    ...(input.filterDoc ? { filter: input.filterDoc } : {}),
    outputs: input.outputs.map(o => ({
      target_field_id: o.targetFieldId,
      expression: o.doc,
      // 空串不写：label 是可选显示名，未提供/全空白时不落进 definition（服务端回退 target_field_id）。
      ...(o.label?.trim() ? { label: o.label } : {})
    })),
    options: {
      distinct: input.distinct,
      // business_timezone 恒为常量 'UTC'（后端约定：非 UTC 会被拒绝保存），不再接受调用方传入。
      business_timezone: 'UTC',
      // take/order_by 均按 omitempty 语义：0/undefined/空数组不写键，交由服务端按缺省口径处理。
      ...(input.take ? { take: input.take } : {}),
      ...(input.orderBy?.length
        ? { order_by: input.orderBy.map(o => ({ target_field_id: o.targetFieldId, direction: o.direction })) }
        : {})
    }
  };
}

/** expression_id → 已还原可读文本 的映射表。调用方需对 definition 内出现的每个 ExpressionDocument
 *  调一次 restore，把结果按 expression_id 收集成这张表后传入 applyDefinitionToState。 */
export type RestoredTextMap = Record<string, string>;

export interface ApplyDefinitionResult {
  definitionId: string;
  revision: number;
  label: string;
  /** 首个为根，与页面 selectedSourceIds 同口径；D 卡追加批次后仅含目录来源（kind='catalog'），
   *  临时源（本报表/暂存表）改走下方 tempSources 单独回填，不再混进这个数组。 */
  sourceIds: string[];
  /** 无目录对目录关联时为 null（demo 页最多两个目录来源，故最多一条）。refs 为该表达式自己的稳定
   *  引用绑定表（D 卡第三刀：#{rN} 是逐表达式命名空间，不能与筛选/输出共用一份，须随文本一起原样带回，
   *  供重开后的 diagnose/compile/execute/再次 tokenize 使用）。判定口径（D 卡）：definition.joins 里
   *  right_instance_id 不属于任何临时源实例的那一条即目录对目录关联，不依赖数组下标/sequence。 */
  join: {
    leftInstanceId: string;
    rightInstanceId: string;
    joinType: 'inner' | 'left';
    text: string;
    refs: V4ExpressionRefWire[];
  } | null;
  /** 临时源回填（D 卡新增）：从 sources 里 kind !== 'catalog' 的项还原；staging 变体不回填
   *  tableId/tableRole（该来源不适用）。 */
  tempSources: Array<{
    instanceId: string;
    kind: 'report' | 'staging';
    alias: string;
    tableId?: string;
    tableRole?: 'main' | 'detail';
  }>;
  /** 追加关联回填（D 卡新增）：definition.joins 里 right_instance_id 属于某个临时源实例的那些条目，
   *  按原顺序带回。 */
  tempJoins: Array<{
    leftInstanceId: string;
    rightInstanceId: string;
    joinType: 'inner' | 'left';
    text: string;
    refs: V4ExpressionRefWire[];
  }>;
  /** 无筛选表达式时为空串。 */
  filterText: string;
  /** 筛选表达式自己的稳定引用绑定表（无筛选时为空数组），道理同 join.refs。 */
  filterRefs: V4ExpressionRefWire[];
  /** label 透传自 definition（D 卡追加，可选）——未提供时由调用方回退到默认占位显示名；
   *  refs 为该输出行自己的稳定引用绑定表，道理同 join.refs。 */
  outputs: Array<{ targetFieldId: string; text: string; label?: string; refs: V4ExpressionRefWire[] }>;
  /** 查询选项（查询选项卡新增）：take 无持久化值时回填 null（与页面「不限」态同口径），
   *  orderBy 无持久化值时回填空数组。 */
  options: {
    distinct: boolean;
    take: number | null;
    orderBy: Array<{ targetFieldId: string; direction: 'asc' | 'desc' }>;
  };
}

/** 把 ExtractDefinitionV4 + 已还原文本表 拆解为页面可直接赋值的状态（来源勾选/关联/筛选/输出）。
 *  找不到对应 expression_id 的还原文本时退回空字符串——理论上调用方应保证还原表齐全，这里只是防御性
 *  兜底，避免个别还原失败（如网络错误未被上游捕获）时把 undefined 灌进 v-model。 */
export function applyDefinitionToState(
  definition: V4ExtractDefinition,
  restored: RestoredTextMap
): ApplyDefinitionResult {
  // 临时源：sources 里 kind !== 'catalog' 的项（D 卡）。
  const tempSources = definition.sources
    .filter(s => s.kind !== 'catalog')
    .map(s =>
      s.kind === 'report'
        ? { instanceId: s.instance_id, kind: 'report' as const, alias: s.alias, tableId: s.table_id, tableRole: s.table_role }
        : { instanceId: s.instance_id, kind: 'staging' as const, alias: s.alias }
    );
  const tempSourceIds = new Set(tempSources.map(t => t.instanceId));
  // 目录对目录关联：right_instance_id 不属于任何临时源实例的那一条；无临时源时与既有"取第一条"逻辑
  // 结果完全一致（demo 页最多两个目录来源，joins 里恰好只有这一条）。
  const join = definition.joins.find(j => !tempSourceIds.has(j.right_instance_id));
  const tempJoins = definition.joins
    .filter(j => tempSourceIds.has(j.right_instance_id))
    .map(j => ({
      leftInstanceId: j.left_instance_id,
      rightInstanceId: j.right_instance_id,
      joinType: j.join_type,
      text: restored[j.on.expression_id] ?? '',
      refs: j.on.refs
    }));
  return {
    definitionId: definition.definition_id,
    revision: definition.revision,
    label: definition.label ?? '',
    sourceIds: definition.sources.filter(s => s.kind === 'catalog').map(s => s.instance_id),
    join: join
      ? {
          leftInstanceId: join.left_instance_id,
          rightInstanceId: join.right_instance_id,
          joinType: join.join_type,
          text: restored[join.on.expression_id] ?? '',
          refs: join.on.refs
        }
      : null,
    tempSources,
    tempJoins,
    filterText: definition.filter ? (restored[definition.filter.expression_id] ?? '') : '',
    filterRefs: definition.filter ? definition.filter.refs : [],
    outputs: definition.outputs.map(o => ({
      targetFieldId: o.target_field_id,
      text: restored[o.expression.expression_id] ?? '',
      // label 缺省（未持久化过显示名）时不写这个键，调用方按既有口径回退默认占位。
      ...(o.label !== undefined ? { label: o.label } : {}),
      refs: o.expression.refs
    })),
    options: {
      distinct: definition.options.distinct,
      take: definition.options.take ?? null,
      orderBy: (definition.options.order_by ?? []).map(o => ({
        targetFieldId: o.target_field_id,
        direction: o.direction
      }))
    }
  };
}
