/**
 * @kimposoft/expression-editor 统一表达式编辑器包公共入口。
 * - 宿主：import ExpressionEditor + provideExpressionHost + createWebExpressionHost
 * - 插件 bundle：import ExpressionEditor（bundle 进 UMD，不 external）
 */

// 分段标题 + 卡片基础样式：.seg-title/.seg-n/.qb-panel，唯一定义处
// 见该文件头注释。非 scoped 全局样式副作用 import——宿主页面只需 import 本包任意导出（本就必做），
// 即可拿到与 ExpressionEditor 内置分段一致的标题/卡片视觉，供 #left-top 插槽内容复用，不必另行
// import 包内部路径。ExpressionEditor.vue 自身也 import 了同一份文件，重复 import 由打包器去重。
import './qb-segment.css';

// 类型与模型
export * from './types';

export type { ExpressionEditorProps, ExpressionEditorEmits } from './contract';

// 多填充目标归一化工具（target/targets/chart_targets 双写兼容层，多目标改造）
export { readTargets, readChartTargets, writeTargets, emptyTarget } from './modelTargets';
// 暂存目标归一化工具（Phase B，动作暂存区：target_kind='staging' 的读写助手，收编自表目标散落过滤）
export { readTableTargets, readStagingTarget, hasStagingSource, emptyStagingTarget } from './modelTargets';

// 注入接口
export { EXPRESSION_HOST, provideExpressionHost, useExpressionHost, useT, pickLocaleTable, hostSupportsLowerText } from './host';
export { REF_SYNTAX, provideRefSyntax, useRefSyntax, type RefSyntax } from './host';
/** 系统变量 V4 文本标记解析口：V4 取数配置面按目录 system_variables provide，⊞/ƒ 拾取据此落文本。 */
export { SYSTEM_VARIABLE_TOKEN, provideSystemVariableToken, useSystemVariableToken, type SystemVariableTokenResolver } from './host';
export {
  provideExpressionEditorScopeOptions,
  useExpressionEditorScopeOptions,
  type ExpressionEditorScopeOptions
} from './host';
export type { ExpressionHost, ChartCatalogEntry, EditorPrefs } from './host';

// 文本表达式 sidecar 工具：稳定 ID 派生 / lower-text refs 组装 / 重开文本恢复；
// 视图设计器与单测直接消费。
export {
  derivedStableId,
  refOfStableId,
  buildLowerTextRefs,
  restoreTextFromSource,
  resolveTextLabel,
  labelOfTextRef,
  runeToUtf16Index
} from './textSource';
// 文本模式函数/关键字目录。
export { textFunctionCatalog, textFunctionAliasOf, textPackLangOf, useTextFunctionCatalog, TEXT_KEYWORDS } from './functionCatalog';
export type { FunctionCatalogItem, TextPackLang, TextKeywordItem } from './functionCatalog';

// 上下文 composable（含静态目录）
export {
  useExpressionContext,
  SYSTEM_VARIABLES,
  EXPRESSION_FUNCTIONS,
  WINDOW_FUNCTIONS,
  stagingColumnToTemplateField,
  // 2026-08-15 追加：合并后的系统变量目录 + 追加项写入函数。公开导出供宿主侧单测
  // 验证 ExpressionEditor 的 extraSystemVariables prop 确实经由 watch/onBeforeUnmount 接到这份
  // 模块级单例（而不只是"函数存在但没被调用"），也供未来有类似"读取当前合并目录"需要的调用方使用。
  systemVariablesCatalog,
  setExtraSystemVariables,
  isFieldTypeUnsupported
} from './useExpressionContext';
export type {
  TableFields,
  SystemVariableDef,
  FunctionDef,
  WindowFnDef,
  ExpressionContextOptions,
  ExpressionCatalog
} from './useExpressionContext';

// 抽屉总线
export { provideExpressionDrawer, useExpressionDrawer } from './expressionDrawerBus';
export type { ExpressionDrawerBus } from './expressionDrawerBus';

