/**
 *
 * 注入范式照抄 ../host.ts 的 provideExpressionHost/useExpressionHost：缺失即抛错，不静默白屏。
 */
import { inject, provide, type InjectionKey } from 'vue';
// AliceV4Host（生产桥）依赖的两个既有类型：V4ExpressionRefWire 定义于 ./definition.ts（token 化
// refs 表，比本文件的 V4DiagnoseRef 更宽），V4ExtractNodeDocument 定义于 ./nodeDocument.ts（取数
// 节点整份文档）。两处均为纯类型导入（import type），与 ./definition.ts 反向 `import type { V4Purpose }
// from './types'` 构成的循环仅在类型层面存在，编译期会被整体擦除，不产生运行时环。
import type { V4ExpressionRefWire } from './definition';
import type { V4ExtractNodeDocument, V4QueryDefinition } from './nodeDocument';
// 写节点文档：与取数节点文档同为 AliceV4Host.compile 的入参之一，纯类型导入。
import type { V4WriteNodeDocument } from './writeNodeDocument';
// reportInstanceId：本报表来源目录兜底补齐时，未落库表要用与 reconcile() 落库时
// 完全同一套确定性派生算 instance_id（按 data_table_id 走 FNV-1a），保证诊断期临时候选与确认后
// 真正落进 query.sources 的记录逐字节同一身份，不产生第二个 instance_id。expressionModelAdapter.ts
// 不反向 import 本文件，纯值导入不构成循环。
import { reportInstanceId } from './expressionModelAdapter';
// ChartCatalogEntry 复用包内既有类型（../host.ts，七字段 chartId/chartType/chartForm/title/source/
// sheetId/sheetName），仅类型导入（import type 编译期整体擦除，不产生运行时依赖 ../host.ts 的
// locale/inject 等运行时代码，不违反本子目录"与包内既有 ExpressionHost/types.ts 完全独立并存"的约定）。
import type { ChartCatalogEntry } from '../host';

/** 本次表达式文本的用途：filter=筛选条件；join_on=关联 ON 条件；output=输出/填充取值；
 *  condition=动作条件分支的判断表达式——同为谓词根，
 *  与 filter 的差别在于**允许聚合**（服务端 bind.PurposeCondition，三端点 tokenize/restore/diagnose
 *  已接受该值）。本类型只是字面量联合，包内不存在按用途分派的 switch，新增该档不影响既有分支。 */
export type V4Purpose = 'filter' | 'join_on' | 'output' | 'condition';

/** 目录里的一个字段。
 *  system：该字段是目录给 catalog 来源实例自动追加的系统列，
 *  而非模板真实字段——'record_id'（所有 catalog 实例皆有）| 'parent_record_id'（仅明细/扩展表实例
 *  带出）。缺省 undefined = 普通业务字段。作用域构建（如 hostScopeFromDocument）按目录字段列表
 *  原样纳入即可，不需按本字段特判剔除——系统字段与普通字段一样要能被引用（合成关联 ON 正是引用它）。 */
export interface V4CatalogField {
  field_id: string;
  label: string;
  data_type: string;
  nullable?: boolean;
  system?: 'record_id' | 'parent_record_id';
}

/**
 * 候选来源表：可作取数来源、但尚未加入本次查询的一张表。字段口径与服务端 catalog 端点的
 * sources 段逐字对齐（app_id/template_id/data_table_id/label/fields）——加入来源时由前端生成
 * instance_id，再据这四个身份字段构造 V4SourceBindingCatalog。
 */
export interface V4CandidateSource {
  app_id: string;
  template_id: string;
  data_table_id: string;
  label: string;
  fields: V4CatalogField[];
}

/**
 * V4 demo 目录（loadCatalog 返回形状）：
 * - sources：来源表（跨实例/跨表），每张表一个显式别名；
 * - report：本报表各表（含主/明细角色）；
 * - staging：暂存表列（本期扁平列清单，不分表）；
 * - functions/keywords：函数与关键字目录，供编辑面渲染可点选 chip。
 */
