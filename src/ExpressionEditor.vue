<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, nextTick, ref, useSlots, watch } from 'vue';
import { NAlert, NButton, NSelect, NEmpty, NSwitch, NRadioGroup, NRadio, NPopover, NInputNumber, useMessage } from 'naive-ui';
import type {
  ExpressionModel,
  SourceTable,
  JoinSpec,
  FillStrategy,
  OutputMapping,
  ValueRef,
  TableRole,
  ConditionGroup,
  WriteOperation,
  TargetSpec,
  DockColumn,
  TextSource
} from './types';
import { extractConditionMatchKeys } from './matchKeyExtract';
// F3：校验条错误详情本地化——把后端拼装的原始错误串按模式表转成随语言切换的友好文案。
import { friendlyErrorMessage } from './errorMessages';
// W1「修改/删除必须指定条件」前端拦截已于 2026-09-10 撤销（见 writeWhereGuard.ts
// 头注释）——本文件不再 import/调用 writeWhereMissing，空定位条件现在合法，不参与确认前拦截。
import {
  useRefSyntax,
  useSystemVariableToken,
  useExpressionHost,
  useT,
  provideWriteTargetPoolTouch,
  provideExpressionEditorScopeOptions
} from './host';
import type { ChartCatalogEntry } from './host';
import type { ExpressionNotice, TemplateField } from './types';
import { tableRoleOf, rowMatchStrategyAllowed, isAttachmentFieldDataType, EXPRESSION_SCHEMA_VERSION } from './types';
import { REPORT_PREFIX } from './rawSerialize';
import { useExpressionContext, setExtraSystemVariables, viewCacheKey } from './useExpressionContext';
import { provideExpressionDrawer } from './expressionDrawerBus';
// 数据流左右分栏改版：撤下顶部常驻字段树坞（FieldTreeDock 仍保留供 AdvancedExpressionDialog/
// NodeConfigDialog 使用，只是本文件不再挂载它），改为①②面板 + ③/④右栏的左右分栏布局；
// 字段选择改由各值单元格自带的 ⊞ 快捷选择器（QuickFieldPicker，preferQuickPick）承担，详见任务汇报。
import { instanceSuffix, isReportContextAlias } from './rawSerialize';
import { restoreTextFromSource } from './textSource';
import { pickedRefForSyntax, valueRefToBracketText } from './bracketText';
// 写模式「自赋值」兜底提示（用户 09-10 反馈修法，见该模块头注释）：判据本身与组件解耦，本文件
// 只负责按当前来源/字段目录算出 selfRefText 喂给它，渲染成④段行下方一条 info 级提示。
import { writeSelfAssignmentFieldIds } from './writeSelfAssignment';
import { reportTableNamesInText, plainTableNameReferencedInText } from './reportTextRefs';
import {
  REPORT_INSTANCE_PREFIX,
  reportInstanceTableId,
  targetSourceAlias,
  isWriteTargetSourceAlias
} from './v4/expressionModelAdapter';
import { systemVariablesCatalog } from './useExpressionContext';
import type { ConditionConfirmPayload } from './ConditionEditorDialog.vue';
// 树坞列透传：本文件已按模板归属精确分组（见下方 currentColumnForDock/sourceColumnsForDock），
// 打包成 DockColumnsBundle 经 ExpressionInput 透传给 AdvancedExpressionDialog/QuickFieldPicker，
// 后者优先用精确分组、不必再从 Lite 形态降级重算（降级构造器 buildDockColumnsFromLite 只给拿不到
// 模型上下文的调用方兜底）。
import type { DockColumnsBundle } from './dockColumns';
import ExpressionInput from './ExpressionInput.vue';
import FieldTypeIcon from './FieldTypeIcon.vue';
import SourceTreePicker from './SourceTreePicker.vue';
import ConditionReadonlyView from './ConditionReadonlyView.vue';
import ConditionEditorDialog from './ConditionEditorDialog.vue';
import JoinDesignerDialog from './JoinDesignerDialog.vue';
import ChartTargetSection from './ChartTargetSection.vue';
import { isEmptyExpr, isUnconfiguredOutputExpr } from './outputExprState';
import type { ChartTargetSpec } from './types';
// 多填充目标归一化工具。
import { readTargets, readChartTargets, writeTargets, emptyTarget, chartSlotExpressions } from './modelTargets';
// Phase B（动作暂存区）：暂存目标归一化助手 + 单 spec 编辑器 + 暂存列→字段面板形状转换。
import { readTableTargets, readStagingTarget, hasStagingSource, emptyStagingTarget } from './modelTargets';
import StagingTargetSection from './StagingTargetSection.vue';
import { stagingColumnToTemplateField } from './useExpressionContext';
// token 语义色板（全包唯一定义处；非 scoped 全局样式，重复 import 由打包器去重）。
import './token-colors.css';
import './qb-segment.css';
import { splitLabeledTextSegments, tableColorClassFor } from './tableThemeColors';
import type { ExpressionEditorProps, ExpressionEditorEmits } from './contract';

/**
 * 标准化表达式编辑器（数据流左右分栏改版）：output 形态左右分栏——左栏（约 38% 宽）自上而下
 * ①来源表 / ②筛选条件两面板（2:3 定比，各自区内滚动，只读渲染、点击打开对应编辑弹窗
 * ConditionEditorDialog/JoinDesignerDialog）；右栏＝③目标与字段（复用既有全部逻辑）。
 * judge 形态（hideTargetSection=true）不渲染右栏，左栏横向铺满。写模式（writeOperation 非空）
 * 右栏渲染既有「写目标段」内容，左栏不变。撤下此前纵向四段+顶部常驻字段树坞的布局
 * （FieldTreeDock 组件仍保留，供 AdvancedExpressionDialog 使用，本文件不再挂载）。
 * 模型层/reconcile/校验/字段目录加载均未改动，产出统一中间模型 ExpressionModel，
 * 保存进 node.params.expression。
 */
const props = defineProps<ExpressionEditorProps>();
/** 本子树的字段引用书写语法（./host.ts RefSyntax）：V4 取数配置面 provide 'brackets'。 */
const refSyntax = useRefSyntax();
const isV4RefSyntax = refSyntax === 'brackets';
// 系统变量的 V4 文本标记解析口（配置面按目录 provide；3.4 场景恒 undefined，拾取走既有结构化路径）。
const systemVariableToken = useSystemVariableToken();
const emit = defineEmits<ExpressionEditorEmits>();
// 2026-08-18 追加（表格编辑器控件设置换轨内嵌本编辑器，纯加法）：可选具名插槽 target-panel——存在时右栏
// 渲染调用方内容替代内置③目标/④写目标段（左栏①②与分栏骨架由本编辑器统一承载，保证消费方与
// 全局表达式编辑器同源同观感）。无 slot 的既有调用方零影响。
const slots = useSlots();
const hasCustomTarget = computed(() => !!slots['target-panel']);
// 2026-09-12 追加：可选具名插槽 left-top——存在时在左栏渲染，
// 写模式①目标段之后、来源段之前（见模板 qb-left-top-slot）。判据与写法完全照抄上面的
// hasCustomTarget/target-panel 先例，不另开一套插槽存在性判断方式。
const hasLeftTop = computed(() => !!slots['left-top']);

let initialReconcileResolved = false;
let resolveInitialReconcile!: () => void;
const initialReconcileSettled = new Promise<void>(resolve => {
  resolveInitialReconcile = resolve;
});
function markInitialReconcileSettled(): void {
  if (initialReconcileResolved) return;
  initialReconcileResolved = true;
  resolveInitialReconcile();
}
defineExpose({
  /** 宿主据此等待异步目录加载 + 首轮 reconcile 真正落定，再建立“未编辑”基线。 */
  whenInitialReconcileSettled: () => initialReconcileSettled,
  // finalize 定义在下方（依赖 reconcile/collectUsedAliases/isEmptyExpr 等），此处仅登记引用；
  // <script setup> 顶层的 function 声明整体提升，运行时可正常解析。
  finalize
});
onBeforeUnmount(markInitialReconcileSettled);

// 写模式判定（单一来源=prop；同时把 operation 种入模型，供后端编译/校验分流）。
const writeOp = computed<WriteOperation>(() => props.writeOperation ?? '');
const isWriteMode = computed(() => writeOp.value !== '');
/**
 * 2026-09-12 追加：分段编号偏移——所有 .seg-n 圆圈里显示的数字
 * 统一加上 props.segmentOffset（缺省 0），供调用方在编辑器之外另起了若干段时让编号自然接续。
 * 模板里各处原本直接写字面量/`isWriteMode ? x : y` 三元表达式，这里统一收口成一个函数，各处
 * 改成 `segNo(原表达式)` 即可，不改变默认（偏移 0）时的渲染结果。 */
function segNo(n: number): number {
  return n + (props.segmentOffset ?? 0);
}
// 用户 09-10 两轮反馈演进：上一卡曾判定写模式删除操作右栏（④填充字段）结构性恒无内容、比照取数
// judge 形态整体不渲染右栏（isWriteRightEmpty，本轮已撤）。本轮改判：删除模式右栏改放③定位条件
// （左栏只留①删除目标②来源），故删除模式右栏不再是"空"——本变量与其三处 class/渲染分支已删除，
// 见下方模板 qb-layout/qb-left/qb-right 与 script writeTargetFields 附近对应改动。

const message = useMessage();
// P1：host 在 setup 顶层 inject，appId 由 host 闭包持有。
const host = useExpressionHost();
const t = useT();
const ctx = useExpressionContext({ templateId: props.templateId });
const bus = provideExpressionDrawer();

// 2026-08-15 追加：extraSystemVariables prop → 模块级
// 系统变量目录合并单例（见 useExpressionContext.ts setExtraSystemVariables/systemVariablesCatalog）。
// immediate:true 使编辑器一打开就带上调用方追加项，不必等一轮交互；onBeforeUnmount 清空——
// systemVariablesCatalog 是全包共享单例，不清空会把这次打开的追加项残留到下一次未传该 prop 的调用。
watch(
  () => props.extraSystemVariables,
  v => setExtraSystemVariables(v ?? null),
  { immediate: true }
);
onBeforeUnmount(() => setExtraSystemVariables(null));

provideExpressionEditorScopeOptions({
  disableSystemVariables: computed(() => !!props.disableSystemVariables),
  unsupportedFieldTypes: computed(() => props.unsupportedFieldTypes ?? [])
});

// 模板 ID → 名称（来源 tag tooltip 显示真实模板名，含本报表对应模板）。
const templateNames = ref<Record<string, string>>({});
onMounted(() => {
  // 迁移既有配置：ctx 加载后（tableFields 就绪，reportDataTableOf 才可用）跑一次 reconcile——把「条件段
  // 关联式」等旧形态规范化为内存匹配键等。reconcile 幂等，仅当模型确有变化才回传，避免对已规范模型无谓 dirty。
  void ctx
    .load()
    .then(async () => {
      // 预取模型里已有来源表所属模板的**表清单(补表名)**与**字段(补字段面板/表达式标签)**：ctx.load() 只加载
      // **当前模板**；来源表常属其它模板，重开时若不预取，来源表显示成裸 data_table_id、字段面板空、输出/匹配键
      // 里的 source_field 标签解析不出（表现为"来源表信息丢失、无法还原"）。tablesOf/ensureFields 均缓存幂等；
      // 失败静默不阻断迁移。
      const srcTables = model.value.source.tables.filter(t => t.template_id && t.data_table_id);
      const srcTemplates = [...new Set(srcTables.map(t => t.template_id))];
      // 跨应用来源：重开时按模型里的 app_id 向所属应用预取（模板/数据表 ID 全局唯一，缓存键不变）。
      const appByTemplate: Record<string, string | undefined> = {};
      for (const st of srcTables) if (st.app_id) appByTemplate[st.template_id] = st.app_id;
      // 写模式：额外预取写目标表所属模板/字段（insert 跨模板目标常不在来源段，重开时需补齐表名/字段/角色）。
      const tgt = model.value.target;
      const extraTables =
        isWriteMode.value && tgt.target_template_id && tgt.target_data_table_id
          ? [
              {
                template_id: tgt.target_template_id,
                data_table_id: tgt.target_data_table_id
              }
            ]
          : [];
      const allTemplates = [...new Set([...srcTemplates, ...extraTables.map(t => t.template_id)])];
      // views-extraction-b3 R3：预取模型里已有 view 来源的视图 schema（名称+输出列），否则重开配置时
      // 视图来源显示裸 view_id、字段面板缺该视图列。ensureViewFields 自身容错（失败/宿主不支持返回空）。
      const viewSources = model.value.source.tables.filter(t => t.source_type === 'view' && t.view_id);
      await Promise.all([
        ...allTemplates.map(tid => ctx.tablesOf(tid, appByTemplate[tid]).catch(() => [])),
        ...srcTables.map(t => ctx.ensureFields(t.template_id, t.data_table_id, t.app_id).catch(() => [])),
        ...extraTables.map(t => ctx.ensureFields(t.template_id, t.data_table_id).catch(() => [])),
        ...viewSources.map(t => ctx.ensureViewFields(t.view_id as string, t.app_id || undefined)),
        ...viewSources.map(t => ctx.ensureViewMeta(t.view_id as string, t.app_id || undefined))
      ]);
      // 写模式「目标」相关来源：上一步 ctx.tablesOf 已就位，才能按角色算出
      // 隐含来源/候选池里「另一半」表（目标模板主表↔扩展表配对，见 writeTargetSourcePlanFor）；
      // 其字段目录（②面板「目标」分组、④字段列表用得到）此刻才补拉——与 extraTables 只拉目标表
      // 自身字段的既有预取是两件事，合并进同一批 await，不再单独等一轮。
      if (isWriteMode.value) {
        const plan = writeTargetSourcePlanFor(model.value);
        const otherId = [plan.implicitDataTableId, plan.poolDataTableId].find(
          (id): id is string => !!id && id !== tgt.target_data_table_id
        );
        if (otherId) await ctx.ensureFields(tgt.target_template_id, otherId).catch(() => []);
      }

      const migrated: ExpressionModel = JSON.parse(JSON.stringify(props.modelValue));
      // 写模式：把 operation 种入模型（新建节点或旧模型无 operation 时），供后端编译/校验分流。
      if (isWriteMode.value && migrated.target.operation !== writeOp.value) migrated.target.operation = writeOp.value;
      reconcile(migrated);
      if (JSON.stringify(migrated) !== JSON.stringify(props.modelValue)) {
        emit('update:modelValue', migrated);
      }
    })
    .finally(markInitialReconcileSettled);
  // P1：改用 host.listTemplates()，无 appId（host 闭包持有）。
  void host.listTemplates({ recursive: true }).then(templates => {
    const map: Record<string, string> = {};
    for (const t of templates) map[t.template_id] = t.template_name;
    templateNames.value = map;
  });
  // 跨应用取数：拉应用名映射，供跨应用来源 tag 显示「应用名 › 表名」；宿主不支持/失败时静默
  //（tag 回落裸表名，不阻断编辑器）。同时记下 is_current 条目的应用名（F1②：①来源行副文案
  //「模板名 - 应用名」本应用来源也要显示应用名，与跨应用来源统一口径）。
  if (typeof host.listApps === 'function') {
    void host
      .listApps()
      .then(apps => {
        const map: Record<string, string> = {};
        for (const a of apps) map[a.app_id] = a.app_name;
        appNames.value = map;
        const current = apps.find(a => a.is_current);
        currentAppName.value = current?.app_name ?? '';
        currentAppId.value = current?.app_id ?? '';
      })
      .catch(() => {});
  }
});

// 应用 ID → 名称（跨应用来源 tag 前缀显示；未加载/未知回落裸 app_id）。
const appNames = ref<Record<string, string>>({});
// F1②：当前应用名称（①来源行副文案「模板名 - 应用名」本应用来源专用；未加载到时空串，
// 由 srcMetaText 按"未加载不显示该段"处理，不兜底裸 app_id）。
const currentAppName = ref('');
// 当前应用 ID（listApps 的 is_current 条目）：V4 文档的目录来源恒带 app_id（本应用也带，见
// v4/expressionModelAdapter 反向翻译按 ctx.appId 补齐），来源名前缀须据此排除本应用，只给真正的
// 跨应用来源加「应用名 ›」。宿主未实现 listApps 时为空串。
const currentAppId = ref('');

const model = computed(() => props.modelValue);

/**
 * 视图来源字段/元信息的**持续**预取（2026-09-14 修复：视图作为数据源时字段面板恒「无字段」）。
 *
 * 为什么只有挂载期预取 + 选中时预取不够：字段缓存键是 `viewCacheKey(view_id, app_id)`（含应用维度），
 * 而 `app_id` 会在编辑期**变化**——来源选择器对**当前应用**的视图恒不下发 appId（见 SourceTreePicker
 * 视图叶子分支注释），于是 onSelectSources 按裸 view_id 写入缓存；随后调用方（取数/控件查询配置面）
 * 每次改动都会把模型翻成 V4 文档再翻回来，正向翻译按 `app_id: t.app_id || ctx.appId` 给视图来源**补齐**
 * 当前应用 ID（见 v4/expressionModelAdapter.ts），反向翻译原样带回 ⇒ 读缓存的键从 `view_id` 变成
 * `app:view_id`，与写入键对不上，字段面板整列塌成「无字段」（视图名仍在，因为 viewNameCache 按裸
 * view_id 存）。同理，模型晚于编辑器挂载才装载时，挂载期那一次预取也什么都取不到。
 *
 * 修法不是去动 app_id 的写入口径（那会牵动持久化形状与跨应用语义），而是把预取从「两个时间点的
 * 一次性动作」改成「跟着模型里的 (view_id, app_id) 组合走」：组合变了就按新键补一次。ensureViewFields/
 * ensureViewMeta 自身幂等且带缓存（命中即同步返回），故重复触发不会产生多余请求；两者都自带容错，
 * 失败只落空列表、不抛错。
 */
watch(
  () =>
    JSON.stringify(
      (model.value?.source?.tables ?? [])
        .filter(t => t.source_type === 'view' && t.view_id)
        .map(t => [t.view_id, t.app_id ?? ''])
    ),
  keys => {
    for (const [viewId, appId] of JSON.parse(keys) as [string, string][]) {
      if (!viewId) continue;
      void ctx.ensureViewFields(viewId, appId || undefined);
      void ctx.ensureViewMeta(viewId, appId || undefined);
    }
  },
  { immediate: true }
);

function update(mut: (m: ExpressionModel) => void): void {
  // P6c 前端只读闸（2026-08-12 权限架构终局裁定②）：本文件全部模型变更唯一收口点，只读态下一律
  // 吞掉——作为 UI 层各按钮/输入禁用之外的第二道防线，防止漏改某个入口仍能把变更写回 modelValue。
  if (props.readonly) return;
  const next: ExpressionModel = JSON.parse(JSON.stringify(props.modelValue));
  mut(next);
  reconcile(next);
  emit('update:modelValue', next);
}

/** 打开表关联设计器（①头部入口 / 行尾徽标 / 选源后自动弹出三处共用）：只读态直接吞掉，不弹窗——
 *  弹窗内的增删改最终仍会经 onUpdateJoins → update() 被挡，这里额外挡在"打开"这一步，避免用户
 *  白白操作一遍才发现改不动。 */
function openJoinDesigner(): void {
  if (props.readonly) return;
  showJoinDesigner.value = true;
}
/** 打开筛选条件编辑弹窗（②面板点击）：同上，只读态不弹窗。 */
function openConditionDialog(): void {
  if (props.readonly) return;
  showConditionDialog.value = true;
}

// —— 隐式来源调和（每次 update 后跑）：本报表上下文表「用到才纳入」+ 自动 record_id 关联 ——

const REPORT_ALIAS_PREFIX = 'bt'; // 本报表隐式 context 表别名前缀（bt0=主表/bt1..=扩展），与显式来源 t1/t2 不冲突
/** 本报表第 i 张表的隐式 context 别名。 */
function reportAlias(index: number): string {
  return `${REPORT_ALIAS_PREFIX}${index}`;
}
/** 由 context 别名反解本报表 data_table_id（按 ctx.tableFields 顺序）。 */
function reportDataTableOf(alias: string): { dataTableId: string; role: TableRole } | null {
  // V4 文档往返回来的本报表来源别名是 rpt-<table_id>-<6hex>（见 v4/expressionModelAdapter.reportInstanceId），
  // 按 table_id 反查；编辑器自己物化的仍是 bt<i> 按下标反查。
  const rptTableId = reportInstanceTableId(alias);
  const tf = rptTableId
    ? ctx.tableFields.value.find(t => t.table.data_table_id === rptTableId)
    : alias.startsWith(REPORT_ALIAS_PREFIX)
      ? ctx.tableFields.value[Number(alias.slice(REPORT_ALIAS_PREFIX.length))]
      : undefined;
  if (!tf) return null;
  return {
    dataTableId: tf.table.data_table_id,
    role: tableMeta(props.templateId, tf.table.data_table_id).role
  };
}
function isReportContext(t: SourceTable): boolean {
  return t.is_context && (t.alias.startsWith(REPORT_ALIAS_PREFIX) || t.alias.startsWith(REPORT_INSTANCE_PREFIX));
}
/** 本报表某张表在当前模型里的上下文别名：已物化（bt<i> 或往返回来的 rpt-*）取现有别名，否则按下标给 bt<i>。 */
function reportContextAliasFor(m: ExpressionModel, dataTableId: string): string | null {
  const existing = m.source.tables.find(t => isReportContext(t) && t.data_table_id === dataTableId);
  if (existing) return existing.alias;
  const idx = ctx.tableFields.value.findIndex(tf => tf.table.data_table_id === dataTableId);
  return idx >= 0 ? reportAlias(idx) : null;
}

/** 收集模型里所有被引用的 source_field 别名（含 where/where_expr/目标/排序/分组/join on）。
 *  须递归 raw.refs / 开窗 / case，否则本报表字段仅在表达式里用到时其 bt* 上下文表不会被纳入。
 *  extra：调用方显式喂入的额外引用面（供 reconcile ⓪ 段用——自动匹配模式下条件段关联式已被
 *  extractConditionMatchKeys 从 where 剥离，而剥离出的 conditionKeys 要到 reconcile ③ 段才写回
 *  target.match_keys，本轮调和期间它既不在 where 也不在 match_keys 里，若不显式喂入会被误判成
 *  "未引用"，其所属的本报表 context 表会被①段当场剔除——喂 extra 补上这个引用面）。 */
function collectUsedAliases(m: ExpressionModel, extra: ValueRef[] = []): Set<string> {
  const used = new Set<string>();
  function walk(v?: ValueRef | null): void {
    if (!v) return;
    if (v.kind === 'source_field' && v.alias) used.add(v.alias);
    // V4（brackets）壳：引用是纯文本，本报表字段写作 `本报表.[表].[字段]`——按表显示名反查 bt* 别名计入
    // 「已引用」，否则调和会把该上下文表当成未引用剔除，V4 文档里就永远没有这张表的 report 来源。
    if (refSyntax === 'brackets' && v.kind === 'raw' && v.text) {
      for (const name of reportTableNamesInText(v.text)) {
        const tf = ctx.tableFields.value.find(t => t.table.table_name === name);
        const alias = tf ? reportContextAliasFor(m, tf.table.data_table_id) : null;
        if (alias) used.add(alias);
      }
    }
    (v.args ?? []).forEach(walk);
    (v.refs ?? []).forEach(walk);
    (v.partition_by ?? []).forEach(walk);
    (v.win_order_by ?? []).forEach(k => walk(k.value));
    (v.cases ?? []).forEach(b => {
      walkGroup(b.when);
      walk(b.then);
    });
    walk(v.else);
  }
  function walkGroup(g?: ConditionGroup): void {
    if (!g) return;
    for (const it of g.items) {
      if (it.predicate) {
        walk(it.predicate.left);
        walk(it.predicate.right);
      }
      walkGroup(it.group);
    }
  }
  // 404:22903 二轮：目标由单数升级为多数，别名收集须逐 readTargets 循环（每个 target 的 outputs 都要走一遍），
  // 否则某个后加的表目标里引用的 bt* 本报表上下文字段不会被判定为"用到"，会被下面①段的过滤逻辑误剔除。
  // judge 模式的合法模型只有 source + where/where_expr，不携带任何 target。此前这里无条件调用
  // readTargets，后续 reconcile 又直接读取 m.target.auto_row_match，导致工作流 Edge/Wait/Block
  // 打开统一条件编辑器时抛错，弹窗无法完成确认。目标相关调和只属于 output/write 模式。
  if (!props.hideTargetSection) {
    readTargets(m).forEach(target => {
      target.outputs.forEach(o => walk(o.expression));
      // 既有 match_keys（手动模式的行列匹配键，或自动模式上一轮已写回的匹配键）同样是引用面——
      // 其 source_expr 常年指向某张显式来源表，遗漏会让该表被①/②段误判"未引用"而被剔除/剪掉。
      (target.match_keys ?? []).forEach(k => walk(k.source_expr));
    });
    // 🔴 图表槽位同样是引用面：一个「只把本报表扩展表的数据推进图表」的节点，
    // 全部引用都写在 chart_targets 的槽位表达式里，表目标一个都没有。此前这里只扫 readTargets，
    // 于是那张扩展表被①段判成"未引用"、永不进 source.tables ⇒ V4 文档 query.sources 为空，
    // 保存闸当场报「query.sources 至少需要 1 条」——用户配得好好的，却被告知没有来源表。
    readChartTargets(m).forEach(chart => chartSlotExpressions(chart).forEach(walk));
  }
  (m.order_by ?? []).forEach(k => walk(k.value));
  walkGroup(m.where);
  walk(m.where_expr);
  if (m.where_text_source?.text) walk({ kind: 'raw', text: m.where_text_source.text });
  m.source.joins.forEach(j =>
    (j.on ?? []).forEach(on => {
      used.add(on.left.alias);
      used.add(on.right.alias);
    })
  );
  extra.forEach(walk);
  return used;
}

