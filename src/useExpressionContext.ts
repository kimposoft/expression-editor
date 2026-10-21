import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { useExpressionHost, type ExpressionHost, type ViewCatalogEntry } from './host';
import type { TemplateField, TemplateDataTable } from './types';

/**
 * 表达式编辑器上下文：聚合「来源表/本报表字段目录 + 系统变量 + 函数」供统一字段抽屉与 mention 输入消费。
 *
 * 本期来源表作用域 = 本模板各数据表（跨模板来源目录待后续端点）；本报表 = 同一份本模板字段。
 * 系统变量目录与后端 动作网关.SystemVariableCatalog() 一一对应（静态内置数据，前端内置避免端点往返）。
 *
 * P1 改动：移除 options.appId，改用 inject(EXPRESSION_HOST) 获取数据（零行为变化）。
 */

/**
 * 系统变量定义（与后端 SystemVariableCatalog 对齐）。
 *
 * 2026-08-15 追加：type 追加 'boolean' 档——调用方追加系统变量
 * （见下方 extraSystemVariablesRef/setExtraSystemVariables）时可能是布尔型（如流程审批节点的
 * 「是否通过」结果），后端 SystemVariableCatalog 现状内置目录不含布尔项、故此前无需该档；
 * 纯加法追加联合成员，不影响既有 'string'|'number'|'datetime' 三档的既有消费方。
 */
export interface SystemVariableDef {
  var_id: string;
  label: string;
  type: 'string' | 'number' | 'datetime' | 'boolean';
}

/** 内置系统变量目录。
 */
export const SYSTEM_VARIABLES: SystemVariableDef[] = [
  { var_id: 'current_user', label: '当前用户ID', type: 'string' },
  { var_id: 'current_user_name', label: '当前用户姓名', type: 'string' },
  { var_id: 'current_user_dept', label: '当前用户所在部门', type: 'string' },
  { var_id: 'current_time', label: '当前时间', type: 'datetime' },
  { var_id: 'today', label: '今天', type: 'datetime' },
  { var_id: 'record_id', label: '当前记录ID', type: 'string' },
  // E6：以下六条 2026-08-30 补齐登记，与上方五条同源目录。
  { var_id: 'current_user_login', label: '当前用户登录名', type: 'string' },
  { var_id: 'current_user_role', label: '当前用户角色', type: 'string' },
  { var_id: 'current_user_org_name', label: '当前用户所在部门名称', type: 'string' },
  { var_id: 'current_user_org_code', label: '当前用户所在部门编码', type: 'string' },
  { var_id: 'record_status_draft', label: '记录状态-草稿', type: 'string' },
  { var_id: 'record_status_submitted', label: '记录状态-已提交', type: 'string' }
];

/** 函数定义（统一能力，平台按库方言翻译）。与后端 compile.renderFunc 支持集对齐。 */
export interface FunctionDef {
  name: string;
  label: string;
  minArgs: number;
  /** true=聚合函数（sum/count…）：出现在输出里会触发 GROUP BY 语义（与后端 isAggFuncName 对齐）。 */
  aggregate?: boolean;
}

/** 内置函数目录（聚合/字符串/算术）。 */
export const EXPRESSION_FUNCTIONS: FunctionDef[] = [
  { name: 'sum', label: '求和 sum', minArgs: 1, aggregate: true },
  { name: 'count', label: '计数 count', minArgs: 1, aggregate: true },
  { name: 'avg', label: '平均 avg', minArgs: 1, aggregate: true },
  { name: 'min', label: '最小 min', minArgs: 1, aggregate: true },
  { name: 'max', label: '最大 max', minArgs: 1, aggregate: true },
  { name: 'concat', label: '拼接 concat', minArgs: 1 },
  { name: 'coalesce', label: '取首个非空 coalesce', minArgs: 2 },
  { name: 'add', label: '加 +', minArgs: 2 },
  { name: 'sub', label: '减 −', minArgs: 2 },
  { name: 'mul', label: '乘 ×', minArgs: 2 },
  { name: 'div', label: '除 /', minArgs: 2 }
];