export interface V4DemoCatalog {
  /** 本次目录是否处于"已重命名"视图（字段/表显示名做过映射），透传自 loadCatalog 的入参回显。 */
  renamed: boolean;
  /** 目录模式回显（T6 追加批次）："fixture"（demo 固定夹具，缺省）| "real"（真实应用库）。 */
  mode?: 'fixture' | 'real';
  sources: Array<{ instance_id: string; alias: string; table_label: string; fields: V4CatalogField[] }>;
  /** 候选来源表（生产桥填充：服务端 catalog 端点装出的「本应用内全部可作取数来源的候选表」，
   *  逐张带字段清单）。与上面的 `sources` 语义不同、不可互换：`sources` 是「已加入本次查询的来源
   *  实例」（带 instance_id/alias），本字段是「用户还没选、可供挑选的候选表」（无 instance_id——
   *  instance_id 由前端加入来源时自行生成）。demo 夹具不填此字段，故为可选。 */
  candidates?: V4CandidateSource[];
  report: { tables: Array<{ table_id: string; label: string; role: 'main' | 'detail'; fields: V4CatalogField[] }> };
  staging: { columns: Array<{ column_id: string; label: string; data_type: string }> };
  functions: Array<{
    semantic_id: string;
    label_zh: string;
    label_en: string;
    snippet: string;
    category: string;
    aggregate: boolean;
  }>;
  keywords: string[];
  skipped_fields?: V4SkippedField[];
}

/** 真实模式被排除出表达式作用域的一条字段（见 V4DemoCatalog.skipped_fields）。 */
export interface V4SkippedField {
  instance_id: string;
  field_id: string;
  label: string;
  data_type: string;
}

export interface V4Diagnostic {
  code: string;
  phase: string;
  severity: 'error' | 'warning' | 'info';
  rune_start?: number;
  rune_end?: number;
  message: string;
  message_key?: string;
  message_args?: Record<string, unknown>;
}

export interface V4NodeDocumentDiagnosticItem {
  /** 该诊断所属槽位 key，供宿主定位到具体输入框。 */
  source: string;
  diagnostic: V4Diagnostic;
}

/** finalize() 收口结果：ok=是否全部槽位 tokenize 成功；doc=按当前编辑态尽力装配出的文档；
 *  diagnostics=失败槽位的诊断汇总。迁移理由同 V4NodeDocumentDiagnosticItem 头注释。 */
export interface V4NodeDocumentFinalizeResult {
  ok: boolean;
  doc: V4ExtractNodeDocument;
  diagnostics: V4NodeDocumentDiagnosticItem[];
}

/** 稳定引用绑定（`[标签]#{rN}` 组合 token 的 refs 表条目）：标签仅展示，语义以稳定 ID 为准——改名免疫演示依赖它。 */
export interface V4DiagnoseRef {
  ref_id: string;
  kind: 'source_field' | 'report_field' | 'staging_field';
  source_instance_id?: string;
  table_id?: string;
  field_id?: string;
  column_id?: string;
}

/** diagnose 请求体：text=当前表达式原文；purpose=用途；renamed=是否按"已重命名"视图解析（可选，透传目录状态）；
 *  mode=目录模式（可选，"fixture" 缺省 | "real"，T6 追加批次）；
 *  refs=文本内 `#{rN}` 稳定标记的绑定表（可选，仅含稳定标记时需要）。 */
export interface V4DiagnoseRequest {
  text: string;
  purpose: V4Purpose;
  renamed?: boolean;
  mode?: 'fixture' | 'real';
  refs?: V4DiagnoseRef[];
}