/** 调和：①本报表 context 表用到才纳入、未用剔除；②同模板主+明细自动 record_id 关联（含本报表主+扩展）。 */
function reconcile(m: ExpressionModel): void {
  m.schema_version = EXPRESSION_SCHEMA_VERSION;
  delete m.group_by;
  if (!props.hideTargetSection && isWriteMode.value) {
    delete m.target.clear;
    delete m.target.match_keys;
    delete m.target.auto_row_match;
    // post_sort 已随 V4 规格从 TargetSpec 类型删除（执行后排序由查询 ORDER BY 承接）；存量模型可能仍带该键，剥离用宽类型。
    // 双段断言（as unknown as）：TargetSpec 是具名结构、无字符串索引签名，直接转 Record 会被
    // TS2352 拒（RC 插件前端的 vue-tsc 会检查到本文件）。这里只是为了删一个已从类型删除的存量键。
    delete (m.target as unknown as Record<string, unknown>).post_sort;
  }
  // ⓪ 条件段关联式 → 内存匹配键（须在收集别名前：移除等式后其明细 context 表将不再被引用而被回收）。
  //    仅在开启 auto_row_match 时启用（写模式恒关），避免把普通 where 过滤条件误判为匹配键。提取逻辑见 matchKeyExtract.ts。
  const whereBeforeExtract = m.where_text_source ? JSON.stringify(m.where ?? null) : '';
  const conditionKeys = !props.hideTargetSection && m.target?.auto_row_match
    ? extractConditionMatchKeys(m, alias => reportDataTableOf(alias)?.dataTableId ?? null)
    : [];
  if (whereBeforeExtract && JSON.stringify(m.where ?? null) !== whereBeforeExtract) delete m.where_text_source;
  // 硬切换：历史文档里残留的 raw where_expr 在调和总闸门处恒剥离（服务端保存闸拒绝非空 where_expr）。
  delete m.where_expr;

  // conditionKeys 尚未写回 target.match_keys（要到下方③段才写回），本轮引用面须显式喂入
  // collectUsedAliases，否则条件段刚提取出的匹配键所属别名会被①段误判"未引用"而被剔除。
  const used = collectUsedAliases(m, conditionKeys.map(k => k.source_expr));

  for (const alias of [...used]) {
    if (!alias.startsWith(REPORT_ALIAS_PREFIX)) continue;
    const info = reportDataTableOf(alias);
    if (!info) continue;
    const existing = m.source.tables.find(t => isReportContext(t) && t.data_table_id === info.dataTableId);
    if (existing) {
      used.add(existing.alias);
      continue;
    }
    m.source.tables.push({
      alias,
      source_type: 'template',
      template_id: props.templateId,
      data_table_id: info.dataTableId,
      is_context: true,
      role: info.role
    });
  }
  m.source.tables = m.source.tables.filter(t => !isReportContext(t) || used.has(t.alias));

  // 写模式「目标」相关来源：目标先行段选定的目标数据表本身不进
  // source.tables（不是"查询"，是"写库目标"），但目标模板的配对表（承载记录身份的隐含来源 /
  // 已引用的候选池表）要按 writeTargetSourcePlanFor 的口径纳入/剔除——须放在①段之后（本报表
  // context 表已就位）、"无来源兜底"之前（有目标来源时不必再兜底本报表主表），见
  // reconcileWriteTargetSources 头注释。
  if (!props.hideTargetSection && isWriteMode.value) {
    reconcileWriteTargetSources(m);
  }

  // 多余来源表剪枝（显式来源表未被引用即剔除）：不再放在 reconcile（每次 update 都跑，用户刚选好表
  // 还没配任何字段/条件时会被误判"未引用"当场剪掉，是交互回归）——已迁到 finalize()（确认时一次性
  // 收口），见该函数注释。

  if (!props.hideTargetSection && m.source.tables.length === 0) {
    const mainIdx = ctx.tableFields.value.findIndex(
      tf => tableMeta(props.templateId, tf.table.data_table_id).role === 'main'
    );
    if (mainIdx >= 0) {
      const mainAlias = reportAlias(mainIdx);
      const info = reportDataTableOf(mainAlias);
      if (info) {
        m.source.tables.push({
          alias: mainAlias,
          source_type: 'template',
          template_id: props.templateId,
          data_table_id: info.dataTableId,
          is_context: true,
          role: 'main'
        });
      }
    }
  }

  // 本报表扩展（明细）锚点：若用到本报表明细 context，自动纳入本报表主表 context 作 record_id 关联锚点
  // （即便主表字段未直接使用），否则明细临时表无关联锚点、SQL 不合法。
  if (m.source.tables.some(t => isReportContext(t) && t.role === 'detail')) {
    const mainIdx = ctx.tableFields.value.findIndex(
      tf => tableMeta(props.templateId, tf.table.data_table_id).role === 'main'
    );
    if (mainIdx >= 0) {
      const mainAlias = reportAlias(mainIdx);
      const info = reportDataTableOf(mainAlias);
      const alreadyPresent =
        !!info && m.source.tables.some(t => isReportContext(t) && t.role === 'main' && t.data_table_id === info.dataTableId);
      if (!alreadyPresent && info) {
        m.source.tables.push({
          alias: mainAlias,
          source_type: 'template',
          template_id: props.templateId,
          data_table_id: info.dataTableId,
          is_context: true,
          role: 'main'
        });
      }
    }
  }

  // ②前置 目录来源角色回填（表清单缓存为权威）：V4 的 catalog SourceBinding **不落 table_role**
  // （见 v4/expressionModelAdapter.ts sourceBindingToTable / applyCatalogRoleFromJoins），打开一份
  // 已保存的文档时，显式数据表来源的 role 只能从"文档里已存在的自动 record_id 关联 ON"反推。于是
  //「先只选主表保存 → 重开后再加扩展表」这条最常见的操作顺序里，旧来源的 role 恒缺失，下方
  // byTemplate 分组永远找不到 main（`if (!main) continue`），自动关联再也补不出来——视图设计器尤其
  // 明显（视图的来源就是同模板的主表 + 扩展表，用户期望二者按 record_id/parent_record_id 自动关联）。
  // onMounted 已 await 过全部来源模板的 ctx.tablesOf（见该处预取段），此处按表清单现查角色补齐。
  // 🔴 查不到就保持 undefined，**不套 tableMeta 的 'detail' 回落**：把主表误判成明细会让下方合成出
  // 方向相反的父子关联（`主表.parent_record_id = 明细.record_id`），比"补不出关联"危险得多。
  for (const t of m.source.tables) {
    if (t.role || t.source_type !== 'template' || !t.template_id || !t.data_table_id) continue;
    const tablesInTemplate = ctx.tablesCache.value[t.template_id] ?? [];
    const hit = tablesInTemplate.find(x => x.data_table_id === t.data_table_id);
    if (hit) t.role = tableRoleOf(hit, tablesInTemplate);
  }

  // ② 自动 record_id 关联：每模板内 主表 ↔ 各明细。**显式来源与本报表上下文分组隔离**
  //（key 含 ctx/src），避免把显式来源表与本报表上下文表互相 record_id 关联（二者是不同概念）。
  const byTemplate: Record<string, { main?: SourceTable; details: SourceTable[] }> = {};
  for (const t of m.source.tables) {
    // views-extraction-b3 R4：view 来源显式跳过自动 record_id 关联分组。为什么必须门控：视图是物化
    // 查询结果，**没有 record_id 列**，参与自动关联会编译出非法 SQL；且 view 源的 template_id 恒为
    // 空串，若不跳过会与其他空 template_id 来源（如未来新增来源类型）按 ''::src 误配同组。
    // Phase B：staging（暂存区）来源同理跳过——同样没有物理表/record_id 列，且 template_id 同样恒空串，
    // 不跳过会与 view（同为空 template_id）或未来新增来源类型按 ''::src 误配同组，编译出非法 SQL。
    // S2b：external（外部数据表）来源同理跳过——同样没有 record_id 列，template_id 同样恒空串。
    if (t.source_type === 'view' || t.source_type === 'staging' || t.source_type === 'external') continue;
    const key = `${t.template_id}::${isReportContext(t) ? 'ctx' : 'src'}`;
    const g = (byTemplate[key] ??= { details: [] });
    if (t.role === 'main') g.main = t;
    else if (t.role === 'detail') g.details.push(t);
  }
  for (const tid of Object.keys(byTemplate)) {
    const { main, details } = byTemplate[tid];
    if (!main) continue;
    for (const d of details) {
      const exists = m.source.joins.some(
        j =>
          j.auto_record_id &&
          ((j.left_alias === main.alias && j.right_alias === d.alias) ||
            (j.left_alias === d.alias && j.right_alias === main.alias))
      );
      const alreadyIntroduced = m.source.joins.some(j => j.right_alias === d.alias);
      if (!exists && !alreadyIntroduced)
        m.source.joins.push({
          left_alias: main.alias,
          right_alias: d.alias,
          join_type: 'left',
          auto_record_id: true,
          on: []
        });
    }
  }
  // 剔除端点已失效（表被移除 / 不再同模板主+明细）的自动关联。
  m.source.joins = m.source.joins.filter(j => {
    if (!j.auto_record_id) return true;
    const l = m.source.tables.find(t => t.alias === j.left_alias);
    const r = m.source.tables.find(t => t.alias === j.right_alias);
    // views-extraction-b3 R4：任一端是 view 来源的自动关联一律剔除（视图无 record_id 列，历史/异常
    // 产物不得存留）；显式手动 join（auto_record_id=false）不受影响，上面 return true 已放行。
    // Phase B：staging 来源同理剔除（暂存区同样没有 record_id 列）。S2b：external 来源同理剔除。
    if (
      l?.source_type === 'view' ||
      r?.source_type === 'view' ||
      l?.source_type === 'staging' ||
      r?.source_type === 'staging' ||
      l?.source_type === 'external' ||
      r?.source_type === 'external'
    )
      return false;
    // 端点须同模板、主+明细、且同属（显式来源 或 上下文），否则不再是合法的自动关联。
    return (
      !!l && !!r && l.template_id === r.template_id && l.role !== r.role && isReportContext(l) === isReportContext(r)
    );
  });

  // ③ 按行列匹配键按模式二选一取源（与填充策略下拉的门控一致，避免两条通道并存）：
  //    - 自动模式(auto_row_match=true)：匹配键来自⓪条件段关联式（extractConditionMatchKeys 已提取并从 where
  //      移除）。**新写了条件才覆盖；无新条件则保留既有 match_keys**——条件段一旦迁移即被消费(where 清空)，
  //      match_keys 遂成权威；重开/再调和时不得据"当前无条件"把它清空（否则迁移后一打开就丢匹配键，回退到 matchKeys=0）。
  //    - 手动模式(auto_row_match=false)：match_keys 完全由填充策略=row_match 的输出决定（含清空——移除最后一个
  //      row_match 输出即清空）。此模式下条件段不提取匹配键。
  //    匹配键来源列进 SELECT m_<seq>、目标字段 ID 作 form_field_id；突合由插件在 Mirror 内存里对全明细行做
  //    左驱 left join（命中填值/一对多复制左行扩充/未命中保留），**不把明细表物化成临时表 JOIN**。
  //    写模式恒无匹配键（上方已剥离且不再回写），此段仅取数模式执行。
  // 404:22903 二轮「reconcile 正确性关键」：目标由单数升级为多数，match_keys 回写须逐 readTargets 循环——
  // 对每个 target 套用原单目标的同一套规则（自动模式取⓪条件段提取结果——仍只归属"条件段实际解析时定位的那张
  // 目标明细表"，即 m.target.target_data_table_id，因为 matchKeyExtract.ts 本身按单目标语义硬编码解析，本次
  // 不改造该文件；手动模式按各自 outputs 里 row_match 策略的行独立算各自的 match_keys）。
  // **收尾必须重新 writeTargets**：readTargets 在 model.targets 已存在时返回其数组引用，mutate target 对象后，
  // legacy 镜像字段 m.target（writeTargets 深拷贝而来的独立对象）不会自动同步——不重新写回就会出现「targets[i]
  // 已更新但镜像 target 仍是旧值」的双写不一致（旧读者读到过期 match_keys）。此调用同时把模型规整进
  // target/targets/chart_targets 三件套双写形态（modelTargets.ts 唯一入口），旧模型（仅 target）首次经过本编辑器
  // 编辑起会带上 targets 键，属预期的形态归一化，不是数据丢失。
  if (!props.hideTargetSection && !isWriteMode.value) {
    const targets = readTargets(m);
    for (const tgt of targets) {
      const tgtRole = tgt.target_table_role ?? tableMeta(props.templateId, tgt.target_data_table_id).role;
      if (tgtRole === 'main') {
        delete tgt.auto_row_match;
        delete tgt.match_keys;
        // 排序同理（用户 2026-09-08）：主表恒一行，界面已不提供排序控件，存量/非常规写入携带的
        // order_by 在此就地剥离，避免它一路带到 V4 文档里去排一张只有一行的表。
        delete tgt.order_by;
        tgt.outputs = tgt.outputs.map(o => (o.fill_strategy === 'row_match' ? { ...o, fill_strategy: 'overwrite' as const } : o));
        continue;
      }
      // 悬空排序键清理：排序键必须指向本目标 outputs 里的字段（服务端 extractdoc 解码闸核对，
      // 悬空即整份文档被拒）。用户把某字段的输出行 ✕ 清空、或目标字段被删时，它的排序键会成悬空——
      // 这里按当前 outputs 过滤一遍；过滤后为空仍保留空数组（"用户清空了排序"，不退回"未编辑过"）。
      if (tgt.order_by) {
        const fieldIDs = new Set(tgt.outputs.map(o => o.target_field_id));
        tgt.order_by = tgt.order_by.filter(k => fieldIDs.has(k.target_field_id));
      }
      // V4：匹配键只有 outputs[].fill_strategy==='row_match' 一条通道（抽键在取数配置面收口时
      // 直接产出 row_match 输出行），下面 3.4 的两段——自动模式把 row_match 归一化回 overwrite、手动模式
      // 从 row_match 反推 match_keys——都不适用：前者会把抽出来的匹配列当场抹回覆盖，后者写出的
      // match_keys 在 V4 文档里没有落点。
      if (isV4RefSyntax) continue;
      if (tgt.auto_row_match) {
        if (tgt.target_data_table_id === m.target.target_data_table_id && conditionKeys.length > 0) {
          tgt.match_keys = conditionKeys;
        }
        tgt.outputs = tgt.outputs.map(o => (o.fill_strategy === 'row_match' ? { ...o, fill_strategy: 'overwrite' as const } : o));
      } else {
        const rowMatchKeys = tgt.outputs
          .filter(o => o.fill_strategy === 'row_match' && !isEmptyExpr(o.expression))
          .map(o => ({
            source_expr: o.expression,
            form_field_id: o.target_field_id
          }));
        if (rowMatchKeys.length > 0) tgt.match_keys = rowMatchKeys;
        else delete tgt.match_keys;
      }
    }
    writeTargets(m, targets, readChartTargets(m));
  }
}

// —— 写模式「目标」相关来源——
//
// 目标先行：配置的第一步是选目标数据表（①段，见下方 onSelectWriteTarget），目标模板的表随之按
// 两档进查询：
//   - 隐含来源：承载目标记录身份的那张表，恒在 sources（不依赖是否被引用）——
//     update/delete 是目标表本身；insert→扩展表是目标模板的主表（父记录锚定改由它推导）。
//   - 引用即入源：目标模板的配对表（其余那张），只在被引用后才正式登记进 sources——
//     update/delete→扩展表目标时是主表；insert→扩展表时是目标表本身；insert→主表时是目标表本身。
// 两档都是普通 kind=catalog 来源（is_context 恒 false），标 is_write_target=true 供②面板换一种
// 虚线展示、driving dock「目标」分组；与「本报表」机制的关键差异是：catalog 引用没有 本报表./
// 暂存表. 保留前缀，服务端只能按"这张表已经在 query.sources 里"解析普通 `[表名].[字段]`，故「引用
// 即入源」候选表在**真正被点选引用之前**必须先能被拾取转换链路（valueRefToBracketText 等）当作
// "已在来源里"处理——这靠 sourceTablesForInput 的影子候选追加解决（见该 computed 注释），本函数
// 只负责"真正登记进 model.source.tables"这一步（按文本扫描判定是否已被引用）。

/** 目标模板的主表 data_table_id：按 ctx.tablesCache 已加载的该模板表目录找 role==='main' 的那张；
 *  目录未加载/无主表时返回 null（该档留空，不强行拼错误数据）——正常路径下选中扩展表目标前
 *  SourceTreePicker 已展开过该模板的表列表，onSelectWriteTarget/onMounted 迁移都会先
 *  ctx.tablesOf(该模板) 落定，tablesCache 早已就位。 */
function mainTableIdOf(templateId: string): string | null {
  const tables = ctx.tablesCache.value[templateId] ?? [];
  const main = tables.find(x => tableRoleOf(x, tables) === 'main');
  return main?.data_table_id ?? null;
}

// targetSourceAlias（`tgt-<data_table_id>` 确定性派生）已收编到 v4/expressionModelAdapter.ts 作
// 单一权威定义（见上方 import），本文件不再自持一份私有实现。

/** 写模式「目标」相关来源的判据：`is_write_target` 是纯前端字段、不落 V4
 *  文档，V4WriteNodeDocument ⇄ ExpressionModel 往返一圈会把它冲掉（v4/writeModelAdapter.ts
 *  v4WriteDocToExpressionModel 读入时已按确定性别名重新打上，见该函数注释）——本文件所有"是否是
 *  目标相关来源"的判据统一改走本函数（`is_write_target` 为真 **或** 别名匹配 isWriteTargetSourceAlias
 *  双保险），不再各处直接读 `t.is_write_target` 单一字段，防止任何遗漏的往返/构造路径继续绕开
 *  这条单一权威判据。 */
function isWriteTargetTable(t: Pick<SourceTable, 'alias' | 'is_write_target'>): boolean {
  return !!t.is_write_target || isWriteTargetSourceAlias(t.alias);
}

/** 当前写目标（operation + target_template_id/target_data_table_id/target_table_role）推导出的
 *  隐含来源 / 引用即入源候选 data_table_id（见上方大注释两档定义）；目标未选定时两者皆 null。
 *  role 优先取模型已固化的 target_table_role，取不到时回落 tableMeta（同 writeTargetIsDetail 既有
 *  兜底口径）。**纯函数**——不读取 model.value（供 reconcile 在草稿 m 上调用），亦供其余
 *  computed/setter 传入 model.value 复用同一权威口径。 */
function writeTargetSourcePlanFor(m: ExpressionModel): { implicitDataTableId: string | null; poolDataTableId: string | null } {
  const tgt = m.target;
  if (!tgt.target_data_table_id) return { implicitDataTableId: null, poolDataTableId: null };
  const role = tgt.target_table_role ?? tableMeta(tgt.target_template_id, tgt.target_data_table_id).role;
  if (writeOp.value === 'insert') {
    return role === 'detail'
      ? { implicitDataTableId: mainTableIdOf(tgt.target_template_id), poolDataTableId: tgt.target_data_table_id }
      : { implicitDataTableId: null, poolDataTableId: tgt.target_data_table_id };
  }
  // update/delete：目标表本身恒隐含（承载记录身份）；目标是扩展表时其主表进候选池。
  return role === 'detail'
    ? { implicitDataTableId: tgt.target_data_table_id, poolDataTableId: mainTableIdOf(tgt.target_template_id) }
    : { implicitDataTableId: tgt.target_data_table_id, poolDataTableId: null };
}

/** 引用即入源候选是否已被引用：扫写模式全部赋值表达式原文 + 定位条件原文里的普通方括号引用
 *  （plainTableNameReferencedInText，V4/brackets 语法），或 collectUsedAliases 已收集的结构化引用
 *  别名（braces 语法，`used` 由 reconcile 调用处就地算好传入，两种语法各自的拾取入口产出的形态
 *  不同，见 pickedRefForSyntax 头注释，本函数两条判据取或、互不干扰）。 */
function writeTargetPoolReferenced(m: ExpressionModel, poolDataTableId: string, used: Set<string>): boolean {
  const alias = targetSourceAlias(poolDataTableId);
  if (used.has(alias)) return true;
  const poolName = tableName(poolDataTableId);
  if (!poolName) return false;
  const inOutputs = m.target.outputs.some(
    o => o.expression.kind === 'raw' && plainTableNameReferencedInText(o.expression.text ?? '', poolName)
  );
  if (inOutputs) return true;
  return !!m.where_text_source?.text && plainTableNameReferencedInText(m.where_text_source.text, poolName);
}

/** 登记（或补打标）一张写模式「目标」相关来源（is_write_target=true），dataTableId 为隐含来源或
 *  候选池表的 data_table_id——从 reconcileWriteTargetSources 的登记步骤抽出（供 touch 回调复用同一
 *  口径，见下方 provideWriteTargetPoolTouch 注释），角色判据不变：dataTableId 恰是目标表本身时用
 *  target_table_role（取不到回落 tableMeta），否则恒 'main'（候选池表≠目标本身时只会是目标模板主表，
 *  见 writeTargetSourcePlanFor 四组合）。 */
function upsertWriteTargetSource(m: ExpressionModel, dataTableId: string): void {
  const tgt = m.target;
  // 角色恒按当前目标口径现算（同下方新建分支）：dataTableId 恰是目标表本身时取 target_table_role
  // （取不到回落 tableMeta），否则恒 'main'——见 writeTargetSourcePlanFor 四组合。
  const role: TableRole =
    dataTableId === tgt.target_data_table_id
      ? (tgt.target_table_role ?? tableMeta(tgt.target_template_id, dataTableId).role)
      : 'main';
  const existing = m.source.tables.find(t => t.template_id === tgt.target_template_id && t.data_table_id === dataTableId);
  if (existing) {
    existing.is_write_target = true;
    existing.role = role;
    return;
  }
  m.source.tables.push({
    alias: targetSourceAlias(dataTableId),
    source_type: 'template',
    template_id: tgt.target_template_id,
    data_table_id: dataTableId,
    is_context: false,
    is_write_target: true,
    role
  });
}

/** 写模式目标相关来源的调和（reconcile 收口点，见本节大注释）：按 writeTargetSourcePlanFor 算出
 *  的隐含/候选池 data_table_id 集合——
 *  ① 剔除失效的目标相关来源（目标变更、或候选不再被引用）：与①段"本报表未引用即剔除"同一手法，
 *    判据换成"是否仍属当前目标需求"；
 *  ② 补齐仍缺的目标相关来源：已有同 template_id+data_table_id 的来源（用户手动加过 / 上一轮已
 *    打标，甚至是往返 V4 一圈后丢了 is_write_target 标记的存量条目——该标记是纯前端字段，不落
 *    V4 文档，见 types.ts 同名字段注释）直接复用并补打标，不重复插入。 */
const provisionalPoolTouchIds = new Set<string>();

function reconcileWriteTargetSources(m: ExpressionModel): void {
  const plan = writeTargetSourcePlanFor(m);
  const used = collectUsedAliases(m);
  const requiredIds = new Set<string>();
  if (plan.implicitDataTableId) requiredIds.add(plan.implicitDataTableId);
  if (plan.poolDataTableId) {
    const officiallyReferenced = writeTargetPoolReferenced(m, plan.poolDataTableId, used);
    const provisional = provisionalPoolTouchIds.has(plan.poolDataTableId);
    if (officiallyReferenced || provisional) requiredIds.add(plan.poolDataTableId);
    // 一次性标记：不论本轮是否真用上了它（哪怕官方判据本身已经为真），touch 那一轮种下的标记
    // 到这里就该清空——避免它跨轮残留误判后续与本次 touch 无关的 reconcile 调用。
    if (provisional) provisionalPoolTouchIds.delete(plan.poolDataTableId);
  }

  const stale = m.source.tables.filter(t => isWriteTargetTable(t) && !requiredIds.has(t.data_table_id));
  if (stale.length > 0) {
    const staleAliases = new Set(stale.map(t => t.alias));
    m.source.tables = m.source.tables.filter(t => !staleAliases.has(t.alias));
    m.source.joins = m.source.joins.filter(j => !staleAliases.has(j.left_alias) && !staleAliases.has(j.right_alias));
  }
  for (const dataTableId of requiredIds) upsertWriteTargetSource(m, dataTableId);

  const writeTargetAliases = new Set(m.source.tables.filter(t => isWriteTargetTable(t)).map(t => t.alias));
  if (writeTargetAliases.size > 0) {
    m.source.joins = m.source.joins.filter(j => {
      if (j.auto_record_id) return true;
      const touchesWriteTarget = writeTargetAliases.has(j.left_alias) || writeTargetAliases.has(j.right_alias);
      const hasRealOn = !!j.on && j.on.length > 0;
      return !touchesWriteTarget || hasRealOn;
    });
  }
}

provideWriteTargetPoolTouch((text: string): boolean => {
  if (!isWriteMode.value) return false;
  const plan = writeTargetSourcePlanFor(model.value);
  if (!plan.poolDataTableId) return false;
  const poolName = tableName(plan.poolDataTableId);
  if (!poolName || !plainTableNameReferencedInText(text, poolName)) return false;
  const already = model.value.source.tables.some(
    t => t.template_id === model.value.target.target_template_id && t.data_table_id === plan.poolDataTableId && isWriteTargetTable(t)
  );
  if (already) return false;
  provisionalPoolTouchIds.add(plan.poolDataTableId);
  update(m => upsertWriteTargetSource(m, plan.poolDataTableId as string));
  return true;
});

// isEmptyExpr / isUnconfiguredOutputExpr（「不填充」占位与「未配置」判据）已抽到 ./outputExprState.ts，
// 与暂存区列行（StagingTargetSection）共用同一份，见该模块注释。

/**
 *   ① 剔除「不填充」占位行（isEmptyExpr 为 true 的输出行）——取数模式逐 readTargets 目标过滤，
 *      写模式过滤 m.target.outputs（写模式 parent 映射字段不属于本步骤，原样不动）；
 *   ② 多余显式来源表剪枝：原先长年挂在 reconcile 里、每次 update() 都跑一遍的同一段逻辑（规则
 *      不变：显式来源表 ≥2 张且其中确有至少一张已被引用时，只留被引用的；一张都没被引用则整批
 *      保留），本轮迁到这里；
 *   ③ 重新 reconcile(m)：清掉①②两步可能产生的悬空自动 join，并按当前 where/outputs 回写行列
 *      匹配键。
 *
 * 为什么挪到确认时而不是沿用"每次 update() 都跑"（此前 reconcile 的做法）：填充行除了表达式本身，
 * 还挂着「填充策略」「排序」两个 NSelect（:2129/:2138 一带）——改它们会先经 upsertOutputIn 建一条
 * {kind:'const'} 占位行，此时表达式尚未配置、isEmptyExpr 恒真；若每次 update 都当场剔除该行，
 * "先选好填充策略/排序、再回头配表达式"这一操作顺序会把刚选的策略/排序连带丢掉——必须留到用户
 * 明确离开（点「确定」）这一刻才收口，编辑过程中不剔不剪。
 */
function finalize(): ExpressionModel {
  const m = buildFinalizedModel();
  emit('update:modelValue', m);
  return m;
}

/** finalize() 的纯函数部分：在深拷贝副本上做①②③收口，**不 emit、不回写**
 *  当前编辑态模型。除 finalize()（确认时收口 + 回写 v-model）外，runPreview（防抖语法检查）也用
 *  它——预览必须问「点确定后会被保存的那份模型」而不是编辑中的原始模型，否则编辑期为承载填充
 *  策略/排序下拉而保留的「不填充」占位输出行（{kind:'const'} 且 value 缺省，见 isEmptyExpr 注释）
 *  会被后端聚合闸（validateExtractNoAggregateFillOutput → 形状编译器）当成空常量输出具名拒绝，
 *  把一份确认后本会通过的合法配置误报成 invalid、锁死「确定」按钮。 */