/** 开窗函数定义（OVER 子句结构化）。needsArg=是否需要值参数（row_number/rank 等无参）。 */
export interface WindowFnDef {
  name: string;
  label: string;
  needsArg: boolean;
}

/**
 * 内置开窗函数目录（与后端 isWindowFnName/renderWindow 对齐，13 项含 ntile）。
 * 目录已端点化：此常量降级为**端点失败/加载中的 fallback**（见 loadCatalog / ensureCatalogLoaded），不删除。
 */
export const WINDOW_FUNCTIONS: WindowFnDef[] = [
  { name: 'row_number', label: '行号 row_number', needsArg: false },
  { name: 'rank', label: '排名 rank', needsArg: false },
  { name: 'dense_rank', label: '密集排名 dense_rank', needsArg: false },
  { name: 'sum', label: '累计求和 sum', needsArg: true },
  { name: 'avg', label: '移动平均 avg', needsArg: true },
  { name: 'count', label: '累计计数 count', needsArg: true },
  { name: 'min', label: '窗口最小 min', needsArg: true },
  { name: 'max', label: '窗口最大 max', needsArg: true },
  { name: 'lag', label: '前一行 lag', needsArg: true },
  { name: 'lead', label: '后一行 lead', needsArg: true },
  { name: 'first_value', label: '首行值 first_value', needsArg: true },
  { name: 'last_value', label: '末行值 last_value', needsArg: true },
  // ntile：分桶（需桶数参）。历史前端漏此项、后端有——端点化后由后端权威补齐，fallback 亦补齐防离线缺项。
  { name: 'ntile', label: '分桶 ntile', needsArg: true }
];

/**
 * 表达式目录（宿主只读端点 /action-system/expression/catalog 的载荷形状）。
 * 顶层键为 snake（对齐端点信封）；条目字段沿用包内 camel 语义（minArgs/needsArg），
 * snake→camel 由 host adapter负责。
 */
export interface ExpressionCatalog {
  system_variables: SystemVariableDef[];
  functions: FunctionDef[];
  window_functions: WindowFnDef[];
  /** 旧宿主桥可缺省；缺省时 pattern fail-closed，核心比较仍可用。 */
  public_capabilities?: PublicExpressionCapabilities;
}

// E10新增 between/not_between——与 types.ts CompareOp 同步追加（两处独立声明是既有历史
// 分工：本类型是"能力协商"专用，CompareOp 是模型层全集，字段值域故意保持同名同构，不做类型复用）。
export type PublicCompareOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'like' | 'in' | 'not_in' | 'is_null' | 'is_not_null' | 'between' | 'not_between';

export interface PublicExpressionCapabilities {
  schema_version: 2;
  text_equality_distinct_ordering: 'TARGET_DATABASE_NATIVE';
  pattern_matching_mode: 'NATIVE' | 'UNSUPPORTED';
  compare_operators: PublicCompareOperator[];
}

const CORE_COMPARE_OPERATORS: PublicCompareOperator[] = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'not_in', 'is_null', 'is_not_null', 'between', 'not_between'];

function failClosedPublicCapabilities(): PublicExpressionCapabilities {
  return {
    schema_version: 2,
    text_equality_distinct_ordering: 'TARGET_DATABASE_NATIVE',
    pattern_matching_mode: 'UNSUPPORTED',
    compare_operators: [...CORE_COMPARE_OPERATORS]
  };
}