export interface V4DiagnoseResponse {
  ok: boolean;
  tokens: Array<{ kind: string; text: string; rune_start: number; rune_end: number }>;
  ast: unknown;
  refs: Array<{ ref_id: string; kind: string; display: string }>;
  envelope: unknown;
  digest: string;
  diagnostics: V4Diagnostic[];
  root_type?: {
    logical_type: string;
    coarse_type?: 'text' | 'number' | 'datetime' | 'boolean' | string;
    precision?: number;
    scale?: number;
  };
}

/** V4 demo host：宿主注入接口，供 V4 编辑面组件消费。宿主端点由另一张卡实现。 */
export interface AliceV4DemoHost {
  loadCatalog(renamed: boolean): Promise<V4DemoCatalog>;
  diagnose(req: V4DiagnoseRequest): Promise<V4DiagnoseResponse>;
}

export const ALICE_V4_DEMO_HOST: InjectionKey<AliceV4DemoHost> = Symbol('alice-v4-demo-host');

/** 在 setup 上下文中提供 AliceV4DemoHost。通常由 demo 页面调用。 */
export function provideAliceV4DemoHost(host: AliceV4DemoHost): void {
  provide(ALICE_V4_DEMO_HOST, host);
}

/**
 * 组件内获取 AliceV4DemoHost，缺失时抛错（范式照抄 ../host.ts 的 useExpressionHost）。
 * 只能在 setup() 顶层调用（Vue injection 约束）。
 */
export function useAliceV4DemoHost(): AliceV4DemoHost {
  const host = inject(ALICE_V4_DEMO_HOST);
  if (!host) {
    throw new Error(
      '[expression-editor/v4] ALICE_V4_DEMO_HOST not provided. ' +
        '请在父组件调用 provideAliceV4DemoHost(host) 后再挂载 V4 编辑面组件。'
    );
  }
  return host;
}

/**
 * KimpoSQL 方括号标识符转义：名称内出现的 `]` 须转义为 `]]`（与 SQL 方括号引用的既定转义规则一致）。
 * 供字段/表/列显示名插入 `[名称]` 形态前调用——V4FieldTree.vue 组装引用文本时使用。
 */
export function escapeBracketIdent(name: string): string {
  return name.replace(/\]/g, ']]');
}


export interface V4TokenizeRequest {
  text: string;
  purpose: V4Purpose;
  mode?: 'fixture' | 'real';
  schema_variant?: 'base' | 'renamed' | 'dropped' | 'retyped';
  refs?: V4ExpressionRefWire[];
}

/** tokenize 响应体：ok=是否全部绑定成功；source_text=token 化后的源码；refs=稳定引用绑定表。 */
export interface V4TokenizeResponse {
  ok: boolean;
  source_text: string;
  refs: V4ExpressionRefWire[];
  digest: string;
  diagnostics: V4Diagnostic[];
}

/**
 * restore 请求体：把 token 化源码按当前目录还原为可读文本（改名后显示新名；引用失效时 text 保留
 * `[last_label]#{rN}` 墓碑标记并给 error 诊断）——重开草稿时逐表达式调用，填回编辑框。字段口径
 * 原样迁自 alice-v4-demo.ts（批 1，原 :421~429 行）。
 */
export interface V4RestoreRequest {
  source_text: string;
  refs: V4ExpressionRefWire[];
  purpose: V4Purpose;
  mode?: 'fixture' | 'real';
  schema_variant?: 'base' | 'renamed' | 'dropped' | 'retyped';
}

/** restore 响应体：ok=是否全部还原成功（无失效引用）；text=还原后的可读文本。 */
export interface V4RestoreResponse {
  ok: boolean;
  /** token 化形态（`[标签]#{rN}`）的刷新结果——供需要稳定标记的消费方（demo 页 / 重编号）。 */
  text: string;
  /**
   * 去掉 `#{rN}` 标记、引用按当前作用域打印成完整显示路径（`[来源别名].[字段]` / `本报表.[表].[字段]` /
   * `暂存表.[列]`）的可读文本。设计器编辑框显示的是它、送回 tokenize 的也是它。
   * 可选：老宿主/老服务端不带此字段时调用方退回 text。
   */
  readable_text?: string;
  digest: string;
  diagnostics: V4Diagnostic[];
}