function buildFinalizedModel(): ExpressionModel {
  const m: ExpressionModel = JSON.parse(JSON.stringify(model.value));

  // ① 剔除「不填充」占位行。暂存目标（2026-09-07 列控件对齐普通字段行）连 V4 往返回来的空文本形态一并
  //    剔除：暂存列没有「不填充即忽略」的落盘语义，空列送到服务端会被拒（columns[].expression.source_text
  //    不能为空）；用户新增后没配表达式的列在确认时静默丢弃，与普通字段行「没配就不输出」同一口径。
  if (!props.hideTargetSection && !isWriteMode.value) {
    const targets = readTargets(m);
    for (const tgt of targets) {
      tgt.outputs =
        tgt.target_kind === 'staging'
          ? tgt.outputs.filter(o => !isUnconfiguredOutputExpr(o.expression))
          : tgt.outputs.filter(o => !isEmptyExpr(o.expression));
    }
    writeTargets(m, targets, readChartTargets(m));
  } else if (isWriteMode.value) {
    m.target.outputs = m.target.outputs.filter(o => !isUnconfiguredOutputExpr(o.expression));
    // 同批：dedupe_field_ids 须 ⊆ 收口后的 outputs（TargetSpec.dedupe_field_ids 注释的约束）。
    // 旧「取消」按钮点击当下立即从 dedupe 里摘除该字段；现按①步
    // 同一「留到确定才收口」口径挪到这里统一处理——✕ 清空只落回未配置占位、行仍保留（与③目标行
    // 同语义，见 setWriteOutputExpr 注释），不该在编辑过程中就把用户的 dedupe 勾选中途撅掉。
    if (m.target.dedupe_field_ids) {
      const keptFieldIds = new Set(m.target.outputs.map(o => o.target_field_id));
      m.target.dedupe_field_ids = m.target.dedupe_field_ids.filter(id => keptFieldIds.has(id));
      if (m.target.dedupe_field_ids.length === 0) {
        delete m.target.dedupe_field_ids;
        delete m.target.dedupe_scope;
      }
    }
  }

  // ② 多余显式来源表剪枝（原 reconcile 同名逻辑搬迁，规则见上方函数注释）。此刻 match_keys 已由
  //    上一轮 reconcile（每次 update() 都会跑）写回模型，collectUsedAliases 不需要额外喂 extra。
  const used = collectUsedAliases(m, []);
  const explicitTables = m.source.tables.filter(t => !isReportContext(t));
  const usedExplicitTables = explicitTables.filter(t => used.has(t.alias));
  if (explicitTables.length >= 2 && usedExplicitTables.length > 0) {
    const keepAliases = new Set(usedExplicitTables.map(t => t.alias));
    m.source.tables = m.source.tables.filter(t => isReportContext(t) || keepAliases.has(t.alias));
  }

  // ③ 重新调和：清掉①②可能留下的悬空自动关联，回写行列匹配键（只作用于副本 m，不触碰
  //    model.value——deep watch 因此不会被本函数触发，防抖检查不会自激）。
  reconcile(m);

  return m;
}

// —— 公共：表名/字段/角色 ——
function tableName(dataTableId: string): string {
  for (const tid of Object.keys(ctx.tablesCache.value)) {
    const t = ctx.tablesCache.value[tid].find(x => x.data_table_id === dataTableId);
    if (t) return t.table_name;
  }
  return dataTableId;
}
/** 当前模板标记：筛选条件/表达式设计界面里凡显示模板名之处，若该模板就是
 *  当前正在设计的模板，一律追加后缀——「销售订单（本模板）」/ en「Sales Order(current)」。文案与
 *  「添加来源」树（SourceTreePicker）的同名标记共用同一份 picker.currentTemplate，不另造措辞。
 *  templateId 为空（视图/暂存区来源无模板归属）不标。 */
function withCurrentTemplateMark(templateId: string, label: string): string {
  return templateId && templateId === props.templateId ? `${label}${t('picker.currentTemplate')}` : label;
}
/** 来源 tag 的模板归属标签：显示真实模板名称（含本报表对应模板）；未加载到名称时回落模板 ID。
 *  供树坞列头等"总要有个文案"的场景使用；①来源行副文案（F1③"兜底不显裸 ID"）改用下方
 *  templateNameOnly，未加载到时该段直接省略，不会显出 tpl_xxx。 */
function templateLabel(templateId: string): string {
  return withCurrentTemplateMark(templateId, templateNames.value[templateId] ?? templateId);
}
/** F1③：仅返回已加载到的真实模板名，未加载到时返回空串（不兜底裸模板 ID）。 */
function templateNameOnly(templateId: string): string {
  const name = templateNames.value[templateId];
  return name ? withCurrentTemplateMark(templateId, name) : '';
}
/** F1②：来源所属应用名——跨应用来源按 app_id 查缓存，本应用来源取 currentAppName（统一口径，
 *  两者未加载到时均返回空串，由调用方按"未加载不显示"处理，不兜底裸 app_id）。 */
function srcAppName(src: SourceTable): string {
  return src.app_id ? (appNames.value[src.app_id] ?? '') : currentAppName.value;
}
function tableMeta(templateId: string, dataTableId: string): { role: TableRole; fieldCount: number } {
  const tables = ctx.tablesCache.value[templateId] ?? [];
  const t = tables.find(x => x.data_table_id === dataTableId);
  // 角色以后端权威 table_role 为准（撞号的 sort_no 会把明细误判成主表）；表未加载时回落 detail。
  return {
    role: t ? tableRoleOf(t, tables) : 'detail',
    fieldCount: t?.field_count ?? 0
  };
}
function fieldsOf(dataTableId: string): TemplateField[] {
  return ctx.fieldsByTableId.value[dataTableId] ?? [];
}
/** 按显式 SourceTable 解析字段，供 reconcile 使用时不回读旧 props.modelValue。 */
function fieldsForSource(st: SourceTable): TemplateField[] {
  // 缓存键带 app 维度。
  if (st.source_type === 'view') return ctx.viewFieldsCache.value[viewCacheKey(st.view_id ?? '', st.app_id || undefined)] ?? [];
  if (st.source_type === 'staging') return (props.stagingSource?.columns ?? []).map(stagingColumnToTemplateField);
  if (st.source_type === 'external') return ctx.externalFieldsCache.value[st.external_object_id ?? ''] ?? [];
  return fieldsOf(st.data_table_id);
}
function fieldsForAlias(alias: string): TemplateField[] {
  const st = model.value.source.tables.find(t => t.alias === alias);
  if (!st) return [];
  return fieldsForSource(st);
}

/** sourceTablesForInput 单条元素的形状（🔴 显式命名——`.map()` 回调四个分支各产出不同的可选降级
 *  标记字段，若不给整个 computed 一个显式的公共元素类型，TS 会按"多条 return 语句各自的窄形状"
 *  推导，写模式追加的影子候选（writeTargetPoolShadowSource，形状是本类型的子集）一旦并入数组，
 *  推断可能整体塌缩成影子候选那个最简形状，导致其余分支访问 viewFieldsUnsupported 等字段报错）。 */
interface SourceLiteForInput {
  alias: string;
  dataTableId: string;
  name: string;
  fields: TemplateField[];
  viewFieldsUnsupported?: boolean;
  stagingUnsupported?: boolean;
  externalFieldsUnsupported?: boolean;
}
/** 已选来源表（带别名 + 字段），供统一输入/抽屉。
 *  view 来源（views-extraction-b3 R3）：name/fields 按 view_id 取视图缓存；dataTableId 槽位填 view_id
 *  （该字段在消费方只用于同表多实例的序号区分 instanceSuffix，view_id 同样唯一，语义等价）。
 *  写模式追加「引用即入源」候选的影子条目（见下方 writeTargetPoolShadowSource 注释）——候选表在
 *  真正被引用登记进 model.source.tables 之前，拾取转换链路必须已经能在这份数组里查到它。 */
const sourceTablesForInput = computed<SourceLiteForInput[]>(() => {
  const real: SourceLiteForInput[] = model.value.source.tables.map(st => {
    if (st.source_type === 'view') {
      const vid = st.view_id ?? '';
      return {
        alias: st.alias,
        dataTableId: vid,
        // 不再拼「（视图）」后缀：这个 name 是快捷选字段插入 `[来源].[列]` 文本时的来源段，
        // 服务端按 V4 来源 alias（= 视图名，经 viewLabelOf）逐字匹配，带后缀就解析不出；视图身份由来源行图标/标签表达。
        name: ctx.viewName(vid) ?? vid,
        fields: ctx.viewFieldsCache.value[viewCacheKey(vid, st.app_id || undefined)] ?? [],
        // 旧宿主桥无 getViewSchema：字段面板据此显示「当前宿主不支持视图字段目录」而非静默消失（R3 边界）。
        viewFieldsUnsupported: !host.getViewSchema
      };
    }
    // Phase B（动作暂存区）：staging 来源。dataTableId 槽位填合成键 '__staging__'（一模型至多一张，
    // 无需按真实 ID 区分同表多实例，语义等价 view 分支借用 view_id 的做法）；name=producerLabel
    // （stagingSource 为空=拓扑丢失，回落降级提示文案）；fields 直接由 stagingSource.columns 转换
    //（无需异步拉取），stagingSource 为空时 fields 为空数组，靠下方 stagingUnsupported 标记防止字段面板
    // 把该分组静默过滤掉（复用 viewFieldsUnsupported 同一范式，见 FieldTreePanel.vue）。
    if (st.source_type === 'staging') {
      return {
        alias: st.alias,
        dataTableId: '__staging__',
        name: props.stagingSource?.producerLabel ?? t('picker.stagingNoProducer'),
        fields: (props.stagingSource?.columns ?? []).map(stagingColumnToTemplateField),
        stagingUnsupported: !props.stagingSource
      };
    }
    // S2b（外部数据表来源）：dataTableId 槽位填 external_object_id（同 view 分支借用 view_id 的做法，
    // 消费方只用它做同表多实例序号区分 instanceSuffix，external_object_id 同样唯一，语义等价）；
    // name 拼「（外部表）」后缀。
    if (st.source_type === 'external') {
      const oid = st.external_object_id ?? '';
      return {
        alias: st.alias,
        dataTableId: oid,
        name: `${ctx.externalName(oid) ?? oid}${t('editor.sourceExternalSuffix')}`,
        fields: ctx.externalFieldsCache.value[oid] ?? [],
        // 旧宿主桥无 getExternalSchema：字段面板据此显示「当前宿主不支持读取外部表字段」而非静默消失。
        externalFieldsUnsupported: !host.getExternalSchema
      };
    }
    return {
      alias: st.alias,
      dataTableId: st.data_table_id,
      name: tableName(st.data_table_id),
      fields: fieldsOf(st.data_table_id)
    };
  });
  return writeTargetPoolShadowSource.value ? [...real, writeTargetPoolShadowSource.value] : real;
});
/** 写模式「引用即入源」候选的影子条目：候选表在**真正被引用登记进
 *  model.source.tables 之前**，拾取转换链路（bracketText.ts valueRefToBracketText 等）必须已经能
 *  在 sources 参数里查到它，才能产出合法的 `[表名].[字段]` 文本引用——kind=catalog 引用没有
 *  本报表./暂存表. 那样的保留前缀可以绕开"先在场"这个前提。真正把它写进 model.source.tables 仍由
 *  reconcile 的 reconcileWriteTargetSources 收口（按文本扫描判定是否已被引用），本影子条目只解决
 *  "点选那一刻表还不在 sources 里、转换链路查不到"的先有鸡还是先有蛋问题，不改变模型持久化状态——
 *  一旦候选被正式登记为真实来源，下面 alreadyReal 判断为真，不再追加（避免重复）。
 *  声明位置在 sourceTablesForInput 之后：computed getter 惰性求值，两者互相按需读取 `.value`
 *  不受声明先后顺序影响（与本文件其余大量"后声明的 computed 被先声明的 computed 引用"同一惯例）。 */
const writeTargetPoolShadowSource = computed<SourceLiteForInput | null>(() => {
  if (!isWriteMode.value) return null;
  const plan = writeTargetSourcePlanFor(model.value);
  if (!plan.poolDataTableId) return null;
  const alreadyReal = model.value.source.tables.some(
    t => t.template_id === model.value.target.target_template_id && t.data_table_id === plan.poolDataTableId
  );
  if (alreadyReal) return null;
  return {
    alias: targetSourceAlias(plan.poolDataTableId),
    dataTableId: plan.poolDataTableId,
    name: tableName(plan.poolDataTableId),
    fields: fieldsOf(plan.poolDataTableId)
  };
});
// 本报表各表（带隐式 context 别名 bt*）：抽屉「本报表」tab 据此产 source_field（用到才物化为临时表）。
const formTablesForInput = computed(() => ctx.tableFields.value.map((tf, i) => ({ ...tf, alias: reportAlias(i) })));
// ① 来源卡片只展示**显式来源**（本报表 context 表隐式、不在此显示，也不可删）。
const explicitSources = computed(() => model.value.source.tables.filter(t => !isReportContext(t)));
// ② 关联按钮计数：仅统计**手动**关联（自动 record_id 关联在选源后隐式生成，不计入按钮角标）。
// 具体的手动关联增删改 UI 已抽为通用组件 JoinSettingsPanel（346:10750），本文件只喂数据+接收整体回写。
const manualJoinCount = computed(() => model.value.source.joins.filter(j => !j.auto_record_id).length);
// Phase B（动作暂存区）：模型是否已含暂存来源表（一模型至多一张），供 SourceTreePicker 禁选重复添加。
const modelHasStagingSource = computed(() => hasStagingSource(model.value));
const writeTargetDisabledTableIds = computed<string[]>(() => {
  if (!isWriteMode.value) return [];
  const plan = writeTargetSourcePlanFor(model.value);
  return [plan.implicitDataTableId, plan.poolDataTableId].filter((id): id is string => !!id);
});

function sourceTreeFieldsFor(fields: TemplateField[]): TemplateField[] {
  return fields;
}

// 列①：当前模板列。header=当前模板真实名称（与来源 tag tooltip 同一份 templateNames 缓存，未加载到时
// 回落 templateId，同 templateLabel 既有兜底口径）；tables=本报表各表（formTablesForInput，alias=bt* 隐式
// 别名——与来源列共用同一套 source_field(alias, field_id) 插入语义，FieldTreeDock 不需要区分"本报表"/"来源"）。
// 列头后缀用「（本报表）」而非 templateLabel 的「（本模板）」：本列是当前单据自身的取值（引用前缀 本报表.），
// 而来源恰为本模板时列②也会挂「（本模板）」，两列同名会让用户分不清（2026-10-19 用户反馈）。
const currentColumnForDock = computed<DockColumn>(() => ({
  // 无模板归属（视图设计器等调用域）时直接叫「本报表」，同 dockColumns.ts 降级口径。
  header: props.templateId
    ? `${templateNames.value[props.templateId] ?? props.templateId}${t('editor.dockReportColumnSuffix')}`
    : t('drawer.tabForm'),
  tables: formTablesForInput.value.map(tf => ({
    alias: tf.alias,
    label: tf.table.table_name,
    fields: sourceTreeFieldsFor(tf.fields)
  }))
}));

/** 列②…N：各数据源列，按**所属模板**分组（同模板的多张显式来源表共享一列，列头=模板名，与①来源段
 *  tooltip「模板：」同一份 templateLabel）；本报表隐式 context 表（bt*）已在列①单独呈现，这里只取
 *  **显式来源**（explicitSources），避免与列①重复。
 *
 *  模板归属取自 SourceTable.template_id（模型里显式来源表自带的字段，非派生数据）。view/staging 来源
 *  该字段恒空串（types.ts SourceTable 注释固化的约定：视图/暂存区没有模板归属语义）——**不能**把这些
 *  空 template_id 的来源并成一组（组内表彼此毫无关联，误并会让用户误以为它们同属"空模板"），故按
 *  「拿不到模板归属就一个来源表单独成一列」降级：列头直接复用 sourceDisplayName（与①来源段 chip
 *  同一份展示名，含视图/暂存区后缀 + 跨应用前缀），列内唯一一张表复用同一文案，不重复计算。
 *  同模板分组内的表标签沿用 FieldTreePanel 的既有惯例——`${表名}${instanceSuffix(...)}`（同表多实例
 *  加 (N) 序号，不含跨应用前缀，与右侧原字段树的呈现口径保持一致）。 */
const sourceColumnsForDock = computed<DockColumn[]>(() => {
  const byAlias = new Map(sourceTablesForInput.value.map(s => [s.alias, s]));
  const columns: DockColumn[] = [];
  const byTemplate = new Map<string, DockColumn>();
  for (const st of explicitSources.value) {
    // 已在下方「目标」分组呈现（is_write_target 打标的真实来源），不重复出现在按模板分组的列里。
    if (isWriteTargetTable(st)) continue;
    const src = byAlias.get(st.alias);
    if (!src) continue;
    if (st.template_id) {
      const label = `${src.name}${instanceSuffix(st.alias, src.dataTableId, sourceTablesForInput.value)}`;
      let col = byTemplate.get(st.template_id);
      if (!col) {
        // 来源恰为本模板时列头挂「（来源模板）」而非 templateLabel 的「（本模板）」：本列是按来源表去库里查的
        // 已存单据，与列①「（本报表）」当前单据取值区分（2026-10-20 用户要求）；其余模板仍显示真实模板名。
        const tplName = templateNames.value[st.template_id] ?? st.template_id;
        const header = st.template_id === props.templateId ? `${tplName}${t('editor.dockSourceTemplateColumnSuffix')}` : tplName;
        col = { header, tables: [] };
        byTemplate.set(st.template_id, col);
        columns.push(col);
      }
      col.tables.push({
        alias: st.alias,
        label,
        fields: sourceTreeFieldsFor(src.fields),
        viewFieldsUnsupported: src.viewFieldsUnsupported,
        stagingUnsupported: src.stagingUnsupported,
        // S2b 收尾：外部数据表来源也要把「宿主不支持外部 schema」的降级标记透传给坞（此前漏传，
        // 外部来源在坞里退化成普通「无字段」，用户看不到应有提示）。
        externalFieldsUnsupported: src.externalFieldsUnsupported
      });
    } else {
      // 拿不到模板归属（视图/暂存区来源）：单独成列，列头与列内唯一表同一份展示名。
      const label = sourceDisplayName(st);
      columns.push({
        header: label,
        tables: [
          {
            alias: st.alias,
            label,
            fields: sourceTreeFieldsFor(src.fields),
            viewFieldsUnsupported: src.viewFieldsUnsupported,
            stagingUnsupported: src.stagingUnsupported,
            externalFieldsUnsupported: src.externalFieldsUnsupported
          }
        ]
      });
    }
  }
  if (isWriteMode.value) {
    const plan = writeTargetSourcePlanFor(model.value);
    const targetIds = [plan.implicitDataTableId, plan.poolDataTableId].filter((id): id is string => !!id);
    const targetTables = targetIds
      .map(id => {
        const existing = model.value.source.tables.find(
          t => t.template_id === model.value.target.target_template_id && t.data_table_id === id
        );
        const alias = existing?.alias ?? targetSourceAlias(id);
        const src = byAlias.get(alias);
        if (!src) return null;
        return {
          alias,
          label: `${src.name}${instanceSuffix(alias, src.dataTableId, sourceTablesForInput.value)}`,
          fields: sourceTreeFieldsFor(src.fields)
        };
      })
      .filter((x): x is { alias: string; label: string; fields: TemplateField[] } => !!x);
    if (targetTables.length > 0) columns.push({ header: t('editor.writeTargetGroupLabel'), tables: targetTables });
  }
  return columns;
});

/** 打包成 DockColumnsBundle，经各处 <ExpressionInput> 透传给其内部挂载的 AdvancedExpressionDialog——
 *  本文件手上是完整模型（含 template_id），分组精度高于 AdvancedExpressionDialog 自身兜底的降级构造器
 *  （dockColumns.ts buildDockColumnsFromLite，只能按「一张显式来源表单独成一列」的粗粒度降级），
 *  传了就不必再降级重算。 */
const dockColumnsForInput = computed<DockColumnsBundle>(() => ({
  current: currentColumnForDock.value,
  sources: sourceColumnsForDock.value
}));

// —— ① 来源 ——
function nextAlias(m: ExpressionModel): string {
  let i = 1;
  while (m.source.tables.some(t => t.alias === `t${i}`)) i += 1;
  return `t${i}`;
}
async function onSelectSources(
  items: {
    templateId: string;
    dataTableId: string;
    role: TableRole;
    name?: string;
    kind?: 'table' | 'view' | 'staging' | 'external';
    view_id?: string;
    external_object_id?: string;
    appId?: string;
  }[]
) {
  // 预取字段目录：table 走模板字段端点（跨应用表带 appId 向目标应用拉取），view 走 host.getViewSchema
  //（views-extraction-b3 R3，失败静默降级）；external（S2b）走 host.getExternalSchema（同一降级范式）；
  // staging（Phase B）无需预取——列直接来自 props.stagingSource。
  for (const it of items) {
    if (it.kind === 'view' && it.view_id) {
      await ctx.ensureViewFields(it.view_id, it.appId);
      // 同样透传 appId：跨应用视图的类型徽标与「N 列」也要按来源应用取目录，不能落到当前应用。
      await ctx.ensureViewMeta(it.view_id, it.appId);
    }
    else if (it.kind === 'external' && it.external_object_id) await ctx.ensureExternalFields(it.external_object_id);
    else if (it.kind === 'staging') continue;
    else await ctx.ensureFields(it.templateId, it.dataTableId, it.appId);
  }
  // 数据流左右分栏改版：记下本次新增的别名（构造逻辑本身零改动，只是把原先内联的 nextAlias(m) 调用
  // 提出一个局部变量以便同时记录），供下方判定「新增来源里是否存在无法自动关联的表」以自动弹出
  // JoinDesignerDialog（见 SourceTreePicker onSelectSources 到达路径③）。
  const newAliases: string[] = [];
  update(m => {
    // 允许同一数据表/视图多次加入（每次一个独立别名）：不去重，便于对同一表多次关联/处理（同表自关联同规则）。
    for (const it of items) {
      if (it.kind === 'staging') {
        // Phase B：暂存来源。template_id/data_table_id 恒空串、不设 role（同 view 分支理由，见 reconcile
        // ② 的门控注释）。至多一张（双保险——正常 UI 路径已在 SourceTreePicker 侧按 hasStagingSource 禁选）。
        if (hasStagingSource(m)) continue;
        const alias = nextAlias(m);
        newAliases.push(alias);
        m.source.tables.push({
          alias,
          source_type: 'staging',
          template_id: '',
          data_table_id: '',
          is_context: false
        } satisfies SourceTable);
        continue;
      }
      if (it.kind === 'view' && it.view_id) {
        const alias = nextAlias(m);
        newAliases.push(alias);
        m.source.tables.push({
          alias,
          source_type: 'view',
          template_id: '',
          data_table_id: '',
          view_id: it.view_id,
          is_context: false,
          ...(it.appId ? { app_id: it.appId } : {})
        } satisfies SourceTable);
        continue;
      }
      if (it.kind === 'external' && it.external_object_id) {
        // S2b：外部数据表来源。template_id/data_table_id 恒空串；**不设置 role**——
        // 外部表没有主/明细语义（理由同 view 分支，见上方 reconcile ② 的 view/staging 门控注释）。
        // 去重：同一 external_object_id 不重复加入（外部表与 view/table 不同，一般无需对同表多次
        // 关联处理，且外部登记对象往往代表"整表快照"这一唯一实体，重复加入无意义、还会制造多余关联）。
        if (m.source.tables.some(t => t.source_type === 'external' && t.external_object_id === it.external_object_id))
          continue;
        const alias = nextAlias(m);
        newAliases.push(alias);
        m.source.tables.push({
          alias,
          source_type: 'external',
          template_id: '',
          data_table_id: '',
          external_object_id: it.external_object_id,
          is_context: false
        } satisfies SourceTable);
        continue;
      }
      const alias = nextAlias(m);
      newAliases.push(alias);
      m.source.tables.push({
        alias,
        source_type: 'template',
        template_id: it.templateId,
        data_table_id: it.dataTableId,
        is_context: false,
        role: it.role,
        // 跨应用来源（可选）：仅其他应用的表写 app_id，当前应用不写（旧模型形状不变）。
        ...(it.appId ? { app_id: it.appId } : {})
      } satisfies SourceTable);
    }
  });
  // 等 update() 的 emit('update:modelValue', next) 经父级 v-model 回流、model 计算属性观测到新值后，
  // 才能读到 reconcile 刚落定的 joins（含新生成的自动 record_id 关联），据此判定新增来源里是否仍存在
  // 无法自动关联的表；若有，自动打开关联设计器（到达路径③，见 JoinDesignerDialog.vue 头注释）。
  await nextTick();
  if (newAliases.some(alias => unlinkedAliases.value.some(u => u.alias === alias))) {
    showJoinDesigner.value = true;
  }
}
/** 来源 tag 显示名：同一数据表/视图被多次加入时追加序号 数据表(1)/(2)，便于区分。
 *  view 来源（views-extraction-b3 R2/R3）：按 view_id 取视图名缓存 + 文案后缀「（视图）」作视觉区分
 *  （复用现有 tag 结构，不引入新图标体系）；名称未加载（旧宿主桥无 getViewSchema）时裸 view_id 回落。 */
function sourceDisplayName(src: SourceTable): string {
  if (src.source_type === 'view') {
    const vid = src.view_id ?? '';
    const vname = ctx.viewName(vid) ?? vid;
    const sameViews = explicitSources.value.filter(x => x.source_type === 'view' && x.view_id === vid);
    const seq = sameViews.length <= 1 ? '' : `(${sameViews.findIndex(x => x.alias === src.alias) + 1})`;
    return `${crossAppPrefix(src)}${vname}${seq}`;
  }
  // Phase B（动作暂存区）：staging 来源无独立 ID，一模型至多一张（无需同表多实例序号）；
  // name=producerLabel，stagingSource 为空（拓扑丢失）时回落降级提示文案，与 fieldsForAlias 同一判据。
  if (src.source_type === 'staging') {
    return `${props.stagingSource?.producerLabel ?? t('picker.stagingNoProducer')}${t('editor.sourceStagingSuffix')}`;
  }
  // S2b（外部数据表来源）：按 object_id 取展示名缓存 + 文案后缀「（外部表）」，与 view 分支同一惯例；
  // 名称未加载（旧宿主桥无 getExternalSchema）时裸 object_id 回落。
  if (src.source_type === 'external') {
    const oid = src.external_object_id ?? '';
    const oname = ctx.externalName(oid) ?? oid;
    const sameExternals = explicitSources.value.filter(x => x.source_type === 'external' && x.external_object_id === oid);
    const seq = sameExternals.length <= 1 ? '' : `(${sameExternals.findIndex(x => x.alias === src.alias) + 1})`;
    return `${oname}${seq}${t('editor.sourceExternalSuffix')}`;
  }
  const name = tableName(src.data_table_id);
  const same = explicitSources.value.filter(x => x.source_type !== 'view' && x.data_table_id === src.data_table_id);
  const seq = same.length <= 1 ? '' : `(${same.findIndex(x => x.alias === src.alias) + 1})`;
  return `${crossAppPrefix(src)}${name}${seq}`;
}
/**
 * 跨应用来源的「应用名 › 」前缀，一眼区分本应用 / 其他应用的表。三种情况不加前缀：
 * - 本应用来源：V4 目录来源恒带 app_id（本应用也带），按 currentAppId 排除——否则每张表都顶着
 *   「当前应用名 ›」，失去区分意义；
 * - 来源选择器关闭了跨应用（sourcePickerOptions.allowCrossApp=false，如表格编辑器控件查询）：不可能存在
 *   跨应用来源，宿主也未必实现 listApps（拿不到 currentAppId）；
 * - 应用名未加载到：不回落裸 app_id（此前会显示整串 UUID 并把来源行撑出横向滚动条，口径同
 *   srcMetaText「兜底不显裸 ID」）。
 */
function crossAppPrefix(src: SourceTable): string {
  if (!src.app_id || src.app_id === currentAppId.value) return '';
  if (props.sourcePickerOptions?.allowCrossApp === false) return '';
  const appName = appNames.value[src.app_id];
  return appName ? `${appName} › ` : '';
}
/** ①来源行内联灰字元信息（数据流左右分栏改版：原 hover tooltip 内容改常显）：
 *  view=「视图」+ view_id；staging=拓扑 producerLabel（或降级提示）；普通模板表（F1②改版）＝
 *  「模板名 - 应用名」，字段数不再显示。任一段（模板名/应用名）未加载到时该段连同分隔符一并
 *  省略（F1③"兜底不显裸 ID"），不显示裸 tpl_xxx/app_id。 */