function normalizePublicCapabilities(input: PublicExpressionCapabilities | undefined): PublicExpressionCapabilities {
  if (
    input?.schema_version !== 2 ||
    input.text_equality_distinct_ordering !== 'TARGET_DATABASE_NATIVE' ||
    (input.pattern_matching_mode !== 'NATIVE' && input.pattern_matching_mode !== 'UNSUPPORTED') ||
    !Array.isArray(input.compare_operators)
  ) {
    return failClosedPublicCapabilities();
  }
  const known = new Set<PublicCompareOperator>([...CORE_COMPARE_OPERATORS, 'like']);
  const compareOperators = [...new Set(input.compare_operators.filter(operator => known.has(operator)))];
  const withoutPattern = compareOperators.filter(operator => operator !== 'like');
  return {
    schema_version: 2,
    text_equality_distinct_ordering: 'TARGET_DATABASE_NATIVE',
    pattern_matching_mode: input.pattern_matching_mode,
    compare_operators: input.pattern_matching_mode === 'NATIVE' ? compareOperators : withoutPattern
  };
}

// —— 目录响应式单例（拉端点 + 缓存 + fallback）——
// 三个硬编码常量降级为 fallback；下列 ref 初值即 fallback，故首帧非空（token 不显示裸 ID）。
// 模块级 ref 供 useExpressionContext 与 ExpressionInput/FieldDrawer 共享；每次上下文 load 都重新拉取，
// 让实例/profile/revision 切换不会复用旧 capability。
const systemVariablesRef: Ref<SystemVariableDef[]> = ref(SYSTEM_VARIABLES);
const functionsRef: Ref<FunctionDef[]> = ref(EXPRESSION_FUNCTIONS);
const windowFunctionsRef: Ref<WindowFnDef[]> = ref(WINDOW_FUNCTIONS);
export const publicExpressionCapabilities: Ref<PublicExpressionCapabilities> = ref(failClosedPublicCapabilities());
let catalogLoadRevision = 0;
let catalogInflight: Promise<void> | null = null;
let catalogInflightHost: ExpressionHost | null = null;

export function isCompareOperatorAvailable(operator: string): boolean {
  return publicExpressionCapabilities.value.compare_operators.includes(operator as PublicCompareOperator);
}

/**
 * 拉取宿主目录端点覆盖三个响应式 ref；失败/未返回则保留 fallback 常量（编辑器不空、行为等价端点化前）。
 * 同一个 host 的并发调用共享 inflight；新的 host/load 会先清 capability 再重新拉取。
 */
export async function ensureCatalogLoaded(host: ExpressionHost): Promise<void> {
  if (catalogInflight && catalogInflightHost === host) return catalogInflight;
  const revision = ++catalogLoadRevision;
  catalogInflightHost = host;
  // profile/revision 切换时先清为 fail-closed，绝不在新请求完成前复用上一实例的 LIKE。
  publicExpressionCapabilities.value = failClosedPublicCapabilities();
  const current = (async () => {
    try {
      const cat = await host.loadCatalog();
      if (revision !== catalogLoadRevision) return;
      // 仅当端点返回非空目录才替换，避免异常空载荷清空 fallback。
      if (cat?.system_variables?.length) systemVariablesRef.value = cat.system_variables;
      if (cat?.functions?.length) functionsRef.value = cat.functions;
      if (cat?.window_functions?.length) windowFunctionsRef.value = cat.window_functions;
      publicExpressionCapabilities.value = normalizePublicCapabilities(cat?.public_capabilities);
    } catch {
      if (revision === catalogLoadRevision) publicExpressionCapabilities.value = failClosedPublicCapabilities();
      // 目录仍静默回落 fallback；pattern capability 与目录不同，失败时必须维持 fail-closed。
    } finally {
      if (revision === catalogLoadRevision) {
        catalogInflight = null;
        catalogInflightHost = null;
      }
    }
  })();
  catalogInflight = current;
  return current;
}

/**
 * 调用方按场景追加的系统变量：模块级单例，由 ExpressionEditor.vue
 * 按 props.extraSystemVariables watch 写入；组件卸载时清空，避免上一次打开的追加项残留污染下一次
 * 未传该 prop 的调用（本包所有消费方共享同一份系统变量目录单例，不清空就会"跨会话串味"）。
 * 与 systemVariablesRef（宿主内置/端点目录）分开持有：合并时要保持"宿主项优先"的去重规则，
 * 分开存放才不会互相覆盖写入。
 */