/**
 * compile（生产桥新增，接口冻结表定义）请求体：node 级整份编译——把当前节点文档整体交给
 * 服务端编译，一次性拿回各填充/图表目标（取数节点）或写目标（写节点）的诊断（区别于 demo 的单条
 * 表达式级 diagnose）。V4ExtractNodeDocument 见 ./nodeDocument.ts；V4WriteNodeDocument 见
 * ./writeNodeDocument.ts。
 *
 * extract_v4/write_v4 二选一：取数节点带 extract_v4，写节点（新增/
 * 修改/删除数据）带 write_v4，两者互斥、不会同时出现——调用方按 isWriteNodeDocument(doc) 判定
 * 走哪一支（见 ./writeNodeDocument.ts），本类型不建模 oneOf 约束（TS 结构类型天然允许两者都缺席
 * 的非法态，深层互斥校验归服务端）。
 */
export interface V4CompileNodeRequest {
  template_id: string;
  version_no: string;
  node_id: string;
  extract_v4?: V4ExtractNodeDocument;
  write_v4?: V4WriteNodeDocument;
}

/** compile 响应体单条目标编译结果：kind 区分填充目标/图表目标/暂存目标，index 为该 kind 下的数组
 *  下标（暂存目标恒 0），owner_id 回显该目标 id（V4FillTarget.target_id / V4ChartTarget.chart_id /
 *  暂存目标固定为服务端保留标识 'staging_target'）。 */
export interface V4CompileNodeTargetResult {
  kind: 'fill' | 'chart' | 'staging';
  index: number;
  owner_id: string;
  diagnostics: V4Diagnostic[];
}

/** compile 响应体：ok=各目标是否均无 error 级诊断；targets=逐目标编译结果。 */
export interface V4CompileNodeResponse {
  ok: boolean;
  targets: V4CompileNodeTargetResult[];
}

export interface V4HostScopeSource {
  instance_id: string;
  alias: string;
  app_id: string;
  template_id: string;
  data_table_id: string;
}
/** 本报表来源信封条目：table_role 为该表在当前表单里的角色（主表/明细）。 */
export interface V4HostScopeReportSource {
  instance_id: string;
  table_id: string;
  table_role: 'main' | 'detail';
  alias: string;
}
export interface V4HostScopeStagingSource {
  instance_id: string;
  producer_node_id: string;
  alias: string;
  columns: Array<{ column_id: string; label: string; data_type: string; nullable: boolean }>;
}
/**
 * 视图来源信封条目：字段口径对齐 V4SourceBindingView（./definition.ts）——
 * instance_id/app_id/view_id 三件套，供 AliceV4Host 侧据此向服务端换取该视图的目录（列清单）以
 * 参与 diagnose/tokenize/restore 的作用域解析。不带 alias——服务端按 instance_id 反查即可，与
 * V4HostScopeSource（目录来源）字段集合的取舍一致（那里也不携带 alias 之外用不到的展示字段）。
 */
export interface V4HostScopeViewSource {
  instance_id: string;
  app_id: string;
  view_id: string;
}

export interface V4HostScopeExternalSource {
  instance_id: string;
  app_id: string;
  external_stable_id: string;
}

/** AliceV4Host.setScope 的入参形状：当前查询已加入的目录来源 + 本报表来源 + 可选的暂存来源 +
 *  可选的视图来源 + 可选的外部数据表来源。 */
export interface V4HostScope {
  sources: V4HostScopeSource[];
  report_sources: V4HostScopeReportSource[];
  /** 本次定义未引用暂存区时缺省 undefined（不下发该字段）——与服务端 `omitempty` 口径一致。 */
  staging_source?: V4HostScopeStagingSource;
  view_sources?: V4HostScopeViewSource[];
  external_sources?: V4HostScopeExternalSource[];
}

