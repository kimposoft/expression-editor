/**
 * V4（表达式引擎(表达式引擎) V4 引擎）demo 编辑面组件族——子目录汇总导出。
 * 供 ../index.ts 统一 `export * from './v4'`；也允许调用方按需 `from '@kimposoft/expression-editor/src/v4'`
 * 直接深入引用（本包 exports 只暴露根入口，深路径引用仅供包内单测/同仓构建工具使用）。
 */
export { ALICE_V4_DEMO_HOST, provideAliceV4DemoHost, useAliceV4DemoHost, escapeBracketIdent } from './types';
export type {
  V4Purpose,
  V4CatalogField,
  V4CandidateSource,
  V4DemoCatalog,
  V4SkippedField,
  V4Diagnostic,
  V4DiagnoseRef,
  V4DiagnoseRequest,
  V4DiagnoseResponse,
  AliceV4DemoHost,
  /** 原属 ./useV4NodeDocument.ts 的 finalize 结果类型，随「V4 编辑面死码删除」批次迁到 ./types.ts
   *  保留——记录控制器插件 ActionConfigSurface.vue 换轨后仍从包根引用这两个类型，见 ./types.ts 头注释。 */
  V4NodeDocumentDiagnosticItem,
  V4NodeDocumentFinalizeResult
} from './types';

export type {
  V4ExpressionRefWire,
  V4SourceBindingCatalog,
  V4SourceBindingReport,
  V4SourceBindingStaging,
  V4SourceBindingUnit,
  V4SourceBindingView,
  V4SourceBinding,
  V4ExpressionDocument,
  V4JoinDefinition,
  V4OutputDefinition,
  V4ExtractDefinitionOptions,
  V4ExtractDefinition
} from './definition';

export {
  joinExpressionId,
  outputExpressionId,
  FILTER_EXPRESSION_ID,
  generateDefinitionId,
  generateStagingColumnId,
  buildDefinition,
  applyDefinitionToState
} from './definitionDoc';
export type { BuildDefinitionInput, RestoredTextMap, ApplyDefinitionResult } from './definitionDoc';

/** 取数节点文档（ExtractNodeDocumentV4 文档形状）类型镜像，见 ./nodeDocument.ts 头注释。 */
export type {
  V4TableRole,
  V4ClearMode,
  V4ClearTiming,
  V4ClearSpec,
  V4FillStrategy,
  V4FillOutput,
  V4FillTarget,
  V4QueryOptions,
  V4QueryDefinition,
  V4ChartForm,
  V4ChartLayout,
  V4ChartAggregate,
  V4ChartValueSlot,
  V4ChartSlots,
  V4ChartTarget,
  V4StagingTarget,
  V4StagingColumn,
  V4ExtractNodeDocument
} from './nodeDocument';
export { NODE_DOCUMENT_SCHEMA_VERSION } from './nodeDocument';

/** 目标页签选项表（纯函数），见 ./targetOptions.ts 头注释。 */
export { clearModeOptionsFor, CLEAR_TIMING_OPTIONS, fillStrategyOptionsFor, SEPARATOR_PRESETS, DEFAULT_SEPARATOR } from './targetOptions';
export type { V4OptionItem } from './targetOptions';

export { ALICE_V4_HOST, provideAliceV4Host, useAliceV4Host } from './types';

/** UI 换轨（取数配置面直接挂 3.4 ExpressionEditor）用的两个适配层，见各自文件头注释。
 *  v4QueryToModelSource/modelToV4Query：来源/关联/筛选段
 *  的正反翻译，取数节点与写节点（./writeModelAdapter.ts）共用。 */
export {
  v4DocToExpressionModel,
  expressionModelToV4Doc,
  v4QueryToModelSource,
  modelToV4Query,
  stripUnconfiguredOutputs,
  fillEmptyStagingNamesForPreview,
  reportSourceBinding,
  reportInstanceId,
  reportInstanceTableId,
  isReportContextTable,
  // stagingInstanceId：暂存来源 instance_id 的确定性派生（`stg-<producer_node_id>-
  // <6hex>`），此前只在包内部消费；流程条件把"流程上下文"合成为虚拟暂存来源时，需要在包外算出与
  // 服务端保存闸同一口径的 instance_id（见 ../stagingSourceLite.ts 同批"独立调用方"先例）。
  stagingInstanceId,
  REPORT_INSTANCE_PREFIX,
  v4ExpressionToValueRef,
  valueRefToV4Expression,
  EMPTY_CONDITION_GROUP,
  type V4ModelAdapterContext
} from './expressionModelAdapter';
export { createV4ExpressionHost, textSourceToV4ExpressionDocument } from './v4ExpressionHostAdapter';
/** where 档可落的两个 V4 谓词根用途。 */
export type { V4WherePurpose } from './v4ExpressionHostAdapter';
export type {
  AliceV4Host,
  V4TokenizeRequest,
  V4TokenizeResponse,
  V4RestoreRequest,
  V4RestoreResponse,
  V4CompileNodeRequest,
  V4CompileNodeTargetResult,
  V4CompileNodeResponse
} from './types';