const extraSystemVariablesRef: Ref<SystemVariableDef[]> = ref([]);

/**
 * 写入/清空调用方追加的系统变量目录。传 null 或空数组等价于"不追加"。
 * 由 ExpressionEditor.vue 的 `watch(() => props.extraSystemVariables, ...)` 与 onBeforeUnmount 调用；
 * 本函数不做去重（去重在下方 systemVariablesCatalog computed 里统一处理，避免两处各算一次）。
 */
export function setExtraSystemVariables(list: SystemVariableDef[] | null): void {
  extraSystemVariablesRef.value = list ?? [];
}

/**
 * 响应式系统变量目录（端点覆盖后自动刷新；供 ExpressionInput/FieldDrawer 等直接消费）。
 *
 * 2026-08-15 改造：由裸 ref 改为 computed = 宿主静态/端点
 * 目录 ∪ 调用方追加目录（按 var_id 去重，宿主项优先保留——同一 var_id 若宿主内置目录已有，追加项
 * 静默丢弃，不覆盖宿主定义）。extraSystemVariablesRef 缺省空数组时，computed 结果与改动前的
 * systemVariablesRef 逐字节一致（同一个数组引用，未 new 出新数组，既有消费方的浅比较/watch 也不会
 * 因为"值相同但引用变了"而误触发）。ComputedRef 仍是 Ref<T> 的子类型，既有 7 个消费方
 * （QuickFieldPicker/ExpressionInput/ConditionReadonlyView/FieldTreePanel/FieldTreeDock/
 * ConditionTree 等）一律只读 `.value`，零改动、零行为差异。
 */
export const systemVariablesCatalog: ComputedRef<SystemVariableDef[]> = computed(() => {
  if (extraSystemVariablesRef.value.length === 0) return systemVariablesRef.value;
  const seen = new Set(systemVariablesRef.value.map(v => v.var_id));
  const extra = extraSystemVariablesRef.value.filter(v => !seen.has(v.var_id));
  return extra.length === 0 ? systemVariablesRef.value : [...systemVariablesRef.value, ...extra];
});
/** 响应式函数目录。 */
export const functionsCatalog: Ref<FunctionDef[]> = functionsRef;
/** 响应式开窗函数目录。 */
export const windowFunctionsCatalog: Ref<WindowFnDef[]> = windowFunctionsRef;

/**
 * 判断某字段 data_type 是否命中调用方「置灰名单」。FieldTreeDock/
 * QuickFieldPicker 据此渲染置灰 + title 提示、并在点选处拦截，不再 emit 该字段。
 */
export function isFieldTypeUnsupported(dataType: string | null | undefined, unsupportedFieldTypes: string[]): boolean {
  if (unsupportedFieldTypes.length === 0) return false;
  const normalized = (dataType ?? '').trim().toLowerCase();
  return unsupportedFieldTypes.some(t => t.trim().toLowerCase() === normalized);
}

/** 一张表 + 它的字段（抽屉分组用）。 */
export interface TableFields {
  table: TemplateDataTable;
  fields: TemplateField[];
}

/** P1：appId 已移除，由 EXPRESSION_HOST inject 闭包绑定。 */
export interface ExpressionContextOptions {
  templateId: string;
  /**
   * 可选显式 host：供"provide 与消费在同一组件"的顶层弹窗场景直传（Vue 的 inject 只解析父链，
   * 自 provide 不可自 inject——顶层弹窗无祖先 provide 时 useExpressionHost() 会 throw）。
   * 不传时行为不变（照旧 inject(EXPRESSION_HOST)），严格向后兼容。
   */
  host?: ExpressionHost;
}