/**
 * 目录侧「本报表某张表」的最小形状（供 reportCatalogTables 入参用）：与 V4DemoCatalog.report.tables
 * 条目、bind.TableScope 逐字段同构，调用方（ActionConfigSurface.vue）直接原样传 catalog.report.tables
 * 即可，不需要额外转换。
 */
export interface V4HostScopeReportCatalogTable {
  table_id: string;
  label: string;
  role: 'main' | 'detail';
}

/**
 * 从取数节点文档派生作用域信封（按 query.sources 的 kind 分拣——kind='catalog' 进 sources 段，
 * kind='report' 进 report_sources 段；kind='staging'（暂存表来源）走独立的 staging_source 参数，
 * 见下方 stagingSource 入参说明），别名（alias）原样透传。供取数配置面（插件
 * ActionConfigSurface.vue）watch query.sources 时调用，装配后交给 host.setScope 使用。
 *
 * reportCatalogTables：当前模板的「本报表」全部表目录（来自 V4 目录端点
 * report.tables，与字段树/⊞ 拾取器共用同一份数据源）。不传时行为与改造前逐字节一致（纯按
 * query.sources 分拣，非纯函数保证不受影响的既有调用方/单测不必改）。
 *
 * 传入时会把目录里**尚未被 query.sources 显式登记**的表也一并补进 report_sources——「本报表」
 * 各表理应恒可引用（这正是保留前缀 `本报表.` 区别于显式来源 `[来源]` 的设计初衷：后者才需要用户
 * 手动"添加来源"），不该受限于"是否已被某条表达式引用过"。若不补齐，用户在条件编辑器/表达式框里
 * 第一次引用某张此前从未被引用过的本报表表时会踩中死锁：1.5s 防抖诊断读的是当前已 setScope 的
 * 旧作用域（该表还不在里面）必报「本报表下找不到数据表」，而「确定」按钮又因诊断失败被禁用——
 * 该表本该在**确认之后**才由 ExpressionEditor.vue 的 reconcile() 落进 query.sources，但确认本身
 * 先被这次诊断挡死，无法达成。
 * 未落库的候选表 instance_id 用 reportInstanceId 按 table_id 确定性派生——与 reconcile() 真正
 * 引用后落库时算出的 instance_id 逐字节相同，不产生第二个身份；已被 query.sources 登记的表优先
 * （不重复添加、不覆盖其已有 alias/instance_id），只补目录里"还没登记"的那些。
 *
 * stagingSource（可选，2026-09-07 语法检查修复——此前本函数注释写「暂存来源首版不携带」，现改判）：
 * 由调用方（配置面）按当前上一步暂存区推导传入 `{producerNodeId, producerLabel, columns}`（与
 * ExpressionEditor.vue props.stagingSource 同一形状，见插件侧 ActionConfigSurface.vue）。
 * 不传、或文档没有 kind='staging' 绑定、或 columns 为空时不装配 staging_source（保持 undefined，
 * 不写 null）——不引用暂存区就不必带这段信封，与服务端「StagingSource 可空」的口径一致；不带的
 * 后果是 diagnose/tokenize/restore 三端点把 Scope.Staging 留 nil，用户引用 `暂存表.[列]` 会报
 * 「当前作用域没有暂存区」，故文档一旦含暂存来源，调用方就该把这份列清单传全。
 *
 * doc 参数类型放宽为 `{ query: V4QueryDefinition }`：本函数只读 `doc.query.sources`，
 * 取数节点文档（V4ExtractNodeDocument）与写节点文档（V4WriteNodeDocument）都满足这一形状——写节点
 * 配置面同样需要按 query.sources 装配作用域信封供 diagnose/tokenize/restore 使用，不必为此另写一份
 * 几乎相同的函数。
 */