function viewTypeLabel(src: SourceTable): string {
  // 2026-09-14 修复：读键此前用裸 view_id，而 ensureViewMeta 按 viewCacheKey(view_id, app_id) 写入
  // （与下方 viewColumnCountText 同一口径）——来源带 app_id 时恒查不到，类型徽标永远回落通用「视图」。
  const meta = ctx.viewMetaCache.value[viewCacheKey(src.view_id ?? '', src.app_id || undefined)];
  if (meta?.view_type === 'combined') return t('picker.viewCombined');
  if (meta?.view_type === 'regular') return t('picker.viewRegular');
  return t('picker.viewGeneric');
}
function viewColumnCountText(src: SourceTable): string {
  const viewKey = viewCacheKey(src.view_id ?? '', src.app_id || undefined);
  const meta = ctx.viewMetaCache.value[viewKey];
  const count = meta?.column_count ?? ctx.viewFieldsCache.value[viewKey]?.length;
  return typeof count === 'number' && count > 0 ? `${count}${t('picker.columnCountUnit')}` : '';
}
function srcMetaText(src: SourceTable): string {
  if (src.source_type === 'view') return viewColumnCountText(src);
  if (src.source_type === 'staging')
    return props.stagingSource ? props.stagingSource.producerLabel : t('picker.stagingNoProducer');
  // S2b：外部数据表——同 view 分支只显示「外部表」通用标签 + 登记对象 ID，不展示边界/连接信息
  //。
  if (src.source_type === 'external') return `${t('picker.externalGeneric')} · ${src.external_object_id ?? ''}`;
  return [templateNameOnly(src.template_id), srcAppName(src)].filter(Boolean).join(' - ');
}
function removeSourceTable(alias: string) {
  update(m => {
    m.source.tables = m.source.tables.filter(t => t.alias !== alias);
    m.source.joins = m.source.joins.filter(j => j.left_alias !== alias && j.right_alias !== alias);
  });
}
const joinReportTableCandidates = computed<{ alias: string; label: string }[]>(() => {
  if (!isWriteMode.value || props.hideImplicitMain) return [];
  return ctx.tableFields.value
    .map(tf => ({
      alias: reportContextAliasFor(model.value, tf.table.data_table_id),
      label: `${REPORT_PREFIX}${tf.table.table_name}`
    }))
    .filter((r): r is { alias: string; label: string } => !!r.alias);
});
const aliasOptions = computed(() => [
  ...explicitSources.value.map(t => ({
    label: sourceDisplayName(t),
    value: t.alias
  })),
  ...joinReportTableCandidates.value.map(r => ({ label: r.label, value: r.alias }))
]);
function fieldSelectOptions(alias: string) {
  const fields = fieldsForAlias(alias);
  if (fields.length > 0) return fields.map(f => ({ label: f.field_name, value: f.field_id }));
  const info = reportDataTableOf(alias);
  const tf = info ? ctx.tableFields.value.find(t => t.table.data_table_id === info.dataTableId) : undefined;
  return (tf?.fields ?? []).map(f => ({ label: f.field_name, value: f.field_id }));
}
/** JoinSettingsPanel 回写整条 joins 数组（含自动关联，面板内部按下标改写，此处整体替换）——
 *  经 update() 走既有 reconcile 流程，行为与原内联实现完全一致。 */
function onUpdateJoins(next: JoinSpec[]) {
  update(m => {
    m.source.joins = next;
  });
}

// —— 表关联设计器（数据流左右分栏改版：手动关联浮层由 NPopover 内联改走独立弹窗 JoinDesignerDialog）——
const showJoinDesigner = ref(false);
/** 某显式来源别名当前的关联覆盖态：auto=被 reconcile 自动 record_id 关联覆盖（不标）；
 *  manual=被手动关联覆盖（绿「已关联」）；unlinked=两者都没有（橙「未关联」）。
 *  判定口径复用 reconcile ②的产物（model.source.joins 已含自动+手动全部关联，不重复实现分组逻辑）：
 *  一张来源是否需要被关联，只看它当前有没有被任意一条 join 引用。 */
type SourceJoinStatus = 'auto' | 'manual' | 'unlinked';
function joinStatusOf(alias: string): SourceJoinStatus {
  const joins = model.value.source.joins;
  if (joins.some(j => j.auto_record_id && (j.left_alias === alias || j.right_alias === alias))) return 'auto';
  if (joins.some(j => !j.auto_record_id && (j.left_alias === alias || j.right_alias === alias))) return 'manual';
  if (isWriteMode.value) {
    const src = model.value.source.tables.find(t => t.alias === alias);
    if (src && isWriteTargetTable(src)) {
      const plan = writeTargetSourcePlanFor(model.value);
      if (plan.implicitDataTableId && plan.poolDataTableId) return 'auto';
    }
  }
  return 'unlinked';
}
/** 未被任何关联（自动或手动）覆盖的显式来源清单，供①头部橙色计数、行尾橙徽标、自动弹出判定、
 *  update:validity 语义扩展共用同一份口径。
 *  🔴 只有 1 张（或 0 张）显式来源时恒不判"未关联"：canAddJoin（JoinSettingsPanel）要求至少 2 张
 *  显式来源才能建立关联，若不做此豁免，最常见的"单表取数"配置会被判定为永久无法消除的"未关联"
 *  （无法新增关联去覆盖它），进而把 validity 卡死在 false——这不是本意，view/staging 恒不自动关联
 *  的规则同样只在"存在另一张可关联的来源"时才有意义。 */
const unlinkedAliases = computed<{ alias: string; label: string }[]>(() => {
  const registeredContextTables = isWriteMode.value ? model.value.source.tables.filter(isReportContext) : [];
  const pool = [...explicitSources.value, ...registeredContextTables];
  if (pool.length < 2) return [];
  return pool
    .filter(t => joinStatusOf(t.alias) === 'unlinked')
    .map(t => ({
      alias: t.alias,
      // 上下文表不在 explicitSources 里，sourceDisplayName 的同表去重计数只扫 explicitSources、
      // 不认识它，这里单独按「本报表.表名」拼标签，与①面板固定行的显示口径一致。
      label: isReportContext(t) ? `${REPORT_PREFIX}${tableName(t.data_table_id)}` : sourceDisplayName(t)
    }));
});

// —— 筛选条件编辑弹窗（数据流左右分栏改版：②面板主体改只读渲染，点击打开 ConditionEditorDialog）——
const showConditionDialog = ref(false);
/** 弹窗确定：
 *  - guided：写 where，并**清掉 where_text_source**（结构由非文本入口改动，sidecar 的 digest 已不配，
 *    服务端保存闸会拒）；
 *  - expr：写降级产物 where + where_text_source（文本清空 ⇒ 空组 + 无 sidecar，即清除条件）；
 *  - expr + unchanged：文本未改，既有一对原样保留，不重新降级。 */
function onConditionConfirm(payload: ConditionConfirmPayload): void {
  if (payload.mode === 'guided') {
    if (payload.group) setWhere(payload.group);
    return;
  }
  if (payload.unchanged) return;
  setWhereLowered(payload.group ?? { logic: 'and', items: [] }, payload.whereTextSource ?? null);
}

// —— ③ 条件 ——
const whereGroup = computed(() => model.value.where ?? { logic: 'and' as const, items: [] });
/** 引导式写回：只写 where；sidecar 随结构改动清掉（见 onConditionConfirm）。 */
function setWhere(g: { logic: 'and' | 'or'; items: unknown[] }) {
  update(m => {
    m.where = g as ExpressionModel['where'];
    delete m.where_text_source;
    delete m.where_expr;
  });
}
/** 文本模式写回：where 与 where_text_source 成对落模型；空组 ⇒ 两者皆清（无条件态）。 */
function setWhereLowered(g: ConditionGroup, source: TextSource | null) {
  update(m => {
    delete m.where_expr;
    if (g.items.length === 0 && !source) {
      m.where = undefined;
      delete m.where_text_source;
      return;
    }
    m.where = g;
    if (source) m.where_text_source = source;
    else delete m.where_text_source;
  });
}
// where 段模式：【2026-09-02 暂时收敛】「引导式 ⇄ 表达式」两档切换整体取消，恒为表达式模式——
// 与 表达式引擎 V4 首版「仅表达式输入」边界口径对齐，引导式后期单独实现时再恢复两档推导
// （原推导逻辑：lockConditionMode ⇒ 恒引导式；有 where_text_source ⇒ 表达式；有 where 无 sidecar
// ⇒ 引导式；用户点选记 whereModeChoice。ConditionTree 等引导式代码路径全部保留，仅入口封死）。
// 🔴 注意：lockConditionMode 调用方（表格编辑器 ListQuery/CascaderQuery，模型无 where_expr/文本承载面）
// 此轮**不豁免**，其条件编辑将同样打开表达式编辑器——属已知破坏面。
// 存量引导式构建的 where（无 sidecar 原文）只读区仍显示结构化视图，点开编辑为空文本、确认即覆盖
//。
const whereMode = computed<'guided' | 'expr'>(() => 'expr');
/** ②面板只读区（表达式模式）的展示片段：有 sidecar 时显示原文（按稳定 ID 重绘字段名，2026-09-02
 *  表主题色草案起按 {…} 标记切段逐 token 着色，口径同 ExpressionInput.flatten 的 text_source 分支）；
 *  无 sidecar 时由模板回落 ConditionReadonlyView。 */
function whereExprDisplaySegments(): { text: string; kind: string; tableClass: string }[] {
  const src = model.value.where_text_source;
  if (!src) return [];
  const txt = restoreTextFromSource(src, sourceTablesForInput.value, formTablesForInput.value, systemVariablesCatalog.value).trim();
  return txt ? splitLabeledTextSegments(txt, sourceTablesForInput.value, formTablesForInput.value, systemVariablesCatalog.value) : [];
}

// —— ③ 目标（404:22903 二轮：单目标 → 「表+图表」多选 tabs）——
//
// 设计：目标选择器改多选（本模板全部数据表 + 图表目录两组），选中集合渲染 tabs；
// 表 tab 内容=该 target 的绑定行（沿用原单目标 UI，函数按 tableId 参数化）；
// 图表 tab 内容=单图表映射编辑器（ChartTargetSection 改造版）。增删目标（表/图表）统一由多选控件驱动，
// 模型读写全走 readTargets/writeTargets（modelTargets.ts 唯一入口）。

/** 本模板全部数据表（目标多选「数据表」分组的选项源，原 targetTableOptions 原样保留）。 */
const targetTableOptions = computed(() =>
  ctx.tableFields.value.map(tf => ({
    label: tf.table.table_name,
    value: tf.table.data_table_id
  }))
);
/** 有效表目标：过滤占位空 target（target_data_table_id===''，即"从未配置过"的旧模型骨架，不算已选目标）
 *  与暂存目标（Phase B：target_kind==='staging'，走独立的 stagingTargetInModel/StagingTargetSection，
 *  不与表目标混在同一批 tabs 数据源里）。🔴 改用 readTableTargets（唯一入口）——否则暂存目标会被
 *  这里的裸 `!== ''` 过滤悄悄吞掉（该过滤条件对暂存目标同样成立，两者混同后续处理易生歧义）。 */
const tableTargets = computed<TargetSpec[]>(() => readTableTargets(model.value));
/** 模型里的图表目标（顶层 chart_targets，经 readChartTargets 归一化，兼容旧镜像位置）。 */
const chartTargetsInModel = computed<ChartTargetSpec[]>(() => readChartTargets(model.value));
/** Phase B（动作暂存区）：模型里的暂存目标（一模型至多一个）。 */
const stagingTargetInModel = computed<TargetSpec | undefined>(() => readStagingTarget(model.value));

// —— 图表目录（host.fetchChartCatalog 可选方法；未实现/返回空 = 目录不可用）——
// 原由 ChartTargetSection 自行拉取，改造后图表目录被顶部多选控件复用，上移到此处统一拉一次。
const chartCatalog = ref<ChartCatalogEntry[]>([]);
const chartCatalogLoading = ref(false);
const chartCatalogUnavailable = computed(() => !host.fetchChartCatalog);
/**
 * 可作「取数填充目标」的图表：只有数据来源为 pushed 的图表会消费本目标注入的数据
 * （见 ChartCatalogEntry.source 注释）。source='range'（区域引用）与 'static'（静态数据）
 * 的图表自己有数据来源，把取数结果推给它们既无处落地、也会让用户以为配置生效了——
 * 故不进候选。目录里其余图表仍原样保留，只是不出现在这个下拉里。
 */
const fillableCharts = computed(() => chartCatalog.value.filter(c => c.source === 'pushed'));
async function loadChartCatalog() {
  if (!host.fetchChartCatalog || !props.templateId) return;
  chartCatalogLoading.value = true;
  try {
    chartCatalog.value = await host.fetchChartCatalog(props.templateId);
  } catch {
    chartCatalog.value = [];
  } finally {
    chartCatalogLoading.value = false;
  }
}
onMounted(loadChartCatalog);
/** 图表 tab 标签：sheet 名 / 图表标题（未命名回退，与原 ChartTargetSection 文案一致）；目录未加载到时回落裸 chart_id。 */
function chartTabLabel(chartId: string): string {
  const entry = chartCatalog.value.find(c => c.chartId === chartId);
  if (!entry) return chartId;
  return `${entry.sheetName} / ${entry.title || t('chart_target.untitled')}`;
}

/** 目标 tab 描述符：表 tab（tableId）/ 图表 tab（chartId）/ 暂存 tab（Phase B，无 tableId/chartId，
 *  key 固定 'staging:'——一模型至多一个，不需要额外区分 ID），key 全局唯一（渲染/激活态判定用）。 */
interface TargetTab {
  key: string;
  kind: 'table' | 'chart' | 'staging';
  label: string;
  tableId?: string;
  chartId?: string;
}
const allTargetTabs = computed<TargetTab[]>(() => [
  ...tableTargets.value.map(tg => ({
    key: `table:${tg.target_data_table_id}`,
    kind: 'table' as const,
    tableId: tg.target_data_table_id,
    label: tableName(tg.target_data_table_id)
  })),
  // Phase B：暂存 tab 排在表 tab 之后、图表 tab 之前（贴近③目标多选控件里「数据表/暂存区/图表」三组的顺序）。
  ...(stagingTargetInModel.value
    ? [
        {
          key: 'staging:',
          kind: 'staging' as const,
          label: t('editor.stagingTargetLabel')
        }
      ]
    : []),
  ...chartTargetsInModel.value.map(c => ({
    key: `chart:${c.chart_id}`,
    kind: 'chart' as const,
    chartId: c.chart_id,
    label: chartTabLabel(c.chart_id)
  }))
]);
// 当前激活 tab：组件内 ref，不持久化；若当前 key 已不在 tab 列表中（目标被移除/首次加载），回落列表首项。
const activeTargetKeyRaw = ref('');
const activeTargetKey = computed<string>({
  get: () =>
    allTargetTabs.value.some(tb => tb.key === activeTargetKeyRaw.value)
      ? activeTargetKeyRaw.value
      : (allTargetTabs.value[0]?.key ?? ''),
  set: v => {
    activeTargetKeyRaw.value = v;
    activeFieldKey.value = ''; // 切 tab 清空行激活态（另一 tab 的字段集合不同，旧激活态无意义）
  }
});
const activeTab = computed<TargetTab | undefined>(() =>
  allTargetTabs.value.find(tb => tb.key === activeTargetKey.value)
);
// 拆出非空的 activeTableId/activeChartId（而非在模板里反复用 activeTab.tableId）：activeTab 是 computed，
// vue-tsc 对"外层 v-if 收窄 → 内层 v-for 闭包里再访问"这条链路无法保证类型收窄持续有效（TS18048/TS2345），
// 这两个 computed 各自把"该 kind 下必然非空"的字段收敛成非 undefined 的具体类型，模板里直接用即可过闸门。
const activeTableId = computed<string>(() =>
  activeTab.value?.kind === 'table' ? (activeTab.value.tableId ?? '') : ''
);
const activeChartId = computed<string>(() =>
  activeTab.value?.kind === 'chart' ? (activeTab.value.chartId ?? '') : ''
);
const activeChartSpec = computed<ChartTargetSpec | undefined>(() =>
  activeChartId.value ? chartTargetsInModel.value.find(c => c.chart_id === activeChartId.value) : undefined
);
const activeChartCatalogEntry = computed<ChartCatalogEntry | undefined>(() =>
  activeChartId.value ? chartCatalog.value.find(c => c.chartId === activeChartId.value) : undefined
);
// Phase B（动作暂存区）：暂存 tab 激活时的目标 spec（同 activeChartSpec 的"收窄成具体类型"惯例）。
const activeStagingTarget = computed<TargetSpec | undefined>(() =>
  activeTab.value?.kind === 'staging' ? stagingTargetInModel.value : undefined
);

// —— 目标多选控件（NSelect multiple 分组：数据表 / 暂存区 / 图表）——
// i18n 说明：locales 文件本任务硬约束不得改，故本区分组标签尽量复用既有 key（'chart_target.chart'='图表'、
// 'chart_target.empty_catalog'='未检测到图表'），只新增 'editor.targetGroupTables'（无既有对应短词可复用）——
// 该新 key 未登记进 locales 文件，运行时经 useT() 回落 host.t 缺省链会显示裸 key 文案，需外部同步补齐
// （见开发回执 i18n 新增 key 清单）。
const targetMultiSelectOptions = computed(() => [
  {
    type: 'group' as const,
    key: 'g-tables',
    label: t('editor.targetGroupTables'),
    children: targetTableOptions.value.map(o => ({
      label: o.label,
      value: `table:${o.value}`
    }))
  },
  // Phase B：暂存区固定单选项——「暂存区(供下一步使用)」，key 固定 'staging:'（一模型至多一个，无需列举）。
  {
    type: 'group' as const,
    key: 'g-staging',
    label: t('editor.targetGroupStaging'),
    // hideStagingTarget（V4 取数）：整组不放选项——naive-ui 分组无原生禁用语义，空 children 天然不可选。
    children: props.hideStagingTarget ? [] : [{ label: t('editor.stagingTargetLabel'), value: 'staging:' }]
  },
  {
    type: 'group' as const,
    key: 'g-charts',
    // 目录不可用/无可选图表时组内不放任何选项（而非禁用整组——naive-ui 分组无原生禁用语义，空 children 天然不可选）。
    label:
      chartCatalogUnavailable.value || fillableCharts.value.length === 0
        ? `${t('chart_target.chart')}（${t('chart_target.empty_catalog')}）`
        : t('chart_target.chart'),
    children: chartCatalogUnavailable.value
      ? []
      : fillableCharts.value.map(c => ({
          label: `${c.sheetName} / ${c.title || t('chart_target.untitled')}`,
          value: `chart:${c.chartId}`
        }))
  }
]);
const targetSelectValue = computed<string[]>(() => allTargetTabs.value.map(tb => tb.key));

/** 新建一个空白图表映射（categorySeries 默认长表），供多选新增图表目标时初始化 mapping 骨架。 */
function emptyChartMapping(form: ChartTargetSpec['chart_form']): ChartTargetSpec['mapping'] {
  if (form === 'categorySeries')
    return {
      form: 'categorySeries',
      layout: 'long',
      category: { kind: 'const', value: '' }
    };
  if (form === 'nameValue')
    return {
      form: 'nameValue',
      name: { kind: 'const', value: '' },
      value: { kind: 'const', value: '' }
    };
  return {
    form: 'points',
    x: { kind: 'const', value: '' },
    y: { kind: 'const', value: '' }
  };
}
/** 新增图表目标 + 自动预指派（R13.3 沿用，创建时机由「填充到图表」子区块上移到此处）：合并当前全部表目标的
 *  outputs + 各自表字段 data_type，文本→类目/名称、数值→值，尽力而为、取不到就跳过，不新造类型推断设施。 */
function createChartTargetSpec(entry: ChartCatalogEntry, currentTargets: TargetSpec[]): ChartTargetSpec {
  const spec: ChartTargetSpec = {
    chart_id: entry.chartId,
    chart_form: entry.chartForm,
    mapping: emptyChartMapping(entry.chartForm)
  };
  let textExpr: ValueRef | undefined;
  const numExprs: ValueRef[] = [];
  for (const tgt of currentTargets) {
    const fields = fieldsOf(tgt.target_data_table_id);
    for (const o of tgt.outputs) {
      const dt = fields.find(f => f.field_id === o.target_field_id)?.data_type;
      if (isAttachmentFieldDataType(dt)) continue;
      if (dt === 'number') numExprs.push(o.expression);
      else if (dt && !textExpr) textExpr = o.expression;
    }
  }
  const m = spec.mapping;
  if (m.form === 'categorySeries') {
    if (textExpr) m.category = textExpr;
    if (m.layout === 'long' && numExprs[0]) m.value = numExprs[0];
  } else if (m.form === 'nameValue') {
    if (textExpr) m.name = textExpr;
    if (numExprs[0]) m.value = numExprs[0];
  } else if (m.form === 'points') {
    if (numExprs[0]) m.x = numExprs[0];
    if (numExprs[1]) m.y = numExprs[1];
  }
  return spec;
}

/** 目标多选变更：diff 新旧 key 集合，增删表目标/暂存目标/图表目标，模型读写全走 writeTargets（唯一入口）。
 *  🔴 表目标子集改用 readTableTargets（唯一入口）——原实现用裸 `t.target_data_table_id !== ''` 内联过滤，
 *  暂存目标同样 target_data_table_id===''，会被这条内联过滤一并挡在 `targets` 变量之外；本函数收尾统一
 *  writeTargets(m, targets, chartTargets) 整体回写时，若 targets 里从未包含过暂存目标，则任何一次编辑
 *  表目标/图表目标的多选操作都会把已有的暂存目标静默冲掉。改用 readTableTargets 后 targets 变量始终只
 *  代表"表目标"这一个子集，暂存目标改走独立的 stagingTarget 变量，最终拼接回 writeTargets 入参，三类
 *  目标各自独立增删、互不冲刷。 */
/** 目标多选下拉的受控开关（UI 反馈 2026-09-07 ②）：NSelect multiple 默认选完仍停留展开，用户每次都要
 *  点外部才能关；这里选中/取消一个对象后立即收起。 */
const targetSelectShow = ref(false);
function onUpdateTargetSelectionAndClose(keys: string[]): void {
  onUpdateTargetSelection(keys);
  targetSelectShow.value = false;
}
function onUpdateTargetSelection(keys: string[]) {
  const prevKeys = targetSelectValue.value;
  const added = keys.filter(k => !prevKeys.includes(k));
  const removed = prevKeys.filter(k => !keys.includes(k));
  if (added.length === 0 && removed.length === 0) return;
  update(m => {
    let targets = readTableTargets(m);
    let chartTargets = readChartTargets(m);
    let stagingTarget = readStagingTarget(m);
    for (const key of removed) {
      if (key.startsWith('table:')) {
        const id = key.slice('table:'.length);
        const removedTarget = targets.find(t => t.target_data_table_id === id);
        targets = targets.filter(t => t.target_data_table_id !== id);
        // 连带清理：该目标的排序键（order_by 按表达式 JSON 匹配，目标一移除其排序键即成悬空引用）。
        if (removedTarget && m.order_by) {
          const exprKeys = new Set(removedTarget.outputs.map(o => JSON.stringify(o.expression)));
          m.order_by = m.order_by.filter(k2 => !exprKeys.has(JSON.stringify(k2.value)));
          if (m.order_by.length === 0) delete m.order_by;
        }
      } else if (key === 'staging:') {
        // Phase B：移除暂存目标（一模型至多一个，直接清空即可，无需按 ID 过滤）。
        stagingTarget = undefined;
      } else if (key.startsWith('chart:')) {
        const cid = key.slice('chart:'.length);
        chartTargets = chartTargets.filter(c => c.chart_id !== cid);
      }
    }
    for (const key of added) {
      if (key.startsWith('table:')) {
        const id = key.slice('table:'.length);
        if (!targets.some(t => t.target_data_table_id === id)) {
          const nt = emptyTarget(props.templateId);
          nt.target_data_table_id = id;
          nt.target_table_role = tableMeta(props.templateId, id).role;
          if (!isWriteMode.value) nt.clear = { mode: 'mapped', timing: 'before' };
          if (!isWriteMode.value && isV4RefSyntax) nt.distinct = true;
          targets.push(nt);
        }
      } else if (key === 'staging:') {
        // Phase B：新增暂存目标（一模型至多一个，已存在则不重复创建）。
        if (!stagingTarget) stagingTarget = emptyStagingTarget();
      } else if (key.startsWith('chart:')) {
        const cid = key.slice('chart:'.length);
        if (!chartTargets.some(c => c.chart_id === cid)) {
          const entry = chartCatalog.value.find(c => c.chartId === cid);
          if (entry) chartTargets.push(createChartTargetSpec(entry, targets));
        }
      }
    }
    writeTargets(m, stagingTarget ? [...targets, stagingTarget] : targets, chartTargets);
  });
  // 新增目标后自动切到其 tab（多选一次通常只加一个；同时加多个取最后一个），便于立即映射字段/槽位。
  const lastAdded = added[added.length - 1];
  if (lastAdded) activeTargetKeyRaw.value = lastAdded;
}

/** 暂存 tab 内容回写（Phase B）：StagingTargetSection 单 spec 进/出，与 setChartTargetSpec 同款接线——
 *  取当前表目标子集 + 新 spec 重新走 writeTargets（唯一入口）。 */
function setStagingTargetSpec(spec: TargetSpec) {
  const picked: TargetSpec = {
    ...spec,
    outputs: spec.outputs.map(o => ({
      ...o,
      expression:
        pickedRefForSyntax(o.expression, refSyntax, sourceTablesForInput.value, formTablesForInput.value, systemVariablesCatalog.value, { systemVariableToken }) ??
        o.expression
    }))
  };
  update(m => {
    writeTargets(m, [...readTableTargets(m), picked], readChartTargets(m));
  });
}

/** 按 tableId 找该表目标（多个表 tab 共用的取数函数）。 */
function targetByTableId(tableId: string): TargetSpec | undefined {
  return readTargets(model.value).find(t => t.target_data_table_id === tableId);
}