/**
 * 视图相关缓存的键计算：appId 缺省（当前应用，view 来源现状——
 * app_id 尚未在 SourceTable 持久化，见 types.ts SourceTable.app_id 注释「仅 template 来源支持」）时
 * 键退化为裸 viewId，与改造前的既有单参调用逐字节一致（现有直接以 `[viewId]` 索引 viewFieldsCache 的
 * 调用点——ExpressionEditor.vue 的 fieldsForSource/knownFieldIdsForSource 等——因此零改动、零行为
 * 差异）；仅当显式传入 appId（跨应用取数新增路径）时才产出带前缀的独立键，避免不同应用下拉取的
 * schema/目录互相顶掉缓存。 */
export function viewCacheKey(viewId: string, appId?: string): string {
  return appId ? `${appId}:${viewId}` : viewId;
}

/**
 * useExpressionContext 维护表/字段目录，支持**跨模板惰性加载**：
 * - `tableFields`（= 本模板/本报表 各表+字段）：`load()` 初始化即加载，供「本报表」tab 与目标表用。
 * - `fieldsByTableId`：**全局字段缓存**（data_table_id → fields，应用内 data_table_id 唯一），含本报表
 *   与已加载的跨模板来源表字段；mention token 渲染 / 输入插入字段用。
 * - `tablesOf(templateId)` / `ensureFields(templateId, dataTableId)`：跨模板来源选择器按需拉表/拉字段并缓存。
 *
 * P1：HTTP 调用改用 inject(EXPRESSION_HOST)，appId 由 host 闭包持有。
 */