export function hostScopeFromDocument(
  doc: { query: V4QueryDefinition },
  reportCatalogTables: V4HostScopeReportCatalogTable[] = [],
  stagingSource?: { producerNodeId: string; producerLabel: string; columns: Array<{ code: string; name: string; type?: string }> }
): V4HostScope {
  const sources: V4HostScopeSource[] = [];
  const report_sources: V4HostScopeReportSource[] = [];
  // 视图来源清单：先收进本地数组，函数末尾按「非空才带键」的口径决定是否
  // 装配进返回值的 view_sources 字段，见 V4HostScope.view_sources 头注释。
  const view_sources: V4HostScopeViewSource[] = [];
  // 外部数据表来源清单：与 view_sources 同一收口手法（external 是 view 的翻版）。
  const external_sources: V4HostScopeExternalSource[] = [];
  const registeredTableIds = new Set<string>();
  let stagingBinding: { instance_id: string; alias: string } | undefined;
  for (const s of doc.query.sources) {
    if (s.kind === 'catalog') {
      sources.push({
        instance_id: s.instance_id,
        alias: s.alias,
        app_id: s.app_id,
        template_id: s.template_id,
        data_table_id: s.data_table_id
      });
    } else if (s.kind === 'report') {
      report_sources.push({
        instance_id: s.instance_id,
        table_id: s.table_id,
        table_role: s.table_role,
        alias: s.alias
      });
      registeredTableIds.add(s.table_id);
    } else if (s.kind === 'staging') {
      // 记住文档里的暂存绑定（instance_id/alias），供下面与入参 stagingSource 合并装配。
      stagingBinding = { instance_id: s.instance_id, alias: s.alias };
    } else if (s.kind === 'view') {
      view_sources.push({ instance_id: s.instance_id, app_id: s.app_id, view_id: s.view_id });
    } else if (s.kind === 'external') {
      external_sources.push({ instance_id: s.instance_id, app_id: s.app_id, external_stable_id: s.external_stable_id });
    }
  }
  // 目录兜底：补齐尚未显式登记的本报表表，让"引用它"这件事本身不再依赖"它是否已被引用过"。
  for (const table of reportCatalogTables) {
    if (registeredTableIds.has(table.table_id)) continue;
    report_sources.push({
      instance_id: reportInstanceId({ alias: '', data_table_id: table.table_id }),
      table_id: table.table_id,
      table_role: table.role,
      alias: table.label
    });
  }
  // 暂存来源信封：文档已有 kind='staging' 绑定、且调用方传了列清单（非空）才装配；两者缺一不带
  // （见函数头 stagingSource 参数注释）。alias 取绑定自身的 alias（为空回落 producerLabel）——
  // 与 expressionModelAdapter.ts 反向翻译写入的 alias 同源（ctx.stagingProducerLabel）。
  const staging_source: V4HostScopeStagingSource | undefined =
    stagingBinding && stagingSource && stagingSource.columns.length
      ? {
          instance_id: stagingBinding.instance_id,
          producer_node_id: stagingSource.producerNodeId,
          alias: stagingBinding.alias || stagingSource.producerLabel,
          columns: stagingSource.columns.map(c => ({
            column_id: c.code,
            label: c.name,
            data_type: c.type ?? 'text',
            nullable: true
          }))
        }
      : undefined;
  // view_sources/external_sources 仅在非空时才带这个键（见 V4HostScope.view_sources/
  // external_sources 头注释）：与 staging_source 的 omitempty 惯例一致，也避免服务端未来若改严格
  // 解码时收到一个当前还不认识的键。
  return {
    sources,
    report_sources,
    staging_source,
    ...(view_sources.length ? { view_sources } : {}),
    ...(external_sources.length ? { external_sources } : {})
  };
}