// —— 清空规则：每个表目标独立一份 target.clear={mode,timing}，
// 控件放在③目标 tabs 行右侧、随激活 tab 切换（图表目标无 clear 字段，推送即整体替换，不出设置）。
// 「清除方式」与「清除时机」是两个独立设置项：
//   清空方式  none   → 「无」：不清空（模型删除 clear 键，与"未配置"同形）
//            mapped → 「填充字段」：清本目标的输出列（匹配键列除外）
//            all    → 「整表」：清明细区每一行、全部字段含匹配键列（公式格由运行期跳过）——仅明细目标提供
//   （三档的界面文案 2026-09-08 由「不清空/清映射字段/清整表」改为「无/填充字段/整表」，枚举值不变）
//   清除时机  before → 取值前：先清 Mirror 再取参数快照再查询（旧数据不参与查询条件）
//            after  → 取值后：参数快照取完后清空与查询并发，两路完成才填充（空结果也照样清）
// 运行期是执行开始时**物理清 Mirror 值**（只清值不删行），与旧「登记进原子补丁」口径不同。
// 时机控件在方式=none 时禁用（无清空则无时机）；模型形态 clear={mode,timing} 不变。
type ClearMode = 'none' | 'mapped' | 'all';
type ClearTiming = 'before' | 'after';
function clearModeOf(tableId: string): ClearMode {
  const c = targetByTableId(tableId)?.clear;
  if (!c || c.mode === 'none') return 'none';
  return c.mode === 'all' ? 'all' : 'mapped';
}
/** 无 clear 段时显示缺省 before（与新目标种子、运行期 Timing 空值缺省同口径）。 */
function clearTimingOf(tableId: string): ClearTiming {
  const c = targetByTableId(tableId)?.clear;
  return c?.timing === 'after' ? 'after' : 'before';
}
/** 目标表角色（main/detail）：优先设计器固化的 target_table_role，回落表目录判定。 */
function targetRoleOf(tableId: string): TableRole {
  const tgt = targetByTableId(tableId);
  return tgt?.target_table_role ?? tableMeta(props.templateId, tableId).role;
}
function clearModeOptionsFor(tableId: string): { label: string; value: ClearMode }[] {
  const base: { label: string; value: ClearMode }[] = [];
  if (targetRoleOf(tableId) !== 'main') {
    base.push({ label: t('editor.clearModeAll'), value: 'all' });
  }
  base.push({ label: t('editor.clearModeMapped'), value: 'mapped' });
  base.push({ label: t('editor.clearModeNone'), value: 'none' });
  return base;
}
const clearTimingOptions = computed<{ label: string; value: ClearTiming }[]>(() => [
  { label: t('editor.clearTimingBefore'), value: 'before' },
  { label: t('editor.clearTimingAfter'), value: 'after' }
]);
function setClearModeIn(tableId: string, mode: ClearMode) {
  update(m => {
    const tgt = readTargets(m).find(tg => tg.target_data_table_id === tableId);
    if (!tgt) return;
    if (mode === 'none') {
      delete tgt.clear;
      return;
    }
    tgt.clear = { mode, timing: tgt.clear?.timing ?? 'before' };
  });
}
function setClearTimingIn(tableId: string, timing: ClearTiming) {
  update(m => {
    const tgt = readTargets(m).find(tg => tg.target_data_table_id === tableId);
    if (!tgt?.clear || tgt.clear.mode === 'none') return; // 无清空则无时机（控件本就禁用）
    tgt.clear = { mode: tgt.clear.mode, timing };
  });
}
function autoRowMatchOf(tableId: string): boolean {
  const v = targetByTableId(tableId)?.auto_row_match;
  if (isV4RefSyntax) return v !== false;
  return v ?? false;
}
function setAutoRowMatchIn(tableId: string, v: boolean) {
  update(m => {
    const tgt = readTargets(m).find(tg => tg.target_data_table_id === tableId);
    if (!tgt) return;
    if (isV4RefSyntax) {
      // V4 缺省即开：开=删字段（回到缺省），关=显式 false（配置面收口据此跳过抽键）。
      if (v) delete tgt.auto_row_match;
      else tgt.auto_row_match = false;
      return;
    }
    if (v) tgt.auto_row_match = true;
    else delete tgt.auto_row_match;
    // 开关切换后的存量 row_match 输出归一化由 reconcile（update 收口处）统一完成，此处不重复。
  });
}
// —— 执行后清理空行——
// 与 auto_row_match 同一形状：per-target 独立配置、控件随激活表 tab 走、仅明细目标显示。
// 语义：本次填充写回之后删除该表**末尾连续的空行**，下限固定保留 2 行（不会把表清成 0 行）。
// 解决的是「这次取数结果比上次少 ⇒ 扩展表尾部留一堆空行要手工删」。局部触发下后端跳过。
// 默认关（缺省 = 不清理，存量配置零行为变化）。
function trimEmptyRowsAfterFillOf(tableId: string): boolean {
  return targetByTableId(tableId)?.trim_empty_rows_after_fill ?? false;
}
function setTrimEmptyRowsAfterFillIn(tableId: string, v: boolean) {
  update(m => {
    const tgt = readTargets(m).find(tg => tg.target_data_table_id === tableId);
    if (!tgt) return;
    if (v) tgt.trim_empty_rows_after_fill = true;
    else delete tgt.trim_empty_rows_after_fill;
  });
}
function distinctOf(tableId: string): boolean {
  return targetByTableId(tableId)?.distinct ?? true;
}
function setDistinctIn(tableId: string, v: boolean) {
  update(m => {
    const tgt = readTargets(m).find(t => t.target_data_table_id === tableId);
    if (!tgt) return;
    tgt.distinct = v;
  });
}
/** 逐目标「仅限前 N 条」：null=不限（删字段）；数值向下取整，<1 亦视为不限（服务端 schema minimum=1）。 */
function takeOf(tableId: string): number | null {
  return targetByTableId(tableId)?.take ?? null;
}
function setTakeIn(tableId: string, v: number | null) {
  update(m => {
    const tgt = readTargets(m).find(t => t.target_data_table_id === tableId);
    if (!tgt) return;
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null;
    if (n !== null && n >= 1) tgt.take = n;
    else delete tgt.take;
  });
}
function outputForIn(tableId: string, fieldId: string): OutputMapping {
  return (
    targetByTableId(tableId)?.outputs.find(o => o.target_field_id === fieldId) ?? {
      target_field_id: fieldId,
      // 只读兜底：该字段尚未有输出行，形状用「不填充」态占位——const 且 value 缺省（不是空字符串）。
      // isEmptyExpr 据此判定它是「未配置」，不会被误判成用户主动填了空串。
      expression: { kind: 'const' },
      fill_strategy: 'overwrite',
      separator: ','
    }
  );
}
/** 目标字段行是否「已配置」（决定行的 .filled 浅蓝描边）：此前只看「有输出行」——✕ 清空后行仍保留
 *  （承载填充方式/排序等行内配置，见 setOutputExprIn 注释），导致清空后行依旧蓝色高亮、看起来像编辑过。
 *  改为看该行表达式是否真的配了（isUnconfiguredOutputExpr）。 */
function isFieldConfigured(tableId: string, fieldId: string): boolean {
  const o = targetByTableId(tableId)?.outputs.find(x => x.target_field_id === fieldId);
  return !!o && !isUnconfiguredOutputExpr(o.expression);
}
function upsertOutputIn(tableId: string, fieldId: string, mut: (o: OutputMapping) => void) {
  update(m => {
    const tgt = readTargets(m).find(t => t.target_data_table_id === tableId);
    if (!tgt) return;
    let o = tgt.outputs.find(x => x.target_field_id === fieldId);
    if (!o) {
      o = {
        target_field_id: fieldId,
        // 新建行同样以「不填充」态起手（value 缺省）；用户随后经 setOutputExprIn 主动赋值（含填 ''/0/null）
        // 才落成「主动赋值」态，二者不再坍缩成同一形状（三态口径见 isEmptyExpr 注释）。
        expression: { kind: 'const' },
        fill_strategy: 'overwrite',
        separator: ','
      };
      tgt.outputs.push(o);
    }
    mut(o);
  });
}
const FILL_STRATEGY_UNSUPPORTED_DATA_TYPES: ReadonlySet<string> = new Set(['date', 'datetime', 'boolean']);
const FILL_STRATEGY_UNSUPPORTED_CONTROL_TYPES: ReadonlySet<string> = new Set(['radio', 'select']);
function strategyOptionsFor(tableId: string, fieldId?: string): { label: string; value: FillStrategy }[] {
  const field = fieldId ? fieldsOf(tableId).find(f => f.field_id === fieldId) : undefined;
  const appendMergeUnsupported =
    !!field &&
    (FILL_STRATEGY_UNSUPPORTED_DATA_TYPES.has(field.data_type) ||
      (!!field.control_type && FILL_STRATEGY_UNSUPPORTED_CONTROL_TYPES.has(field.control_type)));
  // 已存量选中 append/merge（脏数据/规则生效前的配置）时，即便字段类型现属不支持之列，也不能让该
  // 选项静默从列表消失——否则下拉会显示成空白/被迫回落别的值，等同帮用户悄悄改写了配置。保留当前值
  // 可见，交由保存闸在提交时真正拒绝；前端这层只挡**新选**进不支持的策略。
  const current = fieldId ? outputForIn(tableId, fieldId).fill_strategy : undefined;
  const base: { label: string; value: FillStrategy }[] = [{ label: t('editor.strategyOverwrite'), value: 'overwrite' }];
  if (current === 'append') base.push({ label: t('editor.strategyAppend'), value: 'append' });
  if (!appendMergeUnsupported || current === 'merge') base.push({ label: t('editor.strategyMerge'), value: 'merge' });
  // 「按行列匹配」：
  // 自动模式下匹配键由筛选条件里的等式抽出（3.4 在 reconcile、V4 在收口时抽键），不再让用户在填充方式里
  // 手动重复声明——两条通道并存会语义矛盾（rowMatchStrategyAllowed 注释）。V4 的开关缺省即开（autoRowMatchOf），
  // 故 V4 新建行缺省不出现该项，关掉开关后才可手动选。**存量已是 row_match 的行保留当前值可见**（抽键产出的
  // 行本来就是 row_match；开关后开时用户手动配的行也是）——同上 append/merge 的口径：不让下拉显示成空白/
  // 静默改写配置。主表恒不可选。
  const role = targetRoleOf(tableId);
  const rowMatchUnsupported = isAttachmentFieldDataType(field?.data_type);
  if ((!rowMatchUnsupported && rowMatchStrategyAllowed(role, autoRowMatchOf(tableId))) || (current === 'row_match' && role !== 'main')) {
    base.push({ label: t('editor.strategyRowMatch'), value: 'row_match' });
  }
  return base;
}
function isAttachmentTargetField(tableId: string, fieldId: string): boolean {
  return isAttachmentFieldDataType(fieldsOf(tableId).find(f => f.field_id === fieldId)?.data_type);
}
// 合并分隔符：仅该列填充方式=merge 时行内出现下拉，写 output.separator。
const separatorOptions = computed(() => [
  { label: t('editor.sepComma'), value: ',' },
  { label: t('editor.sepSemicolon'), value: ';' },
  { label: t('editor.sepPeriod'), value: '.' },
  { label: t('editor.sepSpace'), value: ' ' },
  { label: t('editor.sepPlus'), value: '+' },
  { label: t('editor.sepSlash'), value: '/' },
  { label: t('editor.sepNewline'), value: '\n' }
]);
function setOutputSeparatorIn(tableId: string, fieldId: string, v: string) {
  upsertOutputIn(tableId, fieldId, o => {
    o.separator = v;
  });
}
const sortOptions = computed(() => [
  { label: t('editor.sortNone'), value: 'none' },
  { label: t('editor.sortAsc'), value: 'asc' },
  { label: t('editor.sortDesc'), value: 'desc' }
]);
function setOutputExprIn(tableId: string, fieldId: string, v: ValueRef | null) {
  const picked = pickedRefForSyntax(v, refSyntax, sourceTablesForInput.value, formTablesForInput.value, systemVariablesCatalog.value, { systemVariableToken });
  upsertOutputIn(tableId, fieldId, o => {
    // v===null 来自 ExpressionInput 的 ✕ 清除按钮（见 clear()），语义是"用户主动清空这一行的配置"，
    // 须落回「不填充」占位态（const 且 value 缺省）——不能兜底成 { kind:'const', value:'' }，否则会被
    // 误判成"用户主动填了空字符串"，两种不同语义（不填充 vs 填空值）会坍缩成同一形状（三态口径见
    // isEmptyExpr 注释）。用户若要真正"填空值"（写 NULL 清空目标字段），走 ⊞ 快捷选择的「空值」项
    // （allow-null-const，产出 {kind:'const', value:null}），不经过这条清除路径。
    o.expression = picked ?? { kind: 'const' };
  });
  // 「插完跳下一行」（数据流左右分栏改版：常驻树坞撤下，原经 bus.insert 侧路触发的联动改以"新值是
  // 一次原子拾取"作判据——source_field/system_var 是 ⊞ 快捷选择器与旧树坞产出的同一种"点一下就落定"
  // 的值；「ƒ」表达式弹窗确定产出 raw 节点、✕ 清空产出 null，均不满足条件，不触发，行为与改版前一致。
  // 判据看**转换前**的 v：brackets 下 picked 已是 raw，用它判会让「插完跳下一行」整个失效。
  if (v && (v.kind === 'source_field' || v.kind === 'system_var')) {
    advanceToNextFieldAfterInsert(`tgt-${fieldId}`);
  }
}
function setOutputStrategyIn(tableId: string, fieldId: string, s: FillStrategy) {
  upsertOutputIn(tableId, fieldId, o => {
    o.fill_strategy = s;
  });
}
// —— 排序（③目标字段行右侧下拉）——
//
// 两条承载互不相同，按语法模式分流：
//   V4（isV4RefSyntax）：写**本目标自己的** target.order_by（按 target_field_id + direction），
//     与 V4 文档 targets[].order_by 逐字同构 ⇒ 适配层直接搬运、服务端 extractdoc→definition
//     →lower.deriveSortPlan→queryir.Sort→渲染 ORDER BY 全链已通。
//     改判前这里写的是 3.4 顶层 m.order_by，而适配层反向写的是上一版文档的 targets[].order_by，
//     两条通道从不相交——用户设的排序保存即丢、重开恒显示「不排序」，即本次的根因。
//   3.4：仍写顶层 m.order_by（按表达式 JSON 匹配），那是 expressionv2 引擎认的形态，原样保留。
// 主表目标不出这个控件（主表恒一行 main:0，排序无意义），调和时还会剥离存量键，见 reconcile。
function sortDirForIn(tableId: string, fieldId: string): 'none' | 'asc' | 'desc' {
  if (isV4RefSyntax) {
    const found = (targetByTableId(tableId)?.order_by ?? []).find(k => k.target_field_id === fieldId);
    return found?.direction ?? 'none';
  }
  const o = outputForIn(tableId, fieldId);
  const key = JSON.stringify(o.expression);
  const found = (model.value.order_by ?? []).find(k => JSON.stringify(k.value) === key);
  return found?.dir ?? 'none';
}
function setSortIn(tableId: string, fieldId: string, dir: 'none' | 'asc' | 'desc') {
  if (isV4RefSyntax) {
    // 先确保该字段有输出行（排序键必须指向本目标 outputs 里的字段，否则服务端整份拒绝）——
    // 与同一行的「填充方式」下拉同款口径：选了就先建占位输出行（见 setOutputExprIn 注释）。
    upsertOutputIn(tableId, fieldId, () => {});
    update(m => {
      const tgt = readTargets(m).find(t => t.target_data_table_id === tableId);
      if (!tgt) return;
      // 恒写数组（哪怕清成空）：空数组=「用户把本目标排序清空了」，适配层据此折成 undefined；
      // 整键缺省才表示「本模型没编辑过排序」并回落上一版文档，两者不可混同。
      const next = (tgt.order_by ?? []).filter(k => k.target_field_id !== fieldId);
      if (dir !== 'none') next.push({ target_field_id: fieldId, direction: dir });
      tgt.order_by = next;
    });
    return;
  }
  update(m => {
    const tgt = readTargets(m).find(t => t.target_data_table_id === tableId);
    const o = tgt?.outputs.find(x => x.target_field_id === fieldId) ?? outputForIn(tableId, fieldId);
    const key = JSON.stringify(o.expression);
    m.order_by = (m.order_by ?? []).filter(k => JSON.stringify(k.value) !== key);
    if (dir !== 'none') m.order_by.push({ value: o.expression, dir });
    if (m.order_by.length === 0) delete m.order_by;
  });
}


/** 图表 tab 内容回写：ChartTargetSection 改造版只编辑单个 spec，父组件按 chart_id 替换回 chart_targets 数组。 */
function setChartTargetSpec(chartId: string, spec: ChartTargetSpec) {
  update(m => {
    const chartTargets = readChartTargets(m).map(c => (c.chart_id === chartId ? pickChartSpecForSyntax(spec) : c));
    writeTargets(m, readTargets(m), chartTargets);
  });
}

/**
 *
 * 表目标输出行（setOutputExprIn）与暂存列（setStagingTargetSpec）都在各自的唯一回写点把 ⊞ 快捷选择
 * 产出的**结构化 ValueRef** 就地转成方括号文本，唯独图表槽位的 ChartTargetSection.setSlot 是直写 mapping、
 * 从没转过。后果：V4 壳下配置面每次编辑都要经适配层往返一圈，而 valueRefToV4Expression
 * 只认 text_source.text / text 两个键，结构化 ref 两个都没有 ⇒ 被压成 source_text:''，回程变成空文本的
 * raw ⇒ 值区一个 token 都渲染不出来，而槽位的空判据只看「空 const」又把它算作已设置——用户看到的正是
 *「快捷选择完，字段内容不显示在系列里，却被标记为已设置」。
 *
 * 这里在图表的唯一回写点统一转一次（转不出文本的形态原样保留，绝不兜底成空串，同 setOutputExprIn 口径）。
 */
function pickChartSpecForSyntax(spec: ChartTargetSpec): ChartTargetSpec {
  const conv = <T extends ValueRef | undefined>(v: T): T =>
    (v
      ? pickedRefForSyntax(v, refSyntax, sourceTablesForInput.value, formTablesForInput.value, systemVariablesCatalog.value, { systemVariableToken }) ?? v
      : v) as T;
  const m = spec.mapping;
  if (m.form === 'categorySeries') {
    return {
      ...spec,
      mapping: {
        ...m,
        category: conv(m.category),
        series: conv(m.series),
        value: conv(m.value),
        values: m.values?.map(vc => ({ ...vc, expression: conv(vc.expression) }))
      }
    };
  }
  if (m.form === 'nameValue') {
    return { ...spec, mapping: { ...m, name: conv(m.name), value: conv(m.value) } };
  }
  return { ...spec, mapping: { ...m, x: conv(m.x), y: conv(m.y), series: conv(m.series) } };
}

/** 写模式专属候选顺序（用户 09-10 反馈修法：修改扩展表按名称填充误命中候选池/自身字段）：
 *  sourceTablesForInput 原是"各来源被登记进 model.source.tables 的时间先后"这一自然序——写目标
 *  模板配对表（隐含来源/候选池，tgt- 别名）一旦先于本报表被引用（哪怕是另一字段引用、与本次匹配
 *  无关），就会排在本报表前面：候选池表若恰好也带同名字段（业务常见——明细行常年镶边一份主数据
 *  快照），「按名称填充」会先命中候选池表**自己的字段**，不是用户想要的本报表字段。
 *  改判：本报表来源（bt 或 rpt- 前缀别名）恒最优先，其次用户手动加入的目录/来源表，写目标相关表
 *  （tgt- 别名）恒垫底——只有前两档都找不到同名字段时才轮到它自己的字段（且下方 isSelfMatch 仍会
 *  排除"同表同字段"的字面自赋值，永不匹配到自己那一个字段）。仅写模式重排；取数模式原样返回
 *  （原数组顺序不变，不影响既有行为）。 */
function autoMatchCandidateOrder(candidates: readonly (typeof sourceTablesForInput.value)[number][]): (typeof sourceTablesForInput.value)[number][] {
  if (!isWriteMode.value) return [...candidates];
  const report: (typeof sourceTablesForInput.value)[number][] = [];
  const catalog: (typeof sourceTablesForInput.value)[number][] = [];
  const writeTarget: (typeof sourceTablesForInput.value)[number][] = [];
  for (const src of candidates) {
    if (isReportContextAlias(src.alias)) report.push(src);
    else if (isWriteTargetSourceAlias(src.alias)) writeTarget.push(src);
    else catalog.push(src);
  }
  return [...report, ...catalog, ...writeTarget];
}
function autoMatchFields(tableId: string) {
  const fields = fieldsOf(tableId);
  const candidates = autoMatchCandidateOrder(sourceTablesForInput.value);
  let matched = 0;
  update(m => {
    ensureWriteOperation(m); // 取数模式下空操作；写模式下补种 target.operation。
    const tgt = readTargets(m).find(t => t.target_data_table_id === tableId);
    if (!tgt) return;
    for (const f of fields) {
      const existing = tgt.outputs.find(o => o.target_field_id === f.field_id);
      // 已映射行不覆盖。判据用 isUnconfiguredOutputExpr 而非 isEmptyExpr（demo 采购入库单值变动动作
      // 「按名称填充」提示已匹配却无任何改动）：V4 壳下未配置行往返回来是 {kind:'raw', text:''} 空文本
      // 形态，isEmptyExpr 认它"已配"会整行跳过，按名称填充对这些行永远不生效。
      if (existing && !isUnconfiguredOutputExpr(existing.expression)) continue;
      const isSelfMatch = (src: (typeof sourceTablesForInput.value)[number], fieldId: string): boolean =>
        isWriteMode.value && (isWriteTargetSourceAlias(src.alias) || src.dataTableId === tableId) && fieldId === f.field_id;
      let hit: { alias: string; field_id: string } | null = null;
      for (const src of candidates) {
        const byCode = src.fields.find(sf => sf.field_code === f.field_code && !isSelfMatch(src, sf.field_id));
        if (byCode) {
          hit = { alias: src.alias, field_id: byCode.field_id };
          break;
        }
      }
      if (!hit) {
        for (const src of candidates) {
          const byName = src.fields.find(sf => sf.field_name === f.field_name && !isSelfMatch(src, sf.field_id));
          if (byName) {
            hit = { alias: src.alias, field_id: byName.field_id };
            break;
          }
        }
      }
      if (!hit) continue;
      let o = existing;
      if (!o) {
        o = isWriteMode.value
          ? {
              target_field_id: f.field_id,
              // 新建行先落「不填充」占位态，紧接着下方就会被赋值成命中的字段，此处形状仅为占位。
              expression: { kind: 'const' }
            }
          : {
              target_field_id: f.field_id,
              expression: { kind: 'const' },
              fill_strategy: 'overwrite',
              separator: ','
            };
        tgt.outputs.push(o);
      }
      const matchedRef: ValueRef = { kind: 'source_field', alias: hit.alias, field_id: hit.field_id };
      // 取数与写模式一律过 pickedRefForSyntax：brackets/V4
      // 语法下结构化 source_field 经适配层 valueRefToV4Expression 只认文本，会被压成 source_text:''——
      // 表现为「已匹配 N 个字段」但各行仍为空、保存时被当未配置剔除。braces（3.4）下原样返回结构化值。
      o.expression =
        pickedRefForSyntax(matchedRef, refSyntax, sourceTablesForInput.value, formTablesForInput.value, systemVariablesCatalog.value, { systemVariableToken }) ??
        matchedRef;
      matched += 1;
    }
  });
  // t() 的宿主缺省 fallback 不支持插值，故手动拼接数字。
  message.success(`${t('editor.autoMatchDone')}${matched}${t('editor.autoMatchDoneUnit')}`);
}

const exprInputRefs = new Map<string, { activate: (evtOrOpts?: MouseEvent | { x?: number; y?: number; drawerOnly?: boolean }) => void }>();
function setExprInputRef(fieldId: string, el: unknown): void {
  if (el && typeof (el as any).activate === 'function')
    exprInputRefs.set(fieldId, el as { activate: (evtOrOpts?: MouseEvent | { x?: number; y?: number; drawerOnly?: boolean }) => void });
  else exprInputRefs.delete(fieldId);
}
const activeFieldKey = ref('');
let lastQuickPickPoint: { x: number; y: number } | undefined;
/** 相邻目标行的弹出层叠纵向偏移（step）：优先按 DOM 实测——当前行与下一行元素 top 之差；量不到
 *  （jsdom 无真实布局恒返回 0 / 元素未挂载）回落常量。prefix 区分取数③目标行与写模式④赋值行两套
 *  不同的 data-testid 前缀。 */
const TARGET_ROW_STEP_FALLBACK = 36;
function measureNextRowStep(prefix: string, currentFieldId: string, nextFieldId: string): number {
  const testidPrefix = prefix === 'wtgt-' ? 'expression-write-target-row-' : 'expression-target-row-';
  const curEl = document.querySelector(`[data-testid="${testidPrefix}${currentFieldId}"]`);
  const nextEl = document.querySelector(`[data-testid="${testidPrefix}${nextFieldId}"]`);
  if (!curEl || !nextEl) return TARGET_ROW_STEP_FALLBACK;
  const diff = nextEl.getBoundingClientRect().top - curEl.getBoundingClientRect().top;
  return diff > 0 ? diff : TARGET_ROW_STEP_FALLBACK;
}
/** 点击行：右侧两个下拉（.w80）与表达式框本体（.tc-expr，含其内部 ×/ƒ）保持原生点击行为不变，其余区域
 *  （空白/字段名 .tc-name）触发本行的 ⊞ 快捷选择器（数据流左右分栏改版：常驻树坞撤下后，行点击不再
 *  强制 drawerOnly 注册进抽屉总线——那样没有任何 UI 能消费插入，行为等同"死点击"；改为不带 opts 调用
 *  activate()，配合下方目标行 ExpressionInput 的 prefer-quick-pick=true，直接打开该行的 ⊞ 弹层。
 *  UI 反馈 2026-09-07 ④：prefer-quick-pick 下点值区/行空白**一律**打开 ⊞（不再因值已是 raw/text_source 而改弹
 *  「ƒ」编辑器——V4 壳下所有已配表达式都是 text_source 形态，连清空后往返回来的空表达式也是）；「ƒ」按钮是
 *  表达式编辑器的唯一入口，✕ 清空。 */
function onTargetRowClick(fieldId: string, evt: MouseEvent): void {
  const target = evt.target as HTMLElement;
  if (target.closest('.tc-expr') || target.closest('.w80')) return;
  activeFieldKey.value = fieldId;
  lastQuickPickPoint = { x: evt.clientX, y: evt.clientY };
  exprInputRefs.get(fieldId)?.activate(evt);
}
/** ⊞ 快捷选择器关闭（选中/未选都会发）时只清"自己这一行"的激活高亮（UI 反馈 2026-09-07 ③）：
 *  「插完跳下一行」自动打开下一行的选择器，用户不选就关掉时，该行此前会一直顶着 row-active 蓝描边。
 *  只在激活键仍是本行时清——插入后 advanceToNextFieldAfterInsert 已把激活态移到下一行，本行迟到的
 *  关闭事件不能误清下一行。 */
/** ⊞ 面板按坐标打开时记「上次弹出点」（用户 09-09 三次反馈）：无论是行级点击、直接点值区还是
 *  「插完跳下一行」程序化打开，最终都从 ExpressionInput 这一个口上报，宿主不再各自记点。 */
function onQuickPickOpened(point: { x: number; y: number }): void {
  lastQuickPickPoint = point;
}
function onQuickPickClosed(fieldId: string): void {
  if (activeFieldKey.value === fieldId) activeFieldKey.value = '';
}
function advanceToNextFieldAfterInsert(slotKey: string): void {
  let fields: TemplateField[];
  let prefix: string;
  if (slotKey.startsWith('tgt-')) {
    const tab = activeTab.value;
    if (!tab || tab.kind !== 'table' || !tab.tableId) return;
    fields = fieldsOf(tab.tableId);
    prefix = 'tgt-';
  } else if (slotKey.startsWith('wtgt-')) {
    fields = writeTargetFields.value;
    prefix = 'wtgt-';
  } else {
    return;
  }
  const fieldId = slotKey.slice(prefix.length);
  const idx = fields.findIndex(f => f.field_id === fieldId);
  if (idx < 0) return;
  void nextTick(() => {
    const next = fields[idx + 1];
    if (!next) {
      activeFieldKey.value = '';
      bus.clear();
      return;
    }
    activeFieldKey.value = next.field_id;
    if (lastQuickPickPoint) {
      const step = measureNextRowStep(prefix, fieldId, next.field_id);
      const point = { x: lastQuickPickPoint.x, y: lastQuickPickPoint.y + step };
      lastQuickPickPoint = point;
      exprInputRefs.get(next.field_id)?.activate(point);
    } else {
      exprInputRefs.get(next.field_id)?.activate();
    }
  });
}