export function useExpressionContext(options: ExpressionContextOptions) {
  // host 在 setup 顶层 inject（Vue injection 约束），捕获进闭包供异步函数使用。
  // options.host 显式直传时优先（顶层弹窗自 provide 场景，见 ExpressionContextOptions.host 注释），不再 inject。
  const host = options.host ?? useExpressionHost();

  const tableFields: Ref<TableFields[]> = ref([]);
  const loading = ref(false);
  const errorText = ref('');

  // 全局缓存：data_table_id → 字段；template_id → 数据表列表。跨模板来源加载后写入，供抽屉/输入复用。
  const fieldsCache = ref<Record<string, TemplateField[]>>({});
  const tablesCache = ref<Record<string, TemplateDataTable[]>>({});
  // views-extraction-b3 R3：视图字段缓存键=view_id（与 template 来源的 data_table_id 缓存分开存放，
  // view_id 与 data_table_id 值域不重叠——都是各自 idgen 的业务前缀 view_/tbl_，理论上不会撞键，
  // 但语义上是两类不同的"表"，分开存放更清晰，也避免未来任一方前缀规则变化引入隐患）。
  const viewFieldsCache = ref<Record<string, TemplateField[]>>({});
  // 视图名缓存（view_id → view_name），供来源标签渲染用（ExpressionEditor.vue sourceDisplayName）。
  const viewNameCache = ref<Record<string, string>>({});
  // 视图元信息缓存：键=viewCacheKey(viewId, appId)，
  // 值来自 host.listViews 目录按 view_id 命中的条目（见下方 ensureViewMeta）。
  const viewMetaCache = ref<Record<string, { view_type?: 'regular' | 'combined'; column_count?: number }>>({});
  // listViews 按应用整批缓存（key=appId ?? ''），避免同一应用下每个视图来源各发一次目录请求。
  const viewListCache = ref<Record<string, ViewCatalogEntry[]>>({});
  // S2b（外部数据表来源）：外部表字段缓存键=external_object_id（与 view/template 缓存分开存放，
  // 理由同 viewFieldsCache 注释——两类"表"没有共享的 ID 值域约定，分开存放更清晰）。
  const externalFieldsCache = ref<Record<string, TemplateField[]>>({});
  // 外部表展示名缓存（object_id → object_name），供来源标签渲染用（同 viewNameCache）。
  const externalNameCache = ref<Record<string, string>>({});

  /** 已加载的字段缓存（含本报表 + 跨模板来源表）。 */
  const fieldsByTableId = computed<Record<string, TemplateField[]>>(() => fieldsCache.value);

  async function load(): Promise<void> {
    loading.value = true;
    errorText.value = '';
    // 并行拉取目录端点（不阻塞字段加载）；成功后三个响应式 ref 自动刷新，失败回落 fallback 常量。
    void ensureCatalogLoaded(host);
    try {
      const tables = await tablesOf(options.templateId);
      const loaded = await Promise.all(
        tables.map(async table => {
          const fields = await ensureFields(options.templateId, table.data_table_id);
          return { table, fields } satisfies TableFields;
        })
      );
      tableFields.value = loaded;
    } catch (err) {
      errorText.value = err instanceof Error ? err.message : '加载字段目录失败';
    } finally {
      loading.value = false;
    }
  }

  /** 取某模板的数据表列表（缓存）。供跨模板来源选择器用。
   *  appId 可选（跨应用取数）：传其他应用 ID 时向该应用拉取；模板 ID 全局唯一（idgen GUID），
   *  缓存键无需掺入 appId，跨应用条目与本应用条目天然不撞键。 */
  async function tablesOf(templateId: string, appId?: string): Promise<TemplateDataTable[]> {
    if (tablesCache.value[templateId]) return tablesCache.value[templateId];
    const tables = await host.listTables(templateId, appId);
    tablesCache.value = { ...tablesCache.value, [templateId]: tables };
    return tables;
  }

  /** 确保某表字段已加载进缓存并返回（缓存命中直接返回）。
   *  appId 可选（跨应用取数）：数据表 ID 同样全局唯一，缓存键不变。 */
  async function ensureFields(templateId: string, dataTableId: string, appId?: string): Promise<TemplateField[]> {
    if (fieldsCache.value[dataTableId]) return fieldsCache.value[dataTableId];
    const fields = await host.listFields(templateId, dataTableId, appId);
    fieldsCache.value = { ...fieldsCache.value, [dataTableId]: fields };
    return fields;
  }

  /** 取某字段的显示名（mention token 渲染用）；未加载时回落字段 ID。 */
  function fieldName(dataTableId: string, fieldId: string): string {
    const field = (fieldsCache.value[dataTableId] ?? []).find(f => f.field_id === fieldId);
    return field?.field_name ?? fieldId;
  }

  async function ensureViewFields(viewId: string, appId?: string): Promise<TemplateField[]> {
    const key = viewCacheKey(viewId, appId);
    if (viewFieldsCache.value[key]) return viewFieldsCache.value[key];
    if (!host.getViewSchema) {
      viewFieldsCache.value = { ...viewFieldsCache.value, [key]: [] };
      return [];
    }
    try {
      const schema = await host.getViewSchema(viewId, appId);
      const fields = (schema.columns ?? []).map((col, index) => viewColumnToTemplateField(col, index));
      viewFieldsCache.value = { ...viewFieldsCache.value, [key]: fields };
      if (schema.view_name) viewNameCache.value = { ...viewNameCache.value, [viewId]: schema.view_name };
      return fields;
    } catch {
      // 拉取失败（网络/权限/视图已被删）：与"宿主不支持"走同一条降级路径，不阻断编辑器其余功能。
      viewFieldsCache.value = { ...viewFieldsCache.value, [key]: [] };
      return [];
    }
  }

  /**
   *
   * 数据来自 `host.listViews(appId)`——一次性拉取该应用（appId 缺省=当前应用）的整份视图目录，
   * 按 view_id 命中后只落一条元信息，避免为每个视图来源单开一次专属请求；同一 appId 的目录按
   * viewListCache 缓存复用。`host.listViews` 缺失（旧宿主桥未实现该可选方法）、目录里找不到该
   * view_id、或请求失败时**不抛错**，返回 undefined——来源行据此回落既有通用「视图」标签、不显示
   * 列数，不阻断编辑器其余功能（容错范式同 ensureViewFields/ensureExternalFields）。
   */
  async function ensureViewMeta(
    viewId: string,
    appId?: string
  ): Promise<{ view_type?: 'regular' | 'combined'; column_count?: number } | undefined> {
    const key = viewCacheKey(viewId, appId);
    if (viewMetaCache.value[key]) return viewMetaCache.value[key];
    if (!host.listViews) return undefined;
    try {
      const appKey = appId ?? '';
      let list = viewListCache.value[appKey];
      if (!list) {
        list = await host.listViews(appId);
        viewListCache.value = { ...viewListCache.value, [appKey]: list };
      }
      const found = list.find(v => v.view_id === viewId);
      if (!found) return undefined;
      const meta = { view_type: found.view_type, column_count: found.column_count };
      viewMetaCache.value = { ...viewMetaCache.value, [key]: meta };
      return meta;
    } catch {
      // 拉取失败（网络/权限）：静默——不缓存失败结果，允许下次重试；不阻断编辑器其余功能。
      return undefined;
    }
  }

  /** 取某视图的显示名（来源标签渲染用）；未加载/未知时返回 undefined，调用方回落裸 view_id。 */
  function viewName(viewId: string): string | undefined {
    return viewNameCache.value[viewId];
  }

  /**
   * 确保某外部数据表字段已加载进缓存并返回。缓存键=external_object_id。
   * **只收 access_mode==='usable' 列**——filter_only 列只在服务端边界里用，设计器永不可见（硬约束：
   * 安全恒绿探针）。`host.getExternalSchema` 缺失（旧宿主桥未实现该可选方法）或调用失败时**不抛错**——
   * 与 ensureViewFields 同一降级范式：来源仍可显示（sourceDisplayName 裸 object_id 回落），字段列表置空，
   * 由字段面板展示"当前宿主不支持读取外部表字段"（drawer.externalFieldsUnsupported）。
   */
  async function ensureExternalFields(objectId: string): Promise<TemplateField[]> {
    if (externalFieldsCache.value[objectId]) return externalFieldsCache.value[objectId];
    if (!host.getExternalSchema) {
      externalFieldsCache.value = { ...externalFieldsCache.value, [objectId]: [] };
      return [];
    }
    try {
      const schema = await host.getExternalSchema(objectId);
      // 安全恒绿：filter_only 列（仅供服务端边界使用）过滤掉，绝不进入设计器字段列表/快捷选取。
      const usable = (schema.columns ?? []).filter(col => col.access_mode === 'usable');
      const fields = usable.map((col, index) => externalColumnToTemplateField(col, index));
      externalFieldsCache.value = { ...externalFieldsCache.value, [objectId]: fields };
      if (schema.object_name) externalNameCache.value = { ...externalNameCache.value, [objectId]: schema.object_name };
      return fields;
    } catch {
      // 拉取失败（网络/权限/对象已被移除）：与"宿主不支持"走同一条降级路径，不阻断编辑器其余功能。
      externalFieldsCache.value = { ...externalFieldsCache.value, [objectId]: [] };
      return [];
    }
  }

  /** 取某外部数据表的显示名（来源标签渲染用）；未加载/未知时返回 undefined，调用方回落裸 object_id。 */
  function externalName(objectId: string): string | undefined {
    return externalNameCache.value[objectId];
  }

  return {
    tableFields,
    fieldsByTableId,
    tablesCache,
    loading,
    errorText,
    // 目录改为响应式 ref（端点覆盖后自动刷新；端点失败/加载中回落 fallback 常量）。
    systemVariables: systemVariablesRef,
    functions: functionsRef,
    windowFunctions: windowFunctionsRef,
    load,
    tablesOf,
    ensureFields,
    fieldName,
    // views-extraction-b3 R3：视图字段目录。
    viewFieldsCache,
    ensureViewFields,
    viewName,
    viewMetaCache,
    ensureViewMeta,
    // S2b：外部数据表字段目录。
    externalFieldsCache,
    ensureExternalFields,
    externalName
  };
}