/** 空白取数节点文档与类型守卫（W2 P1），供动作设计器壳与取数配置面初始化/判形。 */
export { emptyExtractNodeDocument, isExtractNodeDocument } from './emptyNodeDocument';

/** 写节点文档（WriteNodeDocumentV4 文档形状）类型镜像 + 空白文档/类型守卫，见
 *  ./writeNodeDocument.ts 头注释。 */
export type {
  V4WriteOperation,
  V4WriteTarget,
  V4WriteAssignment,
  V4WriteParentKind,
  V4WriteParent,
  V4WriteDedupeScope,
  V4WriteDedupe,
  V4WriteNodeDocument
} from './writeNodeDocument';
export { WRITE_NODE_DOCUMENT_SCHEMA_VERSION, emptyWriteNodeDocument, isWriteNodeDocument } from './writeNodeDocument';

/** 写节点 UI 换轨适配层，见 ./writeModelAdapter.ts 头注释。
 *  WriteTargetCannotBeViewError：写目标不能是视图的具名错误，见其类头注释。 */
export { v4WriteDocToExpressionModel, expressionModelToV4WriteDoc, WriteTargetCannotBeViewError } from './writeModelAdapter';

/** 表格编辑器字段控件候选查询文档类型镜像与空文档构造，见 ./controlNodeDocument.ts 头注释。 */
export type {
  V4ControlCascadeMode,
  V4ControlCascadeSpec,
  V4ControlGroupSpec,
  V4ControlGroupLevel,
  V4ControlColumn,
  V4ControlOrderBy,
  V4ControlQueryDocument,
  V4ControlSearchSpec
} from './controlNodeDocument';
export { CONTROL_QUERY_DOCUMENT_SCHEMA_VERSION, emptyControlQueryDocument, isControlQueryDocument } from './controlNodeDocument';
/** 控件设置面 UI 换轨适配层，见 ./controlModelAdapter.ts 头注释。 */
export { v4ControlDocToExpressionModel, expressionModelToV4ControlDoc } from './controlModelAdapter';

/** 宿主桥作用域信封（W2 P4）：从取数节点文档分拣 catalog/report 来源，供 AliceV4Host.setScope。 */
export { hostScopeFromDocument } from './types';
export type {
  V4HostScope,
  V4HostScopeSource,
  V4HostScopeReportSource,
  V4HostScopeReportCatalogTable,
  V4HostScopeStagingSource,
  V4HostScopeViewSource
} from './types';

/** 视图定义文档类型镜像 + 空文档构造/判别守卫，
 *  见 ./viewDefinition.ts 头注释。 */
export type {
  V4ViewType,
  V4ViewSetMode,
  V4ViewColumn,
  V4ViewRegularBody,
  V4ViewGroup,
  V4ViewCombinedBody,
  V4ViewDocument
} from './viewDefinition';
export {
  VIEW_DOCUMENT_SCHEMA_VERSION,
  isRegularView,
  isCombinedView,
  emptyViewQuery,
  emptyRegularView,
  emptyCombinedView,
  generateViewColumnId,
  generateDataGroupId,
  effectiveViewDistinct,
  effectiveViewSetMode
} from './viewDefinition';

/** 视图设计器 UI 换轨适配层，见 ./viewModelAdapter.ts 头注释。 */
export type { V4ViewColumnModel, V4RegularViewModel, V4ViewGroupModel, V4CombinedViewModel } from './viewModelAdapter';
export {
  v4ViewDocToRegularModel,
  regularModelToV4ViewDoc,
  v4ViewDocToCombinedModel,
  combinedModelToV4ViewDoc
} from './viewModelAdapter';

// 「V4 编辑面死码删除」批次（取数配置面已换轨 3.4 ExpressionEditor 本体）：以下曾在此导出的编辑面
// 组件族与其编排逻辑层已删除——useV4NodeDocument.ts（含 outputSlotKey/chartSlotKey 等图表槽位纯函数）、
// V4ExtractNodeEditor.vue、V4ChartTargetSection.vue、V4TargetTabs.vue、V4FunctionBar.vue、
// V4FieldTree.vue、V4ExpressionInput.vue；被删实现见提交历史（sha 6752bd19b/9065c7209/877793c64 等，
// 供日后 V4 编辑面重启时回溯参考）。其中 V4NodeDocumentDiagnosticItem/V4NodeDocumentFinalizeResult
// 两个类型仍被记录控制器插件 ActionConfigSurface.vue 引用，已迁到 ./types.ts 并在上方 './types' 导出块
// 中继续导出，未随本批删除。