// —— 步骤圈内容态着色（404:22903 二轮 R6）：有内容=主色实底白字；无内容=灰底 ——
const sourceHasContent = computed(() => explicitSources.value.length > 0);
const conditionHasContent = computed(
  () => (!!model.value.where && model.value.where.items.length > 0) || !!model.value.where_text_source?.text?.trim()
);
/** 目标步骤有内容：取数模式=已选任一目标（表或图表）；写模式=已选写目标表。 */
const targetHasContent = computed(() => (isWriteMode.value ? writeTargetChosen.value : allTargetTabs.value.length > 0));

// —— ① 目标——
//
// 三个操作共用同一个数据表选择器（SourceTreePicker :single，只列本应用各模板的主表/扩展表），
// 只选目标数据表本身，不选来源别名——update/delete 不再像旧模型那样"目标须在来源段、选其别名"，
// 与 insert 同口径直接给 target_template_id/target_data_table_id/target_table_role。目标模板的
// 配对表按「隐含来源/引用即入源」两档进查询，由 reconcile 的 reconcileWriteTargetSources 收口
// （见该函数头部大注释），本节只负责"选目标"这一步。

// ensureWriteOperation 把 operation 种入模型（后端据此分流写模式编译/校验）；任何写目标改动前调用。
function ensureWriteOperation(m: ExpressionModel) {
  if (isWriteMode.value && m.target.operation !== writeOp.value) m.target.operation = writeOp.value;
}

/** ①段标题（段名按操作，四语，见 locales）：新增目标 / 修改目标 / 删除目标。 */
const writeTargetSegTitleKey = computed(() => `editor.writeTargetSeg_${writeOp.value}`);

// 三操作统一：跨模板选写目标表（复用 SourceTreePicker，single 取首个）。选定后：
//  ① 目标变更（模板或数据表换了）：旧字段映射/防重字段 ID 对新目标表的字段空间无意义，清空重来；
//  ② 预取目标表自身字段 + 目标模板配对表（隐含来源/候选池"另一半"，仅目标是扩展表时存在）的字段——
//    后者若不预取，②面板刚出现的「目标」分组候选/隐含来源行会先顶着空字段列表，直到用户操作别处
//    才凑巧触发别的预取路径而"意外"补齐；
//  ③ 不再自动把目标模板其余表塞进显式来源——
//    隐含来源恒补齐、候选池表按"是否被引用"收口，都交给 reconcileWriteTargetSources，本函数不重复
//    实现这套判断。
async function onSelectWriteTarget(
  items: {
    templateId: string;
    dataTableId: string;
    role: TableRole;
    name?: string;
  }[]
) {
  const it = items[0];
  if (!it) return;
  await ctx.ensureFields(it.templateId, it.dataTableId);
  await ctx.tablesOf(it.templateId).catch(() => []);
  // 目标是扩展表：预取其所属模板主表的字段（隐含来源，恒需要；见 writeTargetSourcePlanFor）。
  if (it.role === 'detail') {
    const mainId = mainTableIdOf(it.templateId);
    if (mainId) await ctx.ensureFields(it.templateId, mainId).catch(() => []);
  }
  update(m => {
    ensureWriteOperation(m);
    const changed = m.target.target_template_id !== it.templateId || m.target.target_data_table_id !== it.dataTableId;
    m.target.target_template_id = it.templateId;
    m.target.target_data_table_id = it.dataTableId;
    m.target.target_table_role = it.role;
    delete m.target.target_alias; // 目标先行：全操作统一按 target_data_table_id 定位，不再用来源别名
    delete m.target.parent; // 父记录锚定撤销（决议 ⑧），编辑器不再提供任何配置入口
    if (changed) {
      m.target.outputs = [];
      delete m.target.dedupe_field_ids;
      delete m.target.dedupe_scope;
    }
  });
}

// 写目标是否扩展表（驱动 dedupe「同父」范围选项等的显示门控）：目标先行后三操作同口径，直接看
// target_table_role（onSelectWriteTarget 已同步写入，无需按操作分两套判据），取不到才回落 tableMeta。
const writeTargetIsDetail = computed<boolean>(() => {
  const tgt = model.value.target;
  if (!tgt.target_data_table_id) return false;
  return (tgt.target_table_role ?? tableMeta(tgt.target_template_id, tgt.target_data_table_id).role) === 'detail';
});

// 写目标记录身份所在来源的别名（供 JoinSettingsPanel 左关联命中写目标风险提示，见其 writeTargetAlias
// 注释）：目标先行后不再有 target_alias 字段，改按「隐含来源」（承载目标记录身份的那张表，见
// writeTargetSourcePlanFor）反查它在 source.tables 里的别名；insert→主表目标无隐含来源，返回
// undefined（该 hint 只在"写目标本身是参与定位查询的一张来源表"时才有意义）。
const writeTargetSourceAlias = computed<string | undefined>(() => {
  if (!isWriteMode.value) return undefined;
  const plan = writeTargetSourcePlanFor(model.value);
  if (!plan.implicitDataTableId) return undefined;
  return model.value.source.tables.find(
    t => t.template_id === model.value.target.target_template_id && t.data_table_id === plan.implicitDataTableId
  )?.alias;
});

// 写目标表字段（映射行 + 防重候选）。
const writeTargetFields = computed<TemplateField[]>(() => fieldsOf(model.value.target.target_data_table_id));
const writeTargetChosen = computed(() => !!model.value.target.target_data_table_id);
function writeTargetLabel(): string {
  const tgt = model.value.target;
  if (!tgt.target_data_table_id) return '';
  return `${templateLabel(tgt.target_template_id)} · ${tableName(tgt.target_data_table_id)}`;
}
/** ①目标段选择器的按钮文案：未选目标时是「选择写目标表」的固定提示
 *  文案；已选目标（含新选与打开存量文档两路——两者都只是 model.target 的同一份字段，本 computed
 *  不区分来源）后回显「模板名 · 表名」，与④取数目标 chip 同款口径（writeTargetLabel 本身已按
 *  templateLabel/tableName 兜底裸 ID——目录未加载时先显示 ID，目录异步到位后随响应式重渲染刷新，
 *  不需要额外的"加载中"过渡态）。SourceTreePicker 本身不持有"当前已选值"的展示语义（它只是一个
 *  "点击发起选择"的按钮+弹窗，见该组件 triggerLabel 注释），故由本文件按选中状态切换按钮文案，
 *  点击行为不变——仍是重新打开同一个 single 选择器（用于更换目标，见 SourceTreePicker single 语义
 *  "已选列表只保留最后一次选择"，天然满足"单选、不可重复"）。 */
const writeTargetTriggerLabel = computed(() => (writeTargetChosen.value ? writeTargetLabel() : t('editor.pickWriteTarget')));

// 写模式字段映射（无 fill_strategy——「查出什么写什么」）。
function writeOutputExprFor(fieldId: string): ValueRef {
  // 只读兜底：同 outputForIn，未配置的字段落「不填充」占位态（const 且 value 缺省）。
  return model.value.target.outputs.find(o => o.target_field_id === fieldId)?.expression ?? { kind: 'const' };
}
/** 写模式「自赋值」兜底提示（用户 09-10 反馈修法，判据见 writeSelfAssignment.ts 头注释）：只在写
 *  模式且已选目标时算，selfRefTextFor 按当前 sourceTablesForInput/formTablesForInput 目录把"目标
 *  字段自己"翻成 brackets 语法下应有的文本，供 raw 表达式全文比对；目录未就位（valueRefToBracketText
 *  返回 undefined）时该字段判据恒 false，不误报。braces 语法下表达式仍是结构化 source_field，走
 *  isWriteSelfAssignmentExpr 的 alias/field_id 直接比对分支，不依赖 selfRefText。 */
const writeSelfAssignmentFields = computed<Set<string>>(() => {
  if (!isWriteMode.value || !model.value.target.target_data_table_id) return new Set();
  const targetAlias = targetSourceAlias(model.value.target.target_data_table_id);
  return writeSelfAssignmentFieldIds(model.value, targetAlias, fieldId =>
    valueRefToBracketText(
      { kind: 'source_field', alias: targetAlias, field_id: fieldId },
      sourceTablesForInput.value,
      formTablesForInput.value,
      systemVariablesCatalog.value,
      { systemVariableToken }
    )
  );
});
function setWriteOutputExpr(fieldId: string, v: ValueRef | null) {
  const picked = pickedRefForSyntax(v, refSyntax, sourceTablesForInput.value, formTablesForInput.value, systemVariablesCatalog.value, { systemVariableToken });
  update(m => {
    ensureWriteOperation(m);
    let o = m.target.outputs.find(x => x.target_field_id === fieldId);
    if (!o) {
      o = {
        target_field_id: fieldId,
        // 同 setOutputExprIn：v===null（✕ 清除）落回「不填充」占位态，不兜底成空串常量（三态口径同上）。
        expression: picked ?? { kind: 'const' }
      };
      m.target.outputs.push(o);
    } else {
      o.expression = picked ?? { kind: 'const' };
    }
    // 写模式输出不携带回填策略/分隔符（后端写校验拒绝非空 fill_strategy）。
    delete o.fill_strategy;
    delete o.separator;
  });
  // 「插完跳下一行」：判据看**转换前**的 v（同 setOutputExprIn 注释，brackets 下 picked 已是 raw，
  // 用它判会让联动整个失效）。
  if (v && (v.kind === 'source_field' || v.kind === 'system_var')) {
    advanceToNextFieldAfterInsert(`wtgt-${fieldId}`);
  }
}


const dedupeCandidateFields = computed<TemplateField[]>(() => {
  const tableId = model.value.target.target_data_table_id;
  if (!tableId) return [];
  return writeTargetFields.value.filter(f => isFieldConfigured(tableId, f.field_id) && !isAttachmentFieldDataType(f.data_type));
});
const dedupeFieldIds = computed(() => model.value.target.dedupe_field_ids ?? []);
/** chip 点选：不在键里则加入，已在则移出（点选即切换，不经下拉多选）。 */
function toggleDedupeField(fieldId: string) {
  const ids = dedupeFieldIds.value;
  setDedupeFields(ids.includes(fieldId) ? ids.filter(id => id !== fieldId) : [...ids, fieldId]);
}
const pendingDedupeScope = ref<'all' | 'parent'>('all');
/** 未选键时读暂存值、已选键时读模型值——两种来源统一成一个展示/设置口径供单选组消费。 */
const dedupeScope = computed<'all' | 'parent'>(() =>
  dedupeFieldIds.value.length ? (model.value.target.dedupe_scope ?? 'all') : pendingDedupeScope.value
);
function setDedupeScope(s: 'all' | 'parent') {
  if (!dedupeFieldIds.value.length) {
    // 未选键：dedupe_scope 不落模型，只更新本地暂存。
    pendingDedupeScope.value = s;
    return;
  }
  update(m => {
    ensureWriteOperation(m);
    m.target.dedupe_scope = s;
  });
}
function setDedupeFields(ids: string[]) {
  const hadNoKeysBefore = dedupeFieldIds.value.length === 0;
  if (!ids.length) {
    // 键清空前把当前 scope（可能来自模型，也可能仍是暂存值）落回暂存，避免范围行显示值回跳默认「全表」。
    pendingDedupeScope.value = dedupeScope.value;
  }
  update(m => {
    ensureWriteOperation(m);
    if (ids.length) {
      m.target.dedupe_field_ids = ids;
      // 只在「从 0 个键变为 ≥1 个」这一刻补写 scope；已有键时模型里的 scope 已存在，不重复覆盖。
      if (hadNoKeysBefore) m.target.dedupe_scope = pendingDedupeScope.value;
    } else {
      delete m.target.dedupe_field_ids;
      delete m.target.dedupe_scope;
    }
  });
}
// 字段表达式被清空后自动从防重键里摘除（联动①，不必等到 finalize 才收口——chip 应立即消失，
// 不该继续显示一个"选中但候选已消失"的悬空态）；buildFinalizedModel 里的同款剔除逻辑保留不动，
// 作为收口兜底（例如存量文档载入时键先于候选到位的时序）。
watch(dedupeCandidateFields, fields => {
  const ids = dedupeFieldIds.value;
  if (!ids.length) return;
  // 🔴 目标表字段目录尚未到位时不摘键：dedupeCandidateFields
  // 依赖 writeTargetFields（异步 ensureFields 的结果），打开存量节点的头几个 tick 里它恒是空数组，
  // 此时按"候选里没有"摘键会把文档里已存的防重键当场清空——用户重开节点看到 chip 全不选中，什么
  // 都不改再点保存就把库里的 dedupe 段一起删掉。
  // 判据取"字段目录本身是否为空"而不是"候选是否为空"：目录已到位而候选为空，才是真的"所有字段都
  // 没填表达式"，那种情形照旧摘键；目录为空一律按未就绪跳过，收口时 buildFinalizedModel 的同款
  // 剔除逻辑仍会兜底。
  if (!writeTargetFields.value.length) return;
  const keep = new Set(fields.map(f => f.field_id));
  const next = ids.filter(id => keep.has(id));
  if (next.length !== ids.length) setDedupeFields(next);
});
// 联动②：目标从扩展表换成主表后，「同一父记录内」范围选项随之隐藏——已选的 scope=parent 须回落
// 全表，避免出现"看不到的单选项却仍生效"的悬空配置。（换目标表本身已在 onSelectWriteTarget 里
// 整体清空 dedupe_field_ids/dedupe_scope，这里补的是"表没换、但角色判定变化"的边界情形。）
watch(writeTargetIsDetail, isDetail => {
  if (!isDetail && dedupeScope.value === 'parent') setDedupeScope('all');
});
type SyntaxCheckState = 'pending' | 'checking' | 'valid' | 'invalid';
/** 'pending'＝静默等待期（灰，用户可能仍在操作，从不因此弹错/标红）；'checking'＝已静默满 1.5s，
 *  正在等待宿主编译结果（蓝）；'valid'＝✓ 编译通过；'invalid'＝✗ 编译失败（含请求异常），
 *  syntaxCheckError 携带错误文案，此时下方 watch 会把「确定」禁用信号上抛给宿主壳。 */
const syntaxCheckState = ref<SyntaxCheckState>('pending');
const syntaxCheckError = ref('');
let syntaxDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// 请求序号：每次真正发起编译请求自增；异步响应落地前核对序号是否仍是"最新一次"，防止"旧请求后到"
// 用过期结果覆盖新结果（用户在旧请求飞行途中又编辑了模型，新一轮检查已经发出并可能先返回）。
let syntaxCheckSeq = 0;

function clearSyntaxDebounceTimer(): void {
  if (syntaxDebounceTimer !== null) {
    clearTimeout(syntaxDebounceTimer);
    syntaxDebounceTimer = null;
  }
}

// 回归修复：防抖到点后此前无条件发起编译，"新建条件"打开时模型是
// emptyExpressionModel() 空骨架、"清空已有条件"后模型同样退化为空——这两种情形送编译必然因"无来源/
// 无输出"被后端判失败，进而经下方 update:validity 把宿主壳「确定」按钮锁死，用户从此存不了"无条件"
// 这一合法终态。故补一道"模型是否为空"判定，为空则直接短路成通过态、不发编译请求。
/** 模型是否为空（判据**优先复用**步骤圈"有内容"高亮的既有 computed：sourceHasContent /
 *  conditionHasContent / targetHasContent，定义见 1051 行附近，不另立一套"空"的定义）。
 *  空＝用户还没配 / 主动清空——两者都是合法终态，不该被编译器判死：
 *  - "还没配"：新建条件/新建取数公式时打开编辑器，模型是 emptyExpressionModel() 的初始骨架；
 *  - "主动清空"：用户把已配置的条件（或来源/目标）删空，在流程分支条件里这就是合法的"无条件"态
 *    （插件侧按 where/where_expr 有无判"已设置/未设置"两态，见任务背景）。
 *
 *  🔴 judge 模式与取数模式的"空"判据不同，分别处理：
 *  - judge 模式（props.hideTargetSection 为真）：UI 只呈现③条件段（①来源/④目标段整段隐藏），
 *    故空与否只看条件段——conditionHasContent 为否即为空。
 *  - 取数模式（含写模式，hideTargetSection 为假）：①来源/③条件/④目标三段都会呈现，**任一段已有
 *    内容就不算空**——哪怕另外两段还没配，那也是"正在配置中"的中间态，应放行给真实编译去判定是否
 *    已够格通过；不能笼统当空跳过，否则会把"配了来源但还没配目标"这类本该被拦下的半成品也放行，
 *    等同放宽整个校验闸门（本项目有"闸门空转"的历史教训）。 */
const isModelEmpty = computed(() =>
  props.hideTargetSection
    ? !conditionHasContent.value
    : !sourceHasContent.value && !conditionHasContent.value && !targetHasContent.value
);

/** 真正触发一次服务端编译预览（防抖计时器到点后调用）。编译逻辑原样沿用原 runPreview
 *（P1 起就是 host.compilePreview + Phase B 暂存 schema 透传），只是去掉了原先"手动点按钮"用的
 *  message 提示——自动触发不该弹 toast 打断用户。 */
async function runPreview(): Promise<void> {
  const seq = ++syntaxCheckSeq;
  // 空模型短路（见 isModelEmpty 注释）：跳过本轮网络请求，直接判通过。序号已在上一行自增，任何仍在
  // 飞行中的旧编译请求（针对清空前的非空模型发出）落地时都会因序号不匹配被判定为"过期"而不落地——
  // 保证"从 invalid 态清空后能回到可确定"，不会被迟到的旧错误结果打回 invalid。
  if (isModelEmpty.value) {
    syntaxCheckState.value = 'valid';
    syntaxCheckError.value = '';
    return;
  }
  syntaxCheckState.value = 'checking';
  try {
    const stagingSchema = props.stagingSource?.columns.map(c => ({
      name: c.code,
      field_id: c.code,
      kind: c.type ?? 'text'
    }));
    const data = await host.compilePreview(props.templateId, buildFinalizedModel(), stagingSchema);
    if (seq !== syntaxCheckSeq) return; // 已过期：更新的一轮检查已发出，本次结果作废，不落地
    if (!data) {
      syntaxCheckState.value = 'invalid';
      syntaxCheckError.value = t('common.noResponse');
      return;
    }
    if (data.valid) {
      syntaxCheckState.value = 'valid';
      syntaxCheckError.value = '';
    } else {
      syntaxCheckState.value = 'invalid';
      syntaxCheckError.value = data.error ?? t('editor.previewFailed');
    }
  } catch (e) {
    if (seq !== syntaxCheckSeq) return; // 同上：过期请求的异常也不落地
    syntaxCheckState.value = 'invalid';
    syntaxCheckError.value = e instanceof Error ? e.message : t('common.requestFailed');
  }
}

// 监听模型任意变化（deep）：立即转「输入中」并重置 1.5s 静默计时器；immediate:true 让编辑器一打开
// （含加载既有表达式）也走一次检查，「确定」按钮从一开始就反映真实可编译性，而非"没编辑过就恒可确定"。
watch(
  model,
  () => {
    syntaxCheckState.value = 'pending';
    clearSyntaxDebounceTimer();
    syntaxDebounceTimer = setTimeout(() => {
      syntaxDebounceTimer = null;
      void runPreview();
    }, 1500);
  },
  { deep: true, immediate: true }
);

onBeforeUnmount(() => {
  // 组件卸载/弹窗关闭：必须清掉未触发的防抖计时器——否则计时器到点后会对已卸载组件的响应式状态
  // 赋值（Vue 不报错，但纯属僵尸副作用，且会发起一次注定被丢弃的网络请求）。
  clearSyntaxDebounceTimer();
  // 让任何仍在飞行中的 compilePreview 请求响应到达时，因序号不再匹配而被判定为"过期"——双保险：
  // 即便 clearTimeout 之外已有请求发出且尚未 resolve，也不会在组件卸载后写状态。
  syntaxCheckSeq += 1;
});

/** 页脚三态标签。 */
const syntaxCheckLabel = computed(() => {
  switch (syntaxCheckState.value) {
    case 'pending':
      return t('editor.syntaxCheckPending');
    case 'checking':
      return t('editor.syntaxCheckChecking');
    case 'valid':
      return t('editor.syntaxCheckValid');
    case 'invalid':
      return t('editor.syntaxCheckInvalid');
    default:
      return '';
  }
});
/** F3：校验条错误详情的友好文案（原串经 errorMessages.ts 模式表本地化，未命中原样透传）。
 *  单行合并渲染（见模板 syntax-check-bar）与 title 悬浮全文共用同一份计算结果。 */
const syntaxCheckFriendlyError = computed(() => friendlyErrorMessage(syntaxCheckError.value, t));