const VIEW_COLUMN_DATA_TYPES = new Set(['text', 'number', 'boolean', 'date', 'datetime']);

/**
 * 把视图输出列（{code,name,type}）适配为 TemplateField 形状，供字段面板/mention token 与
 * template 来源字段复用同一套渲染逻辑。视图列没有 template 字段那套可搜索/可筛选/可排序/
 * 列表可见性等设计态元数据，统一给保守默认值（均 false，仅 is_list_visible=true 保证列出）；
 * sort_no 用 index 兜底，保持 output_schema 原始声明顺序。
 */
function viewColumnToTemplateField(col: { code: string; name: string; type: string }, index: number): TemplateField {
  return {
    field_id: col.code,
    field_code: col.code,
    field_name: col.name,
    data_type: VIEW_COLUMN_DATA_TYPES.has(col.type) ? col.type : 'text',
    display_style: 'text',
    sort_no: index,
    is_searchable: false,
    is_filterable: false,
    is_sortable: false,
    is_list_visible: true
  };
}

/**
 * 把「上一步暂存区」列（Phase B，动作暂存区：{code,name,type?}）适配为 TemplateField 形状，供字段面板/
 * mention token 与 template/view 来源字段复用同一套渲染逻辑。照抄 viewColumnToTemplateField 的适配思路，
 * 差异点：
 * - type 是可选字段（producer 节点可能未声明列类型），未知/缺失时回落 'text'（与 view 分支的
 *   "映射不到按 R3 规则置 text" 同一兜底规则，复用 VIEW_COLUMN_DATA_TYPES 白名单）；
 * - sort_no 用 index 兜底，保持 stagingSource.columns 声明顺序（即 producer 节点的输出列顺序）。
 * 无状态纯函数（暂存列直接来自 ExpressionEditor 的 stagingSource prop，非异步端点拉取），故不挂进
 * useExpressionContext() 的缓存/返回对象——模块级直接导出，调用方（ExpressionEditor.vue）按需 import。
 */