// 纵向可拖拽分隔条（树区/编辑区上下分栏地基件，本次仅新增未接入）
export { useResizableSplit } from './useResizableSplit';
export type { UseResizableSplitOptions, UseResizableSplitReturn } from './useResizableSplit';
// 弹窗几何（拖动/缩放/最大化/尺寸记忆）：此前漏导出——exports 白名单拦死深路径，插件侧只能
// 就地重实现（表格编辑器 use-builder-dialog-geometry.ts 即此因）。补导出供后续消费方收敛回共享实现。
export { useDialogGeometry } from './useDialogGeometry';
export type {
  UseDialogGeometryOptions,
  UseDialogGeometryReturn,
  DialogGeometry,
  DialogResizeDirection
} from './useDialogGeometry';

// 序列化工具
export { serializeToText, parseTextRefs, relabelText, labelOfRef, instanceSuffix, resolveLabel } from './rawSerialize';
export type { SourceTableLite, FormTableLite } from './rawSerialize';

// 暂存来源合成工具：不持有 model.source.tables 的独立调用方（如流程设计器条件表达式）
// 把「上一步暂存区」列表拼成 SourceTableLite 追加进 sourceTables 数组的最小口径，与 ExpressionEditor.vue
// sourceTablesForInput 的 staging 分支同一合成规则，见 ./stagingSourceLite.ts 头注释。
export { stagingSourceToSourceTableLite } from './stagingSourceLite';
export type { StagingSourceLite } from './stagingSourceLite';

// 来源表主题色（2026-09-02 样式草案）：色类计算 + 文本表达式按 {…}/[…] 标记切段着色。此前只在包内部
// 消费（ExpressionInput/ExpressionTokens），视图设计器等宿主页面需要给「视图列」「批量添加」等新场景
// 的胶囊/色点画同一套主题色时，也要用到这两个纯函数，补导出（不改内部实现）。
export { splitLabeledTextSegments, tokenTableClassFor } from './tableThemeColors';

// 视图列「批量添加」列名去重：宿主页面拼装 confirm
// 载荷、或自行预览列名时可直接复用同一份去重口径，不必另起一套。
export { dedupeColumnNames } from './fieldMultiPick';

// 结构化 ValueRef → V4（KimpoSQL）方括号文本：此前只在包内部消费
// （ExpressionEditor.vue 的 ⊞ 拾取收口），插件侧字段气泡（QuickFieldPicker）落的同样是结构化 ValueRef，
// 需要同一份口径把它转成文本再进 valueRefToV4Expression——否则落 `source_text: ''`，保存被服务端拒绝
//。补导出，不改内部实现。
export { valueRefToBracketText, pickedRefForSyntax } from './bracketText';

// 历史 KimpoSQL 仅存在性检测；不回显内容、不猜测结构、不自动迁移。
export { hasLegacyKimpoSql } from './legacyAdapter';

// 按行列匹配：条件段关联式 → 内存匹配键提取（ExpressionEditor.reconcile 使用；导出供单测）
export { extractConditionMatchKeys, REPORT_ALIAS_PREFIX } from './matchKeyExtract';
export type { ResolveContextDataTable } from './matchKeyExtract';

// F3：校验错误信息本地化映射（ExpressionEditor.vue 校验条使用；导出供单测直接调用 friendlyErrorMessage）
export { friendlyErrorMessage, ERROR_MESSAGE_PATTERNS } from './errorMessages';
export type { ErrorMessagePattern } from './errorMessages';