/** 合并后的逐条明细：宿主通知在前（保持宿主顺序，完全相同的重复上报只留一条），本地判定追加在末尾。 */
const statusNotices = computed<ExpressionNotice[]>(() => {
  const items: ExpressionNotice[] = [];
  const seen = new Set<string>();
  for (const n of props.notices ?? []) {
    if (!n || !n.message) continue;
    const key = `${n.severity}|${n.where ?? ''}|${n.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ severity: n.severity, message: n.message, where: n.where });
  }
  if (syntaxCheckState.value === 'invalid') {
    items.push({ severity: 'error', where: t('editor.noticeWhereSyntax'), message: syntaxCheckFriendlyError.value });
  }
  return items;
});
const statusCounts = computed(() => {
  const c = { error: 0, warning: 0, info: 0 };
  for (const n of statusNotices.value) c[n.severity] += 1;
  return c;
});
/** 状态条档位（决定 sc-* 着色类）：有错误 → invalid；无错误有警告 → warning；否则跟随语法三态。 */
const statusSeverity = computed<'invalid' | 'warning' | SyntaxCheckState>(() => {
  if (statusCounts.value.error > 0) return 'invalid';
  if (statusCounts.value.warning > 0) return 'warning';
  return syntaxCheckState.value;
});
/** 首条明细：按错误 > 警告 > 提示取第一条，出处与文案用全角冒号拼接。 */
const statusFirstNotice = computed<ExpressionNotice | undefined>(() => {
  const order: ExpressionNotice['severity'][] = ['error', 'warning', 'info'];
  for (const sev of order) {
    const hit = statusNotices.value.find(n => n.severity === sev);
    if (hit) return hit;
  }
  return undefined;
});
function noticeLine(n: ExpressionNotice): string {
  return n.where ? `${n.where}：${n.message}` : n.message;
}
/** 单行 label 文案：状态词 · 计数（总数 > 1 时按级别列出） · 首条明细。 */
const statusLabel = computed(() => {
  const parts: string[] = [];
  switch (statusSeverity.value) {
    case 'invalid':
      parts.push(`✗ ${t('editor.validationFailedMsg')}`);
      break;
    case 'warning':
      parts.push(`⚠ ${t('editor.statusWarning')}`);
      break;
    default:
      parts.push(syntaxCheckLabel.value);
  }
  const total = statusNotices.value.length;
  if (total > 1) {
    if (statusCounts.value.error) parts.push(`${t('editor.noticeErrors')} ${statusCounts.value.error}`);
    if (statusCounts.value.warning) parts.push(`${t('editor.noticeWarnings')} ${statusCounts.value.warning}`);
    if (statusCounts.value.info) parts.push(`${t('editor.noticeInfos')} ${statusCounts.value.info}`);
  }
  if (statusFirstNotice.value) parts.push(noticeLine(statusFirstNotice.value));
  return parts.join(' · ');
});
/** title 悬浮全文：逐条一行，供不想点开 popover 的用户直接看全。 */
const statusTitle = computed(() => statusNotices.value.map(noticeLine).join('\n'));

const validityOk = computed(() => syntaxCheckState.value !== 'invalid' && (props.lockSources || unlinkedAliases.value.length === 0));
// immediate:true 使初始态也上抛一次（不提前锁定确定按钮）。
watch(validityOk, v => emit('update:validity', v), { immediate: true });
</script>

<template>
  <div class="expr-editor" :class="{ 'expr-editor--readonly': readonly }">
    <!-- P6c 只读横幅：引用了无设计权限跨应用来源时由调用方算出 readonly=true 传入，编辑器整体只读并
         在顶部提示——文案复用 errMsg.forbiddenSourceApp（与保存被拒时 errorMessages.ts 映射表的同一个
         i18n key，同一措辞，不新造重复串），四语言已在包内 locales 登记。 -->
    <NAlert
      v-if="readonly"
      type="warning"
      :bordered="false"
      :show-icon="true"
      class="readonly-banner"
      data-testid="expr-readonly-banner"
    >
      {{ t('errMsg.forbiddenSourceApp') }}
    </NAlert>
    <!-- 数据流左右分栏改版：外层横向滚动包裹层（本体 min-width:900px，窄容器时横向滚动，不裁切/不重排）。 -->
    <div class="qb-scroll-x">
      <!-- judge 形态只有左栏（min 640 即可），900 下限只属于左右分栏的 output/写模式——
           否则 judge 弹窗（Host 默认 760 宽）会恒带横向滚动条。
           用户 09-10 二轮反馈改判：写模式删除操作右栏改放③定位条件（不再是空右栏，见下方
           qb-condition-panel 在 qb-right 内的分支），故 judge 单栏铺满不再包含 delete——只剩
           hideTargetSection（judge 形态本身）这一档。 -->
      <div class="qb-layout" :class="{ 'qb-layout-judge': hideTargetSection && !hasCustomTarget }">
        <!-- 左栏（约 38% 宽）：①目标（写模式）+②来源表 +（insert/update：③筛选条件；delete：③定位条件
             改放右栏，见下方 qb-right），纵向排列、各自区内滚动。judge 形态（右栏不渲染）横向铺满。 -->
        <div class="qb-left" data-testid="qb-left" :class="{ 'qb-left-full': hideTargetSection && !hasCustomTarget }">
          <!-- ①目标段：整段只有一个
               数据表选择器（三操作同一个 SourceTreePicker :single，复用原 insert 实现），不放任何说明
               文字/chip/提示条（用户明确要求）；段头不再挂操作类型徽标（段名已含操作）。选中后目标模板
               配对表按隐含来源/引用即入源两档进下方②来源面板，见 reconcileWriteTargetSources。
               用户 09-10 反馈：目标段与来源段上下同宽，右栏留给填充——改判为左栏第一个子段，与
               ②来源/③定位条件同宽、纵向排列（此前独立置于左右分栏之上、横跨整宽，视觉上与
               「填充字段」争右侧空间的诉求相悖）。 -->
          <section v-if="isWriteMode" class="qb-panel qb-write-target-panel" data-testid="qb-write-target-panel">
            <div class="seg-title">
              <span class="seg-n" :class="{ 'seg-n-empty': !writeTargetChosen }">{{ segNo(1) }}</span>
              {{ t(writeTargetSegTitleKey) }}
            </div>
            <div class="qb-panel-body write-target-pick">
              <SourceTreePicker
                :current-template-id="templateId"
                :tables-of="ctx.tablesOf"
                :single="true"
                :trigger-label="writeTargetTriggerLabel"
                :disabled="readonly"
                @select="onSelectWriteTarget"
              />
            </div>
          </section>
          <!-- 左栏顶部插槽 left-top：写模式①目标段之后、来源段之前，
               供调用方（如视图设计器）插入自定义内容（如"数据源"选择区）。按内容自然高度撑开
               （flex:0 0 auto，同上方 .qb-write-target-panel 手法），不参与①②面板 2:3 比例分配。
               无插槽内容时不渲染本容器，DOM 与改动前逐字一致。 -->
          <div v-if="hasLeftTop" class="qb-left-top-slot" data-testid="qb-left-top-slot">
            <slot name="left-top" />
          </div>
          <!-- ①来源表面板：头部=序号①+标题+右侧「⋈ 表关联」入口（存在未关联来源时旁挂橙色计数）+「＋添加」；
               列表=每来源一行（别名徽标+表名+模板名·字段数灰字+行尾关联状态徽标+×移除）。 -->
          <section class="qb-panel qb-source-panel" data-testid="qb-source-panel">
            <div class="seg-title">
              <!-- 写模式段序前移一位（①目标段已独立置顶，见上方新增段落）：来源段序号 1→2。 -->
              <span class="seg-n" :class="{ 'seg-n-empty': !sourceHasContent }">{{ segNo(isWriteMode ? 2 : 1) }}</span>
              {{ t('qb.sourcePanelTitle') }}
              <div class="seg-actions">
                <!-- 「⋈ 表关联」入口（到达路径①）：无显式来源时隐藏——单表/无表不存在"关联"语义。
                     存在未关联来源时旁挂橙色计数，点击同样打开设计器。
                     2026-08-15 追加：lockSources 态整体隐藏——锁定来源面下不允许再新建关联。 -->
                <button
                  v-if="!lockSources && explicitSources.length > 0"
                  type="button"
                  class="qb-join-entry"
                  data-testid="qb-join-entry"
                  :disabled="readonly"
                  @click="openJoinDesigner"
                >
                  <span>⋈ {{ t('editor.joinLabel') }}{{ manualJoinCount ? ` · ${manualJoinCount}` : '' }}</span>
                  <span v-if="unlinkedAliases.length > 0" class="qb-join-entry-warn">{{ unlinkedAliases.length }}</span>
                </button>
                <!-- views-extraction-b3 R2：取数来源段此前缺省放开视图叶子。
                     🔴 2026-09-12 改判：缺省收紧为仅 table——V4 适配层会把选到的视图伪装成
                     空 ID 数据表，保存时报「数据表不存在」；以后哪个调用方确实要放开视图，显式传
                     sourcePickerOptions.selectableKinds 打开（写目标段的 picker 仍不放开，另一处
                     :single picker 不受本行影响）。 -->
                <!-- 跨应用取数：来源添加器放开其他应用的数据表（仅读来源；写目标选择器不放开） -->
                <!-- 2026-08-15 追加：lockSources 态整体隐藏「＋添加来源」入口——存量来源仍展示
                     在下方列表，只是不能再新增。 -->
                <SourceTreePicker
                  v-if="!lockSources"
                  :current-template-id="templateId"
                  :tables-of="ctx.tablesOf"
                  :selectable-kinds="sourcePickerOptions?.selectableKinds ?? ['table']"
                  :allow-cross-app="sourcePickerOptions?.allowCrossApp ?? true"
                  :disabled-views="sourcePickerOptions?.disabledViews"
                  :staging-source="stagingSource"
                  :has-staging-source="modelHasStagingSource"
                  :disabled="readonly"
                  :disabled-table-ids="writeTargetDisabledTableIds"
                  :disabled-table-title="isWriteMode ? t('picker.disabledWriteTarget') : undefined"
                  @select="onSelectSources"
                />
              </div>
            </div>
            <div class="qb-panel-body">
              <!-- 空态提示：无显式来源时一句灰字说明（⋈ 入口已在上方按同一条件隐藏）。
                   hideImplicitMain 场景换用无「本报表」语义的文案（表格编辑器控件取数：空来源=配置不完整）。 -->
              <div v-if="explicitSources.length === 0" class="qb-src-empty-hint">
                {{ t(hideImplicitMain ? 'editor.addSourceEmptyNoImplicit' : 'editor.addSourceEmpty') }}
              </div>
              <div
                v-for="src in explicitSources"
                :key="src.alias"
                class="qb-src-row"
                :class="{ 'qb-src-row-write-target': isWriteTargetTable(src) }"
                :data-source-alias="src.alias"
                :data-source-kind="src.source_type"
                :data-template-id="src.template_id || undefined"
                :data-table-id="src.data_table_id || undefined"
                :data-table-role="src.role"
                :data-write-target="isWriteTargetTable(src) || undefined"
              >
                <!-- F1①：删除行首别名徽标（t1/t2 等 chip）——仅 UI 移除，模型 alias/rawSerialize 引用层不动。 -->
                <!-- 表主题色圆点（2026-09-02 草案）：按别名序号取色，与字段树坞/快捷选择器/表达式 token 同色。
                     写模式「目标」相关来源（is_write_target，虚线样式见 .qb-src-row-write-target）
                     沿用同一套按别名取色规则，不另起色板。 -->
                <span class="ttc-dot qb-src-dot" :class="tableColorClassFor(src.alias, explicitSources)" aria-hidden="true" />
                <span class="qb-src-name" :title="sourceDisplayName(src)">{{ sourceDisplayName(src) }}</span>
                <span v-if="src.source_type === 'view'" class="qb-src-type-badge" data-testid="qb-src-view-type">{{
                  viewTypeLabel(src)
                }}</span>
                <!-- F1②③：副文案「模板名 - 应用名」/视图「N 列」，任一段未加载到时 srcMetaText 返回空串，v-if 连同分隔符一并不渲染。 -->
                <span v-if="srcMetaText(src)" class="qb-src-meta" :title="srcMetaText(src)">{{ srcMetaText(src) }}</span>
                <span class="qb-src-spacer" />
                <!-- 关联状态徽标三态：auto（record_id 自动联合）不标；manual 绿「已关联」；unlinked 橙「未关联」
                     （可点，直开关联设计器，到达路径②）。
                     2026-08-15 追加：lockSources 态整体隐藏——锁定来源面下点开也建不了/改不了关联，
                     徽标继续显示只会误导用户以为还能操作。 -->
                <span
                  v-if="!lockSources && joinStatusOf(src.alias) === 'manual'"
                  class="qb-join-badge qb-join-badge-linked"
                  role="button"
                  tabindex="0"
                  @click.stop="openJoinDesigner"
                >
                  ⋈ {{ t('qb.joinLinked') }}
                </span>
                <span
                  v-else-if="!lockSources && (!hideImplicitMain || explicitSources.length > 1) && joinStatusOf(src.alias) === 'unlinked'"
                  class="qb-join-badge qb-join-badge-unlinked"
                  role="button"
                  tabindex="0"
                  @click.stop="openJoinDesigner"
                >
                  {{ t('qb.joinUnlinked') }}
                </span>
                <!-- 写模式「目标」相关来源（is_write_target）恒不可删——隐含来源点了 reconcile 立刻
                     补回来；「引用即入源」候选只要字段赋值/定位条件里还引用着它，也会立刻补回来；
                     两者都不渲染删除按钮，不留一个"点了没用"的假入口。用户要移除，改字段赋值/条件里
                     的引用即可（不再引用后，reconcile 下一轮就不会再把候选补进来）。 -->
                <button
                  v-if="!isWriteTargetTable(src)"
                  type="button"
                  class="qb-src-remove"
                  :aria-label="t('common.delete')"
                  :disabled="readonly"
                  @click.stop="removeSourceTable(src.alias)"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          </section>

          <section v-if="writeOp !== 'delete'" class="qb-panel qb-condition-panel" data-testid="qb-condition-panel">
            <div class="seg-title">
              <!-- 写模式段序前移一位（同上）：筛选/定位条件段序号 2→3。 -->
              <span class="seg-n" :class="{ 'seg-n-empty': !conditionHasContent }">{{ segNo(isWriteMode ? 3 : 2) }}</span>
              {{ t('qb.conditionPanelTitle') }}
            </div>
            <div
              class="qb-panel-body qb-condition-view"
              data-testid="qb-condition-view"
              role="button"
              tabindex="0"
              @click="openConditionDialog"
            >
              <template v-if="conditionHasContent">
                <ConditionReadonlyView
                  v-if="!model.where_text_source"
                  :group="whereGroup"
                  :source-tables="sourceTablesForInput"
                  :form-tables="formTablesForInput"
                />
                <div v-else class="qb-condition-expr-view">
                  <!-- tableClass：来源表字段的表主题色 tint（2026-09-02 草案），空串时按既有语义色。 -->
                  <span
                    v-for="(seg, i) in whereExprDisplaySegments()"
                    :key="i"
                    class="tok"
                    :class="[`tok-${seg.kind}`, seg.tableClass || null]"
                  >
                    {{ seg.text }}
                  </span>
                </div>
              </template>
              <div v-else class="qb-condition-empty">
                {{ t('qb.conditionEmptyHint') }}
              </div>
            </div>
          </section>

        </div>

        <div v-if="hasCustomTarget" class="qb-right">
          <slot name="target-panel" />
        </div>
        <div v-else-if="!hideTargetSection" class="qb-right">
          <!-- ③ 目标（取数回填模式）——404:22903 二轮：单目标 → 「数据表+图表」多选 + tabs（每个已选目标一个 tab）。 -->
          <section v-if="!isWriteMode" class="seg seg-grow">
            <div class="seg-title">
              <span class="seg-n" :class="{ 'seg-n-empty': !targetHasContent }">{{ segNo(3) }}</span>
              {{ t('editor.segTarget') }}
            </div>
            <!-- max-tag-count="responsive"：多选时选择框**恒为一行**，装不下的收成「+N」计数标签
                 （此前会随选中数向下堆叠撑高，把下方目标 tabs 和字段行整体顶下去）。
                 收起的具体项仍可在下拉里看到/取消，信息不丢。 -->
            <NSelect
              data-testid="expression-targets"
              class="target-select"
              size="small"
              multiple
              filterable
              max-tag-count="responsive"
              :disabled="readonly"
              :loading="chartCatalogLoading"
              :placeholder="t('editor.selectTargetTable')"
              :options="targetMultiSelectOptions"
              :value="targetSelectValue"
              :show="targetSelectShow"
              @update:show="v => (targetSelectShow = v)"
              @update:value="onUpdateTargetSelectionAndClose"
            />
            <NEmpty v-if="allTargetTabs.length === 0" size="small" :description="t('editor.selectTargetTableFirst')" />
            <template v-else>
              <!-- 目标 tabs（同引导式页签风格：active 蓝字 + 2px 短下划线）。增删由上方多选控件负责，tab 本身无 ×
                   「自动匹配」只在表 tab 激活时可用。 -->
              <div class="target-tabs">
                <button
                  v-for="tab in allTargetTabs"
                  :key="tab.key"
                  type="button"
                  class="target-tab"
                  :class="{ active: activeTargetKey === tab.key }"
                  @click="activeTargetKey = tab.key"
                >
                  {{ tab.label }}
                </button>
                <div class="target-tab-actions">
                  <!-- 目标级填充设置（UI 反馈 2026-09-07 ⑥）：自动按行列匹配 / 执行后清理空行 / 清空方式 / 清除时机
                       不再平铺在 tab 栏，改为「设置」按钮 + popover 内带 label 的设置项（同动作设计器右上角
                       「选项」的交互）；「按名称填充」是动作不是设置，仍留在栏上。图表/暂存 tab 与写模式不显示。
                       各控件的 data-testid 原样保留（既有用例按它们定位）。 -->
                  <NPopover
                    v-if="activeTab?.kind === 'table' && activeTableId && !isWriteMode"
                    trigger="click"
                    placement="bottom-end"
                    :show-arrow="false"
                  >
                    <template #trigger>
                      <NButton size="tiny" quaternary class="target-settings-btn" data-testid="target-settings-btn" :title="t('editor.targetSettingsTitle')">
                        ⚙ {{ t('editor.targetSettings') }}
                      </NButton>
                    </template>
                    <div class="target-settings-pop" data-testid="target-settings-pop">
                      <div class="tsp-title">{{ t('editor.targetSettingsTitle') }}</div>
                      <!-- 布局（用户 2026-09-07 二轮）：两列网格——label 列自适应、控件列定宽，开关靠右、下拉/数字框撑满控件列，
                           行高一致；按「填充与清空」「查询结果」两组分节，组名小字提示色。 -->
                      <div class="tsp-group">{{ t('editor.targetSettingsGroupFill') }}</div>
                      <!-- 自动按行列匹配：仅明细目标。3.4：开=从筛选条件抽键、关=手动；
                           V4：开=服务端展开期把筛选里「来源字段 = 本报表明细字段」等式作为该字段的
                           匹配键（等式保留、配置不改写），缺省即开，关=不推导；手动「按行列匹配」
                           在 V4 下恒可选。 -->
                      <div
                        v-if="targetRoleOf(activeTableId) !== 'main'"
                        class="tsp-row target-auto-row-match"
                        data-testid="target-auto-row-match"
                        :title="isV4RefSyntax ? t('editor.autoRowMatchV4Hint') : t('editor.autoRowMatchTitle')"
                      >
                        <span class="tsp-label tarm-label">{{ t('editor.autoRowMatch') }}</span>
                        <NSwitch
                          size="small"
                          :disabled="readonly"
                          :value="autoRowMatchOf(activeTableId)"
                          @update:value="v => setAutoRowMatchIn(activeTableId, v)"
                        />
                      </div>
                      <!-- 执行后清理空行：同为目标级、仅明细（主表只有 main:0 一行，没有「多余空行」这回事，
                           后端 extractdoc 校验同样只放行 detail）。 -->
                      <div
                        v-if="targetRoleOf(activeTableId) !== 'main'"
                        class="tsp-row target-auto-row-match"
                        data-testid="target-trim-empty-rows"
                        :title="t('editor.trimEmptyRowsAfterFillTitle')"
                      >
                        <span class="tsp-label tarm-label">{{ t('editor.trimEmptyRowsAfterFill') }}</span>
                        <NSwitch
                          size="small"
                          :disabled="readonly"
                          :value="trimEmptyRowsAfterFillOf(activeTableId)"
                          @update:value="v => setTrimEmptyRowsAfterFillIn(activeTableId, v)"
                        />
                      </div>
                      <div class="tsp-row tsp-row-radio" :title="t('editor.clearModeTitle')">
                        <span class="tsp-label">{{ t('editor.clearModeLabel') }}</span>
                        <NRadioGroup
                          class="target-clear-mode-radio"
                          data-testid="target-clear-mode-select"
                          size="small"
                          :disabled="readonly"
                          :value="clearModeOf(activeTableId)"
                          @update:value="v => setClearModeIn(activeTableId, v)"
                        >
                          <NRadio v-for="opt in clearModeOptionsFor(activeTableId)" :key="opt.value" :value="opt.value">{{ opt.label }}</NRadio>
                        </NRadioGroup>
                      </div>
                      <div class="tsp-row tsp-row-radio" :title="t('editor.clearTimingTitle')">
                        <span class="tsp-label">{{ t('editor.clearTimingLabel') }}</span>
                        <NRadioGroup
                          class="target-clear-timing-radio"
                          data-testid="target-clear-timing-select"
                          size="small"
                          :disabled="readonly || clearModeOf(activeTableId) === 'none'"
                          :value="clearTimingOf(activeTableId)"
                          @update:value="v => setClearTimingIn(activeTableId, v)"
                        >
                          <NRadio v-for="opt in clearTimingOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</NRadio>
                        </NRadioGroup>
                      </div>
                      <!-- 逐目标查询选项：「排除重复」「仅限前 N 条」从动作设计器「选项」浮层
                           （查询级、全目标统一）拆到这里逐目标独立设置——V4 展开时每个目标各自一份引擎定义，SELECT DISTINCT / TOP N
                           按本目标输出列各自生效。排除重复缺省开；前 N 条可 −/＋ 步进也可手输，清空=不限。仅 V4 取数显示（3.4 的
                           去重/限量仍在顶层 distinct/limit，由其宿主浮层配置）。 -->
                      <template v-if="isV4RefSyntax">
                        <div class="tsp-group">{{ t('editor.targetSettingsGroupQuery') }}</div>
                        <div class="tsp-row" data-testid="target-distinct" :title="t('editor.targetDistinctTitle')">
                          <span class="tsp-label">{{ t('editor.targetDistinct') }}</span>
                          <NSwitch size="small" :disabled="readonly" :value="distinctOf(activeTableId)" @update:value="v => setDistinctIn(activeTableId, v)" />
                        </div>
                        <div class="tsp-row" data-testid="target-take" :title="t('editor.targetTakeTitle')">
                          <span class="tsp-label">{{ t('editor.targetTake') }}</span>
                          <NInputNumber
                            class="target-take-input"
                            size="small"
                            :disabled="readonly"
                            :min="1"
                            :precision="0"
                            :step="1"
                            clearable
                            button-placement="both"
                            :placeholder="t('editor.takeUnlimited')"
                            :value="takeOf(activeTableId)"
                            @update:value="v => setTakeIn(activeTableId, v)"
                          />
                        </div>
                      </template>
</div>
                  </NPopover>
                  <NButton
                    size="tiny"
                    quaternary
                    class="auto-match-btn"
                    :disabled="readonly || tableTargets.length === 0 || activeTab?.kind !== 'table'"
                    @click="autoMatchFields(activeTableId)"
                  >
                    {{ t('editor.autoMatchFields') }}
                  </NButton>
                </div>
              </div>
              <div class="target-tab-body">
                <!-- 表 tab：字段绑定行列表（原单目标 UI 原样保留，函数改按 tableId 参数化）。行点击行为
                     改为打开该行 ⊞ 快捷选择器（prefer-quick-pick + onTargetRowClick 改调 activate() 无参数，
                     见 script 头注释）——「插完跳下一行」机制保留（advanceToNextFieldAfterInsert 改由
                     setOutputExprIn 依"新值是原子拾取"触发）。 -->
                <template v-if="activeTab?.kind === 'table' && activeTableId">
                  <div class="wt-hint native-text-hint" data-testid="order-native-text-hint">
                    {{ t('editor.nativeTextSemanticsHint') }}
                  </div>
                  <div class="target-rows">
                    <div
                      v-for="f in fieldsOf(activeTableId)"
                      :key="f.field_id"
                      class="target-row"
                      :data-testid="`expression-target-row-${f.field_id}`"
                      :data-target-table-id="activeTableId"
                      :data-field-id="f.field_id"
                      :class="{
                        filled: isFieldConfigured(activeTableId, f.field_id),
                        'row-active': activeFieldKey === f.field_id
                      }"
                      @click="onTargetRowClick(f.field_id, $event)"
                    >
                      <span
                        class="tc-name"
                        :title="isAttachmentFieldDataType(f.data_type) ? t('editor.attachmentTargetHint') : undefined"
                        :data-testid="isAttachmentFieldDataType(f.data_type) ? `target-attachment-hint-${f.field_id}` : undefined"
                      ><FieldTypeIcon class="tc-type-icon" :data-type="f.data_type" />{{ f.field_name }}</span>
                      <ExpressionInput
                        :ref="el => setExprInputRef(f.field_id, el)"
                        class="tc-expr"
                        :model-value="outputForIn(activeTableId, f.field_id).expression"
                        :source-tables="sourceTablesForInput"
                        :form-tables="formTablesForInput"
                        :advanced="true"
                        :prefer-quick-pick="true"
                        :readonly="readonly"
                        :slot-key="`tgt-${f.field_id}`"
                        :placeholder="t('editor.targetExprPlaceholder')"
                        :quick-pick-title="f.field_name"
                        :dock-columns="dockColumnsForInput"
                        :allow-null-const="true"
                        :empty-as-unconfigured="true"
                        @update:model-value="v => setOutputExprIn(activeTableId, f.field_id, v)"
                        @quick-pick-close="onQuickPickClosed(f.field_id)"
                        @quick-pick-open="onQuickPickOpened"
                      />
                      <NSelect
                        size="tiny"
                        class="w80"
                        :data-testid="`target-strategy-select-${f.field_id}`"
                        :disabled="readonly"
                        :options="strategyOptionsFor(activeTableId, f.field_id)"
                        :value="outputForIn(activeTableId, f.field_id).fill_strategy"
                        @update:value="v => setOutputStrategyIn(activeTableId, f.field_id, v)"
                      />
                      <NSelect
                        v-if="outputForIn(activeTableId, f.field_id).fill_strategy === 'merge' && !isAttachmentTargetField(activeTableId, f.field_id)"
                        size="tiny"
                        class="w80"
                        :data-testid="`target-separator-select-${f.field_id}`"
                        :disabled="readonly"
                        :options="separatorOptions"
                        :value="outputForIn(activeTableId, f.field_id).separator ?? ','"
                        :title="t('editor.separatorTitle')"
                        @update:value="v => setOutputSeparatorIn(activeTableId, f.field_id, v)"
                      />
                      <NSelect
                        v-if="targetRoleOf(activeTableId) !== 'main' && (!isAttachmentTargetField(activeTableId, f.field_id) || sortDirForIn(activeTableId, f.field_id) !== 'none')"
                        size="tiny"
                        class="w80"
                        :data-testid="`target-sort-select-${f.field_id}`"
                        :disabled="readonly"
                        :options="sortOptions"
                        :value="sortDirForIn(activeTableId, f.field_id)"
                        @update:value="v => setSortIn(activeTableId, f.field_id, v)"
                      />
                    </div>
                  </div>
                </template>
                <!-- 暂存 tab（Phase B，动作暂存区）：自由列编辑器，单 spec 进/出接线同 ChartTargetSection。 -->
                <template v-else-if="activeTab?.kind === 'staging' && activeStagingTarget">
                  <StagingTargetSection
                    :model-value="activeStagingTarget"
                    :source-tables="sourceTablesForInput"
                    :form-tables="formTablesForInput"
                    :dock-columns="dockColumnsForInput"
                    :readonly="readonly"
                    @update:model-value="setStagingTargetSpec"
                  />
                </template>
                <!-- 图表 tab：单图表映射编辑器（ChartTargetSection 改造版）。 -->
                <template v-else-if="activeTab?.kind === 'chart' && activeChartSpec">
                  <ChartTargetSection
                    :model-value="activeChartSpec"
                    :catalog-entry="activeChartCatalogEntry"
                    :source-tables="sourceTablesForInput"
                    :form-tables="formTablesForInput"
                    :dock-columns="dockColumnsForInput"
                    :readonly="readonly"
                    @update:model-value="v => setChartTargetSpec(activeChartId, v)"
                  />
                </template>
              </div>
            </template>
          </section>

          <!-- ③定位条件：delete 无字段列表，右栏改放
               定位条件面板——markup 与左栏 qb-condition-panel（insert/update/取数模式，见上方 v-if
               "writeOp !== 'delete'" 分支）逐字同源，两处互斥渲染（本分支只在 writeOp==='delete' 时
               命中），保持同一份交互/展示逻辑，不再造第二套判据。段序号仍③（同 isWriteMode?3:2 口径），
               只是物理位置从左栏挪到右栏。 -->
          <section v-else-if="writeOp === 'delete'" class="seg seg-grow" data-testid="qb-condition-panel">
            <div class="seg-title">
              <span class="seg-n" :class="{ 'seg-n-empty': !conditionHasContent }">{{ segNo(isWriteMode ? 3 : 2) }}</span>
              {{ t('qb.conditionPanelTitle') }}
            </div>
            <div
              class="qb-panel-body qb-condition-view"
              data-testid="qb-condition-view"
              role="button"
              tabindex="0"
              @click="openConditionDialog"
            >
              <template v-if="conditionHasContent">
                <ConditionReadonlyView
                  v-if="!model.where_text_source"
                  :group="whereGroup"
                  :source-tables="sourceTablesForInput"
                  :form-tables="formTablesForInput"
                />
                <div v-else class="qb-condition-expr-view">
                  <span
                    v-for="(seg, i) in whereExprDisplaySegments()"
                    :key="i"
                    class="tok"
                    :class="[`tok-${seg.kind}`, seg.tableClass || null]"
                  >
                    {{ seg.text }}
                  </span>
                </div>
              </template>
              <div v-else class="qb-condition-empty">
                {{ t('qb.conditionEmptyHint') }}
              </div>
            </div>
          </section>

          <!--
               ①段名区分三操作）。 -->
          <section v-else class="seg seg-grow">
            <div class="seg-title">
              <span class="seg-n" :class="{ 'seg-n-empty': !targetHasContent }">{{ segNo(4) }}</span>
              {{ t('editor.writeFieldsSeg') }}
              <!-- 「按名称填充」：与③目标段头同款按钮，泛化到
                   写模式（insert/update，本 section 只在这两操作命中——delete 已在上方③定位条件
                   分支收口，不会到达这里），点击调 autoMatchFields（同一实现，见其注释）。放在段头
                   右侧动作区，margin-left:auto 借 .seg-title 自身 flex 靠右对齐。 -->
              <NButton
                size="tiny"
                quaternary
                class="auto-match-btn write-auto-match-btn"
                data-testid="write-auto-match-btn"
                :disabled="readonly || !writeTargetChosen"
                @click="autoMatchFields(model.target.target_data_table_id)"
              >
                {{ t('editor.autoMatchFields') }}
              </NButton>
            </div>

            <NEmpty v-if="!writeTargetChosen" size="small" :description="t('editor.pickWriteTargetFirst')" />

            <template v-else>
              <div class="wt-hint native-text-hint" data-testid="write-native-text-hint">
                {{ t('editor.nativeTextSemanticsHint') }}
              </div>
              <div class="target-rows write-rows">
                <!-- template v-for（而非直接在 .target-row 上 v-for）：自赋值兜底提示（用户 09-10
                     反馈修法）要求"显示在该行下方"，.target-row 本身是横向 flex（字段名+表达式并排），
                     提示得是行的兄弟节点、独立占一整行，故每个字段产出两个并列子节点。 -->
                <!-- 快捷选择本报表置顶：新增/修改数据要把本报表的值用于匹配或修改，
                     本段 ExpressionInput 传 quick-pick-current-first，⊞ 面板里本报表分组排最前；其余
                     挂载点（③取数目标行、条件、图表/暂存等）不传，顺序不变。 -->
                <template v-for="f in writeTargetFields" :key="f.field_id">
                  <div
                    class="target-row"
                    :data-testid="`expression-write-target-row-${f.field_id}`"
                    :data-target-table-id="model.target.target_data_table_id"
                    :data-field-id="f.field_id"
                    :class="{
                      filled: isFieldConfigured(model.target.target_data_table_id, f.field_id),
                      'row-active': activeFieldKey === f.field_id
                    }"
                    @click="onTargetRowClick(f.field_id, $event)"
                  >
                    <span
                      class="tc-name"
                      :title="isAttachmentFieldDataType(f.data_type) ? t('editor.attachmentTargetHint') : undefined"
                      :data-testid="isAttachmentFieldDataType(f.data_type) ? `write-target-attachment-hint-${f.field_id}` : undefined"
                    ><FieldTypeIcon class="tc-type-icon" :data-type="f.data_type" />{{ f.field_name }}</span>
                    <ExpressionInput
                      :ref="el => setExprInputRef(f.field_id, el)"
                      class="tc-expr"
                      :model-value="writeOutputExprFor(f.field_id)"
                      :source-tables="sourceTablesForInput"
                      :form-tables="formTablesForInput"
                      :advanced="true"
                      :prefer-quick-pick="true"
                      :readonly="readonly"
                      :slot-key="`wtgt-${f.field_id}`"
                      :placeholder="t('editor.targetExprPlaceholder')"
                      :quick-pick-title="f.field_name"
                      :dock-columns="dockColumnsForInput"
                      :quick-pick-current-first="true"
                      :allow-null-const="true"
                      :empty-as-unconfigured="true"
                      @update:model-value="v => setWriteOutputExpr(f.field_id, v)"
                      @quick-pick-close="onQuickPickClosed(f.field_id)"
                      @quick-pick-open="onQuickPickOpened"
                    />
                  </div>
                  <!-- 自赋值兜底提示（不阻断保存/执行，判据见 writeSelfAssignment.ts）：该行填充表达式
                       的引用只有目标字段自己，值恒不变。 -->
                  <div
                    v-if="writeSelfAssignmentFields.has(f.field_id)"
                    class="self-assignment-hint"
                    :data-testid="`write-self-assignment-hint-${f.field_id}`"
                  >
                    {{ t('editor.writeSelfAssignmentHint') }}
                  </div>
                </template>
              </div>
              <!-- 「删除动作无填充字段」提示（editor.deleteNoMapping）此前挂在这里的 v-else 分支——
                   本 section（④填充字段）现在只在 insert/update 命中，delete 已在上方③定位条件
                   分支收口，永远不会到达这里，故该分支已随之删除（不是死代码遗留，是判定条件本身
                   已把 delete 排除在外）。 -->

              <div v-if="writeOp === 'insert'" class="wdd-block" data-testid="write-dedupe-block">
                <div class="wdd-title-row">
                  <span class="wdd-title">{{ t('editor.dedupe') }}</span>
                  <span class="wdd-hint">{{ t('editor.dedupeHint') }}</span>
                </div>
                <div class="wdd-chips-row">
                  <button
                    v-for="f in dedupeCandidateFields"
                    :key="f.field_id"
                    type="button"
                    class="wdd-chip"
                    :class="{ on: dedupeFieldIds.includes(f.field_id) }"
                    :disabled="readonly"
                    :data-testid="`write-dedupe-chip-${f.field_id}`"
                    @click="toggleDedupeField(f.field_id)"
                  >
                    <span v-if="dedupeFieldIds.includes(f.field_id)" class="wdd-chip-check">✓</span>{{ f.field_name }}
                  </button>
                  <span v-if="!dedupeCandidateFields.length" class="wdd-empty-hint">{{ t('editor.dedupeNoFilledFields') }}</span>
                </div>
                <div v-if="writeTargetIsDetail" class="wdd-scope-row" data-testid="write-dedupe-scope">
                  <span class="wdd-scope-label">{{ t('editor.dedupeScopeLabel') }}</span>
                  <NRadioGroup size="small" class="wdd-scope-radio" :disabled="readonly" :value="dedupeScope" @update:value="setDedupeScope">
                    <NRadio value="all">{{ t('editor.dedupeScopeAll') }}</NRadio>
                    <NRadio value="parent">{{ t('editor.dedupeScopeParent') }}</NRadio>
                  </NRadioGroup>
                </div>
              </div>
            </template>
          </section>
        </div>
      </div>
    </div>

    <div v-if="!props.hideStatusBar" class="syntax-check-block">
      <NPopover trigger="click" placement="bottom-start" :disabled="statusNotices.length === 0" :show-arrow="false" scrollable style="max-width: 720px; max-height: 320px">
        <template #trigger>
          <div
            class="syntax-check-bar"
            :class="[`sc-${statusSeverity}`, { 'sc-clickable': statusNotices.length > 0 }]"
            :title="statusTitle"
            data-testid="syntax-check-bar"
          >
            <span class="sc-dot" />
            <span class="sc-label" :class="{ 'sql-err': statusSeverity === 'invalid' }" data-testid="syntax-check-label">{{ statusLabel }}</span>
            <span v-if="statusNotices.length > 0" class="sc-more" data-testid="syntax-check-more">{{ t('editor.noticeDetails') }} ▾</span>
          </div>
        </template>
        <ul class="sc-notice-list" data-testid="syntax-check-notices">
          <li v-for="(n, i) in statusNotices" :key="i" class="sc-notice-row" :class="`is-${n.severity}`" :data-testid="`syntax-check-notice-${i}`">
            <span class="sc-notice-dot" />
            <span v-if="n.where" class="sc-notice-where">{{ n.where }}</span>
            <span class="sc-notice-message">{{ n.message }}</span>
          </li>
        </ul>
      </NPopover>
    </div>

    <!-- 条件编辑弹窗（②面板点击打开）：本地缓冲编辑，确定才回写 model.where/where_expr。
         模式由上方②面板头的两态按钮唯一决定——弹窗标题栏内那份重复的切换已移除（本轮要求），
         弹窗只编辑当前 mode 的内容，故不再有 update:mode 回流。 -->
    <ConditionEditorDialog
      :show="showConditionDialog"
      :mode="whereMode"
      :group="whereGroup"
      :where-text-source="model.where_text_source ?? null"
      :source-tables="sourceTablesForInput"
      :form-tables="formTablesForInput"
      :dock-columns="dockColumnsForInput"
      @update:show="v => (showConditionDialog = v)"
      @confirm="onConditionConfirm"
    />
    <JoinDesignerDialog
      :show="showJoinDesigner"
      :joins="model.source.joins"
      :source-options="aliasOptions"
      :field-options="fieldSelectOptions"
      :unlinked="unlinkedAliases"
      :default-join-type="isWriteMode ? 'inner' : 'left'"
      :write-target-alias="writeTargetSourceAlias"
      @update:show="v => (showJoinDesigner = v)"
      @update:joins="onUpdateJoins"
    />
  </div>
</template>

<style scoped>
/* 数据流左右分栏改版：根节点尺寸约束不归本组件管——100% 填充父容器（需 flex 父容器，既有约束不变，
 * ExpressionEditorHost.vue 的 .expr-host-editor display:flex 包裹层因此仍然生效）。 */
.expr-editor {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
/* P6c 只读横幅：常驻顶部，不参与下方 .qb-scroll-x 的横向滚动。 */
.readonly-banner {
  flex-shrink: 0;
  margin: 8px 16px 0;
}
/* 只读态：仅调整光标视觉提示，禁用逻辑已在各交互元素上按元素类型分别处理（NButton/NSelect 等走
 * :disabled，条件面板整块点击区走 openConditionDialog 函数内部守卫），本层不整体 pointer-events:none
 * ——否则会连带拦掉鼠标框选文本（硬约束：只读态内容仍须可选中复制）。 */
.expr-editor--readonly .qb-condition-view {
  cursor: default;
}
/* 外层横向滚动包裹层：.qb-layout 本体 min-width:900px，容器更窄时本层整体横向滚动（不裁切/不重排），
 * 纵向交给 .qb-layout 内部各面板自行滚动（本层自身不纵向滚动）。 */
.qb-scroll-x {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
}
/* 左右两栏主体：output/写模式＝左栏①②面板 + 右栏③/④；judge 形态右栏不渲染，左栏铺满（见
 * .qb-left-full）。min-width 撑住"窄容器横向滚动而非重排"的底线。 */
.qb-layout {
  flex: 1 1 auto;
  min-height: 0;
  /* --ee-qb-min-width（2026-08-18 纯加法）：窄容器嵌入方（表格编辑器 M 档 830 弹窗）经 CSS 变量收窄
     横滚下限；未声明时缺省 900px 与既有行为一致。 */
  min-width: var(--ee-qb-min-width, 900px);
  display: flex;
  gap: 20px;
  padding: 16px;
  box-sizing: border-box;
}
.qb-layout.qb-layout-judge {
  min-width: 600px;
}
/* 左栏（约 38% 宽，flex-basis 用百分比不写死像素）：①②面板纵向排列，各自 min-height:0 区内滚动。 */
.qb-left {
  flex: 0 0 38%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* judge 形态（hideTargetSection，右栏不渲染）：左栏横向铺满，仍保持①②纵向 2:3 定比不变。 */
.qb-left.qb-left-full {
  flex: 1 1 100%;
}
/* 右栏＝③目标/④写目标，复用既有 .seg.seg-grow 内部滚动逻辑（子组件结构未动）；此处只提供一个
 * flex 列容器（默认 align-items:stretch 已让唯一子元素铺满宽度，无需额外声明）。 */
.qb-right {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.qb-source-panel {
  flex: 2 1 0;
}
.qb-condition-panel {
  flex: 3 1 0;
}
.qb-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.qb-write-target-panel {
  flex: 0 0 auto;
  min-height: auto;
  overflow: visible;
}
.qb-write-target-panel .write-target-pick {
  display: flex;
  align-items: center;
}
/* 数据表选择器按钮宽度撑满段内（用户 09-10 反馈）：与①来源段头「添加来源」按钮同款处理手法——
 * 该按钮本体（.add-src-btn）定义在 SourceTreePicker.vue 内部，不可改，这里同样只用 :deep 从外部
 * 覆盖视觉，改写宽度而非颜色（颜色覆盖见下方 .seg-actions :deep(.add-src-btn) 同款先例）。
 * .write-target-pick 是 display:flex 容器、按钮是唯一子项，width:100% 即撑满整段可用宽度。 */
/* 左栏顶部插槽容器：与上方 .qb-write-target-panel 同一手法——不参与①②面板
 * 2:3 权重分抢左栏剩余高度，只按插槽内容自然高度撑开，与左栏其余段的 gap 间距保持一致。 */
.qb-left-top-slot {
  flex: 0 0 auto;
}
.qb-write-target-panel .write-target-pick :deep(.add-src-btn) {
  width: 100%;
}
/* ③/④右栏沿用既有四段式内部结构：.seg.seg-grow 填充 .qb-right 剩余高度，其余规则原样保留。 */
.seg.seg-grow {
  flex: 1 1 auto;
  flex-shrink: 1;
  min-height: 0;
  overflow: hidden;
  align-self: stretch;
  align-items: stretch;
}
/* 目标段的标题和选择器不参与收缩 */
.seg.seg-grow > .seg-title,
.seg.seg-grow > .w240,
.seg.seg-grow > .w320,
.seg.seg-grow > .target-tabs {
  flex-shrink: 0;
}
.seg.seg-grow > .n-empty {
  flex: 1 1 auto;
  align-self: stretch;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 目标行列表填充剩余空间并内部滚动（写模式④段：.target-rows 仍是 seg-grow 的直接子元素）。 */
.seg.seg-grow > .target-rows {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* 取数模式③段：tab 内容区（.target-tab-body）本身就是滚动容器——
 * 表 tab 内唯一子元素=.target-rows，图表 tab 内唯一子元素=ChartTargetSection 根节点，都是普通块级元素，
 * 不再需要 .target-tab-body 自身 display:flex 去二次分配（此前多套一层 flex column 反而是本次滚动失效
 * 的另一诱因之一：子元素 flex:1+min-height:0 依赖"父级已有确定高度"，一旦上面 .seg.seg-grow 的宽度/高度
 * 链条有任何一环不稳，这层就跟着连锁失效）。tabs 头（.target-tabs）是它的上一个兄弟节点、天然不在滚动区内。 */
.seg.seg-grow > .target-tab-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* 目标 tabs 头：同「引导式/高级」页签视觉——active 蓝字 + 2px 短下划线，非 active 次要文字色无边。 */
.target-tabs {
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid rgb(var(--border-lightest-color));
}
.target-tab {
  border: none;
  background: none;
  cursor: pointer;
  padding: 6px 0;
  margin-bottom: -1px;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--text-secondary-color));
  border-bottom: 2px solid transparent;
}
.target-tab.active {
  color: rgb(var(--primary-color));
  border-bottom-color: rgb(var(--primary-color));
}
/* 行级激活态（404:22903 二轮 R4）：蓝描边加亮，区别于 .filled 的浅色调（.filled 用 0.45 透明度描边）。 */
.target-row.row-active {
  border-color: rgb(var(--primary-color));
  box-shadow: 0 0 0 2px rgb(var(--primary-color) / 0.18);
}
/* 步骤头右侧动作区（「添加来源」+「表关联」按钮）：靠右对齐。 */
.seg-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
/* 「⋈ 表关联」入口（数据流左右分栏改版：由内联 NPopover 改走独立弹窗 JoinDesignerDialog）：
 * 始终实底强调色，用 filter 压暗一档与「添加来源」区分深浅（设计系统色板未提供独立的「深主色」token，
 * 避免裸 hex，改用 filter 从 --primary-color 派生）。 */
.qb-join-entry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: rgb(var(--primary-color));
  color: rgb(var(--container-bg-color, 255 255 255));
  font-size: 12px;
  cursor: pointer;
  filter: brightness(0.88) saturate(1.1);
}
.qb-join-entry:hover {
  filter: brightness(1.02) saturate(1.1);
}
/* 未关联来源计数：橙色小圆点数字，挂在「⋈ 表关联」入口右侧（存在未关联来源时才渲染）。 */
.qb-join-entry-warn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgb(var(--warning-color));
  color: rgb(var(--container-bg-color, 255 255 255));
  font-size: 10.5px;
  font-weight: 600;
}
.seg-actions :deep(.add-src-btn) {
  background-color: rgb(var(--primary-color));
  border-color: rgb(var(--primary-color));
  color: rgb(var(--container-bg-color, 255 255 255));
}
.seg-actions :deep(.add-src-btn:hover) {
  filter: brightness(1.08);
}
.w80 {
  width: 80px;
}
/* 填充列表行内的下拉（填充方式/分隔符/排序）：与表达式输入框等高 32px。 */
.target-row :deep(.n-base-selection) {
  --n-height: 32px !important;
}
/* ① 来源、③ 条件保持自然高度，不参与拉伸或压缩；④ 目标由 seg-grow 覆盖此规则。 */
.seg {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
  align-items: flex-start; /* 让子元素按内容高度排列 */
}
.seg-hint {
  font-size: 11.5px;
  color: var(--n-text-color-3, #999);
  margin-top: 4px;
  line-height: 1.5;
}
/* 步骤圈之间的竖向连接线（数据流左右分栏改版：①②同在左栏纵向排列，连线只需贯穿这两步；
 * ③/④已挪到右栏，与左栏不再纵向相邻，不再需要跨栏连线）。用 :last-child 匹配"最后一个 .qb-panel"，
 * 锚定各圆圈正下方向下延伸到下一面板的间距（与 .qb-left 的 gap 对齐）。 */
.qb-left > .qb-panel:not(:last-child) > .seg-title > .seg-n::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 16px;
  background: rgb(var(--border-lightest-color));
}
/* ①来源行（数据流左右分栏改版：由 chip 换行流式布局改为逐行列表，行内展示别名徽标/表名/
 * 模板名·字段数灰字/关联状态徽标/×移除，信息密度更高、支持长列表滚动）。 */
.qb-src-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgb(var(--border-color));
  border-radius: 6px;
}
.qb-src-row + .qb-src-row {
  margin-top: 6px;
}
/* F1①：行首别名徽标（bt* 与 t*）样式已随模板移除删掉（.qb-src-alias 不再使用）。 */
/* 来源行表主题色圆点：色值来自全局 ttc-N 变量（table-theme-colors.css），此处只管布局间距。 */
.qb-src-dot {
  flex-shrink: 0;
  margin-right: 2px;
}
/* 表名与灰字副文案都可收缩：窄栏（如表格编辑器控件设置弹窗）里优先压缩副文案（flex-shrink 权重大得多），
 * 表名最后才省略号截断——此前表名 flex-shrink:0，长名直接把来源行撑出横向滚动条。 */
.qb-src-name {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--base-text-color));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qb-src-meta {
  flex: 0 1000 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--text-hint-color));
  font-size: 12px;
}
.qb-src-type-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  background: rgb(var(--fill-light-color, 245 247 250));
  color: rgb(var(--text-secondary-color, 102 102 102));
}
.qb-src-spacer {
  flex: 1 1 auto;
}
/* 关联状态徽标：绿=已手动关联；橙=未关联（可点，直开关联设计器）。 */
.qb-join-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  cursor: pointer;
}
.qb-join-badge-linked {
  background: rgb(var(--success-color) / 0.14);
  color: rgb(var(--success-color));
}
.qb-join-badge-unlinked {
  background: rgb(var(--warning-color) / 0.16);
  color: rgb(var(--warning-color));
}
.qb-src-remove {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgb(var(--text-secondary-color));
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s;
}
.qb-src-remove:hover {
  background: rgb(var(--error-color) / 0.12);
  color: rgb(var(--error-color));
}
/* 写模式「目标」相关来源：虚线边框区别于用户手动添加的实线来源行——
 * 隐含来源 / 引用即入源候选都不带 × 按钮（见模板同名判据注释），虚线视觉呼应"这行是系统自动
 * 维护的，不是你点『＋添加来源』加进来的"。 */
.qb-src-row-write-target {
  border-style: dashed;
  cursor: default;
}
.qb-src-empty-hint {
  margin-top: 6px;
  font-size: 12px;
  color: rgb(var(--text-hint-color));
  line-height: 1.6;
}
/* ②只读条件区：可点击整块打开 ConditionEditorDialog，浅底+圆角呼应①的容器化视觉，hover 提示可点。 */
.qb-condition-view {
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  background: rgb(var(--fill-lighter-color));
  box-sizing: border-box;
  transition: background-color 0.15s;
}
.qb-condition-view:hover {
  background: rgb(var(--fill-light-color));
}
.qb-condition-expr-view {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.qb-condition-empty {
  font-size: 12px;
  color: rgb(var(--text-hint-color));
}
.w240 {
  width: 240px;
}
.w320 {
  width: 320px;
}
.native-text-hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--text-hint-color));
}
/* 写模式自赋值兜底提示（用户 09-10 反馈修法）：紧贴在该字段行下方，样式同 .native-text-hint
   一档 info 级小字提示，只是少一份顶部留白（视觉上贴着上面那一行，不是独立段落）。 */
.self-assignment-hint {
  margin: 2px 0 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--text-hint-color));
}
/* 唯一键防重区块：与 .seg-title/.native-text-hint 同系（同色板、
 * 同 12/13px 档位）；块顶部加一条分隔线（同 FieldTreeDock.vue .n-list-item + .n-list-item 的
 * border-top 分隔口径，用 --border-lightest-color 而非 --border-color——同页已有 .target-tabs
 * 的页签下划线用的也是这档更浅的分隔色，块与块之间不需要 tsp-title 那种强对比标题分隔），与④段
 * 上方填充行列表明确分开；块内各行用 8px 行距（wdd-block 的 gap）。 */
.wdd-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgb(var(--border-lightest-color));
  width: 100%;
}
.wdd-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.wdd-title {
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--base-text-color));
}
.wdd-hint {
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--text-hint-color));
}
.wdd-chips-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
/* chip：未选=描边灰底，选中=主色描边+浅主色底（同 .target-row.filled 的 0.45/0.04 透明度口径），
 * 悬浮/按下不额外加动效——本区块与③目标行同平面，chip 只是"可点的小标签"，不需要按钮式强反馈。 */
.wdd-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 24px;
  padding: 0 10px;
  border: 1px solid rgb(var(--border-color));
  border-radius: 4px;
  background: rgb(var(--fill-lighter-color));
  color: rgb(var(--base-text-color));
  font-size: 12px;
  line-height: 22px;
  cursor: pointer;
  box-sizing: border-box;
}
/* 未选中 hover：借用选中态同一 token（--primary-color）打个浅描边提示，不改背景——避免和 .on 的
 * 浅主色底混淆（hover 只是"可点"提示，不是"已选"状态）。 */
.wdd-chip:not(.on):not(:disabled):hover {
  border-color: rgb(var(--primary-color) / 0.5);
}
.wdd-chip:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.wdd-chip.on {
  border-color: rgb(var(--primary-color) / 0.6);
  background: rgb(var(--primary-color) / 0.08);
  color: rgb(var(--primary-color));
}
.wdd-chip-check {
  font-size: 11px;
}
.wdd-empty-hint {
  font-size: 12px;
  color: rgb(var(--text-hint-color));
}
/* 判重范围行：原先照抄 .tsp-row-radio 的「label 收窄+单选组
 * 占满剩余宽度靠右」网格，结果单选组飘到整列最右侧，与「判重范围」标签隔出半个宽面板——本行不是
 * 设置浮层里的表单项，两列都应按内容收窄、紧跟在标签右侧即可，不需要撑满/靠右。 */
.wdd-scope-row {
  display: grid;
  grid-template-columns: max-content max-content;
  column-gap: 16px;
  justify-content: start;
  align-items: center;
  min-height: 28px;
}
.wdd-scope-label {
  font-size: 12px;
  color: rgb(var(--base-text-color));
  white-space: nowrap;
}
.wdd-scope-radio {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.wdd-scope-radio :deep(.n-radio) {
  margin-right: 0;
}
.target-select {
  width: 100%;
}
.target-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid rgb(var(--border-color));
  border-radius: 8px;
}
/* 已配置表达式的行整行蓝描边高亮（沿用原有逻辑，只把裸 rgba 改成 --primary-color token）。 */
.target-row.filled {
  border-color: rgb(var(--primary-color) / 0.45);
  background: rgb(var(--primary-color) / 0.04);
}
/* 字段名列按设计视觉重塑为「类下拉」圆角描边小方块（约 180px）；仍是只读展示，不引入选择行为——
 * 目标字段集合固定=当前目标表全部字段（与原实现一致，未改数据/操作逻辑）。 */
.tc-name {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  width: 180px;
  height: 32px; /* 与表达式输入框（.expr-input min-height 32）等高 */
  padding: 0 10px;
  box-sizing: border-box;
  border: 1px solid rgb(var(--border-color));
  border-radius: 6px;
  background: rgb(var(--fill-lighter-color));
  color: rgb(var(--base-text-color));
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-expr {
  flex: 1 1 auto;
  min-width: 0;
}
.tc-type-icon {
  flex-shrink: 0;
  margin-right: 4px;
}
/* .mode-toggle 样式已随「引导式/表达式」两档切换按钮一并移除（2026-09-02 暂时收敛，恒表达式模式）。 */
.syntax-check-block {
  margin-top: 10px;
  flex-shrink: 0;
  max-width: 100%;
}
.syntax-check-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  flex-shrink: 0;
  max-width: 100%;
}
.sc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgb(var(--text-hint-color));
  transition: background-color 0.15s;
}
/* F3：状态文案超长时省略号截断，hover 由外层 title 属性展示未截断全文（min-width:0 让 flex 子项
 * 允许收缩到小于内容宽度，否则 ellipsis 不生效）。 */
.sc-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.syntax-check-bar.sc-pending .sc-label {
  color: rgb(var(--text-hint-color));
}
.syntax-check-bar.sc-checking .sc-dot {
  background: rgb(var(--primary-color));
}
.syntax-check-bar.sc-checking .sc-label {
  color: rgb(var(--primary-color));
}
.syntax-check-bar.sc-valid .sc-dot {
  background: rgb(var(--success-color));
}
.syntax-check-bar.sc-valid .sc-label {
  color: rgb(var(--success-color));
}
.syntax-check-bar.sc-invalid .sc-dot {
  background: rgb(var(--error-color));
}
.syntax-check-bar.sc-invalid .sc-label {
  color: rgb(var(--error-color));
}
.syntax-check-bar.sc-warning .sc-dot {
  background: rgb(var(--warning-color));
}
.syntax-check-bar.sc-warning .sc-label {
  color: rgb(var(--warning-color));
}
.syntax-check-bar.sc-clickable {
  cursor: pointer;
}
.sc-more {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 8px;
  font-size: 11px;
  color: rgb(var(--text-hint-color));
}
.sc-notice-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sc-notice-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--base-text-color));
}
.sc-notice-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  transform: translateY(-1px);
}
.sc-notice-row.is-error .sc-notice-dot { background: rgb(var(--error-color)); }
.sc-notice-row.is-warning .sc-notice-dot { background: rgb(var(--warning-color)); }
.sc-notice-row.is-info .sc-notice-dot { background: rgb(var(--info-color)); }
.sc-notice-where {
  flex: 0 0 auto;
  color: rgb(var(--text-secondary-color));
}
.sc-notice-message { flex: 1 1 auto; }
/* F3：.sql-err 独立样式已合并进 .sc-label（含颜色，走 .sc-invalid .sc-label 语义 token）——
 * 类名仍保留在模板上供既有测试选择器 `.sql-err` 命中，本处不再需要单独的布局/配色规则。 */
/* 「自动匹配」描边小钮：原挂在右侧字段抽屉标题行，抽屉被树坞取代后挪回③目标 tabs 行右侧
 * （margin-left:auto 借 .target-tabs 自身 display:flex 靠右对齐，视觉不变，只是父级换了）。 */
.auto-match-btn {
  /* Figma 1333:505932：品牌色描边 + 品牌色 12px 文字，圆角 4，内边距 4（行高 22 → 总高 30） */
  height: 30px;
  padding: 4px;
  border: 1px solid rgb(var(--primary-color));
  border-radius: 4px;
  font-size: 12px;
  color: rgb(var(--primary-color));
}
/* 写模式④段头「按名称填充」：直接放在 .seg-title（flex 容器）里，
 * margin-left:auto 靠右对齐，同③ .target-tab-actions 口径。 */
.write-auto-match-btn {
  margin-left: auto;
}
/* tabs 行右侧操作区：清空规则下拉 + 「自动匹配」并排靠右（margin-left:auto 从 .auto-match-btn
 * 上移到容器，视觉位置不变）。 */
.target-tab-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 「设置」按钮（UI 反馈 2026-09-07 ⑥）：与「按名称填充」同款描边式 tiny 按钮。 */
.target-settings-btn {
  /* 与「自动匹配」同稿同款（Figma 1333:505932） */
  height: 30px;
  padding: 4px;
  border: 1px solid rgb(var(--primary-color));
  border-radius: 4px;
  font-size: 12px;
  color: rgb(var(--primary-color));
}
/* 设置 popover 内容：每行「label + 控件」左右对齐，控件等宽。 */
/* 目标「设置」浮层（用户 2026-09-07 二轮布局调整）：两列网格——label 列自适应、控件列定宽 168px；
 * 开关靠控件列右缘、下拉/数字框撑满控件列；行高统一 32px；分组小标题用提示色。 */
.target-settings-pop {
  display: flex;
  flex-direction: column;
  width: 336px;
  padding: 2px 2px 4px;
}
.tsp-title {
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--base-text-color));
  padding-bottom: 8px;
  margin-bottom: 2px;
  border-bottom: 1px solid rgb(var(--border-color));
}
.tsp-group {
  font-size: 11px;
  color: rgb(var(--text-hint-color));
  letter-spacing: 0.4px;
  margin: 8px 0 2px;
}
.tsp-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 168px;
  align-items: center;
  column-gap: 12px;
  min-height: 32px;
}
/* 控件列：开关靠右；下拉 / 数字框撑满列宽（NSelect / NInputNumber 根节点都是 inline-flex，给 width:100% 即可）。 */
.tsp-row > .n-switch {
  justify-self: end;
}
.target-take-input {
  width: 100%;
}
/* 清空方式 / 清除时机（用户 2026-09-08 由下拉改单选组）：这两行不再用 168px 定宽控件列——label 按内容收窄、
 * 单选组占满剩余宽度并靠右横排；选项多时（明细目标三档）允许折行，行高由 .tsp-row 的 min-height 兜底。 */
.tsp-row-radio {
  grid-template-columns: max-content minmax(0, 1fr);
}
.target-clear-mode-radio,
.target-clear-timing-radio {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px 12px;
}
/* naive 的 NRadio 自带 margin-right，横排间距统一交给上面的 gap，避免最后一项右侧多出空白。 */
.target-clear-mode-radio :deep(.n-radio),
.target-clear-timing-radio :deep(.n-radio) {
  margin-right: 0;
}
.tsp-label {
  font-size: 12px;
  color: rgb(var(--base-text-color));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 自动按行列匹配 / 清理空行两行沿用 .tsp-row 网格；.tarm-label 与 .tsp-label 同色（此前灰一档，与其它行不一致）。 */
.target-auto-row-match {
  display: grid;
}
.tarm-label {
  color: rgb(var(--base-text-color));
}
</style>