/**
 *
 * setScope/setNodeId 两个可选方法（收口批次新增，收口上一批登记的作用域信封 / node_id 占位缺口）：
 * 老宿主实现（未升级）不提供这两个方法，调用方须用可选链短路，行为与改造前一致（信封占位为空数组、
 * node_id 随机占位）——见 webAliceV4Host.ts 头注释「已知限制」。
 */
export interface AliceV4Host extends AliceV4DemoHost {
  tokenize(req: V4TokenizeRequest): Promise<V4TokenizeResponse>;
  restore(req: V4RestoreRequest): Promise<V4RestoreResponse>;
  /** 取数节点传 V4ExtractNodeDocument，写节点传
   *  V4WriteNodeDocument——宿主实现按 isWriteNodeDocument(doc) 判定装配 extract_v4 还是 write_v4
   *  请求体字段（见 V4CompileNodeRequest 注释），本接口签名不为此拆成两个方法。 */
  compile(doc: V4ExtractNodeDocument | V4WriteNodeDocument): Promise<V4CompileNodeResponse>;
  /** 设置当前查询作用域信封（sources/report_sources），供 diagnose/tokenize/restore 三端点随请求体
   *  携带。调用方（取数配置面）应在 query.sources 变化时随即调用。可选方法，向后兼容旧宿主。 */
  setScope?(scope: V4HostScope): void;
  /** 设置当前取数节点的真实 node_id，供 compile 端点随请求体携带（区分同一取数动作里的哪个节点）。
   *  可选方法，向后兼容旧宿主。 */
  setNodeId?(nodeId: string): void;
  /**
   * 拉取图表目录：图表目标区新增图表时，据此列出当前模板设计态
   * 表单已放置的图表控件供选择。条目形状见 ChartCatalogEntry（复用 ../host.ts 既有类型，七字段
   * chartId/chartType/chartForm/title/source/sheetId/sheetName）——与旧引擎 3.4 桥
   * ExpressionHost.fetchChartCatalog 语义逐字段一致，本方法是它在 V4 生产桥上的对应物，两者互不
   * 复用（🔴 V4 配置面不得直接读 3.4 的 'domain:expression' 桥键，见任务书「安全与并行纪律」）。
   * 可选是刻意的：老宿主（未升级）不实现该方法时，调用方应判空降级（图表目标区不可用/隐藏「+ 添加
   * 图表」入口），不得因此抛错崩溃。 */
  fetchChartCatalog?(templateId: string): Promise<ChartCatalogEntry[]>;
}

export const ALICE_V4_HOST: InjectionKey<AliceV4Host> = Symbol('alice-v4-host');

/** 在 setup 上下文中提供 AliceV4Host（生产桥）。与 provideAliceV4DemoHost 同范式，独立注入键，
 *  不与 demo host 共用——两条链路各自独立挂载，互不干扰。 */
export function provideAliceV4Host(host: AliceV4Host): void {
  provide(ALICE_V4_HOST, host);
}

/**
 * 组件内获取 AliceV4Host，缺失时抛具名错误（范式照抄 useAliceV4DemoHost）。额外校验 tokenize
 * 方法存在——AliceV4DemoHost 与 AliceV4Host 共享 loadCatalog/diagnose 形状，容易在挂载处误注入
 * demo host 顶替生产桥，这里显式拦截给出可定位的报错而非运行到 tokenize 调用点才炸参数类型错。
 * 只能在 setup() 顶层调用（Vue injection 约束）。
 */
export function useAliceV4Host(): AliceV4Host {
  const host = inject(ALICE_V4_HOST);
  if (!host || typeof (host as Partial<AliceV4Host>).tokenize !== 'function') {
    throw new Error(
      '[expression-editor/v4] ALICE_V4_HOST not provided or missing tokenize(). ' +
        '请在父组件调用 provideAliceV4Host(host) 后再挂载消费 AliceV4Host 的组件（不要误用 provideAliceV4DemoHost）。'
    );
  }
  return host;
}