export function stagingColumnToTemplateField(col: { code: string; name: string; type?: string }, index: number): TemplateField {
  return {
    field_id: col.code,
    field_code: col.code,
    field_name: col.name,
    data_type: col.type && VIEW_COLUMN_DATA_TYPES.has(col.type) ? col.type : 'text',
    display_style: 'text',
    sort_no: index,
    is_searchable: false,
    is_filterable: false,
    is_sortable: false,
    is_list_visible: true
  };
}

const EXTERNAL_LOGICAL_TYPE_MAP: Record<string, string> = {
  BOOL: 'boolean',
  INT: 'number',
  DECIMAL: 'number',
  TEXT: 'text',
  DATE: 'date',
  DATETIME: 'datetime'
};

/**
 * 把外部数据表列（{code,name,type,access_mode}，已由调用方 ensureExternalFields 过滤只剩
 * access_mode==='usable' 者）适配为 TemplateField 形状，供字段面板/mention token 与 template/view
 * 来源字段复用同一套渲染逻辑。照抄 viewColumnToTemplateField 的适配思路：外部表列同样没有 template
 * 字段那套可搜索/可筛选/可排序/列表可见性等设计态元数据，统一给保守默认值；sort_no 用 index 兜底，
 * 保持后端 columns 声明顺序（后端按 ordinal 下发）。
 */
export function externalColumnToTemplateField(col: { code: string; name: string; type: string }, index: number): TemplateField {
  return {
    field_id: col.code,
    field_code: col.code,
    field_name: col.name,
    data_type: EXTERNAL_LOGICAL_TYPE_MAP[col.type] ?? 'text',
    display_style: 'text',
    sort_no: index,
    is_searchable: false,
    is_filterable: false,
    is_sortable: false,
    is_list_visible: true
  };
}