// 主组件（唯一公开的 Vue 组件）
export { default as ExpressionEditor } from './ExpressionEditor.vue';
// S3b-1（表格编辑器插件 字段控件"从数据"单输出管道）复用的四个内部子组件，对外可见。
export { default as SourceTreePicker } from './SourceTreePicker.vue';
export { default as ConditionTree } from './ConditionTree.vue';
export { default as ExpressionInput } from './ExpressionInput.vue';
// 表达式胶囊渲染：ExpressionInput
// 内部挂载，导出供单测直接挂载，也供宿主页面在 ExpressionInput 之外单独展示某个 ValueRef 的着色
// token（如自定义的只读展示场景）。
export { default as ExpressionTokens } from './ExpressionTokens.vue';
export { default as FieldDrawer } from './FieldDrawer.vue';
// 通用运算符/函数条 + 字段树面板（315:xxxx 系列重塑抽出的通用组件，供 SQL 面板/表达式弹窗/字段抽屉
// 后续任务接线复用；本任务只新增导出，不改既有组件本体）。
export { default as OperatorFunctionBar } from './OperatorFunctionBar.vue';
export { default as FieldTreePanel } from './FieldTreePanel.vue';
// 关联设置面板（346:10750 手动关联浮层重塑抽出的通用组件，供动作设计器其他场景复用）。
export { default as JoinSettingsPanel } from './JoinSettingsPanel.vue';
// 字段树坞：ExpressionEditor.vue 内部使用，
// 本次导出主要供单测直接挂载（避免测试要把整个 ExpressionEditor + host 一起搭起来才能验证搜索行为）。
export { default as FieldTreeDock } from './FieldTreeDock.vue';
export type { DockColumn, DockTable } from './FieldTreeDock.vue';
// ⊞ 快捷字段选择器（值单元格三入口之一，死点击域兜底新增）：不走 expressionDrawerBus，自持数据，
// 供 ExpressionInput.vue 内部挂载，同时对外导出供潜在复用（如宿主/插件在 ExpressionInput 之外
// 独立唤起同一套「搜索 + 分组字段/变量」选择 UI）。
export { default as QuickFieldPicker } from './QuickFieldPicker.vue';
export { default as AdvancedExpressionDialog } from './AdvancedExpressionDialog.vue';
// 2026-09-07：两个弹窗合并成一套壳（purpose 参数化），两者现为其薄包装；壳本身导出供单测直接挂载。
export { default as ExpressionDialogShell } from './ExpressionDialogShell.vue';
// F2：从 AdvancedExpressionDialog 抽出的共享编辑主体（树坞+运算符条+文本编辑区），供
// AdvancedExpressionDialog 与 ConditionEditorDialog 表达式模式共同内嵌；A 级叠加导出（新增，
// 不改动既有导出），供单测直接挂载。
export { default as AdvancedExpressionPanel } from './AdvancedExpressionPanel.vue';
// 数据流左右分栏改版新增：条件只读展示 + 条件编辑弹窗 + 表关联设计器，均为 ExpressionEditor.vue
// 内部使用的子组件，导出同样只为供单测直接挂载（沿用 FieldTreeDock/AdvancedExpressionDialog 的既有先例）。
export { default as ConditionReadonlyView } from './ConditionReadonlyView.vue';
export { default as ConditionEditorDialog } from './ConditionEditorDialog.vue';
export type { ConditionConfirmPayload } from './ConditionEditorDialog.vue';
export { default as JoinDesignerDialog } from './JoinDesignerDialog.vue';
// 批量添加字段对话框：独立可控组件（show/groups
// 等均由调用方以 props 传入，不依赖 ExpressionHost 注入），供视图设计器等宿主页面直接挂载。
export { default as FieldMultiPickDialog } from './FieldMultiPickDialog.vue';
// 注：StagingTargetSection.vue（Phase B 暂存目标单 spec 编辑器）与 ChartTargetSection.vue 同款，均为
// ExpressionEditor.vue 内部专用子组件，不进公开导出（对齐 ChartTargetSection 现状，不在此新开先例）。

// V4（表达式引擎(表达式引擎) V4 引擎）demo expression-only 编辑面组件族：类型/host 注入 + 三个组件，
// 与上方既有导出完全独立并存，不改动既有 ExpressionHost/types 的任何已有导出语义（见 src/v4/types.ts 头注释）。
export * from './v4';
