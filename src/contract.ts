import type { ExpressionModel, ExpressionNotice, WriteOperation } from './types';
import type { SystemVariableDef } from './useExpressionContext';

export interface ExpressionEditorProps {
  modelValue: ExpressionModel;
  templateId: string;
  /** 写模式：'' / undefined = 取数回填（现状，④目标为回填映射）；insert/update/delete = 写动作，
   *  ④目标改为「写目标」段（新增/修改/删除数据）。由 NodeConfigDialog 据动作 params_schema['x-write-operation'] 传入。 */
  writeOperation?: WriteOperation;
  /** R4：隐藏④目标段 UI（取数回填模式下生效，写模式无关）。用于「打开表单」等纯读动作——
   *  目标表/预览字段由宿主侧（NodeConfigDialog）另起一块专属 UI 管理（如预览字段多选），
   *  ExpressionEditor 本体仅承载①来源/③条件（+隐式②关联）画布。由 NodeConfigDialog 据
   *  动作 params_schema 字段级 x-editor-options.hideTarget 透传。缺省 false，不影响既有取数/写动作。 */
  hideTargetSection?: boolean;
  stagingSource?: { producerNodeId: string; producerLabel: string; columns: Array<{ code: string; name: string; type?: string }> } | null;
  /**
   * P6c（2026-08-12 权限架构终局裁定②，设计态只读闸）：true=编辑器整体只读——禁用来源/关联/条件/
   * 目标各段的全部编辑入口（新增/移除/拖拽/字段插入/工具条按钮等），仅保留内容可读、可滚动、可选中
   * 复制；并在编辑区顶部显示横幅提示（复用 errMsg.forbiddenSourceApp 既有 i18n key，与保存被拒时的
   * 错误文案同一措辞）。由调用方（如 NodeConfigDialog）依据后端 action-document 的
   * unauthorized_source_apps 计算得出：模型的来源表引用了当前设计者无设计权限的应用即为 true。
   * 缺省 false，不影响既有调用方。 */
  readonly?: boolean;
  extraSystemVariables?: SystemVariableDef[];
  /**
   * 2026-08-15 追加：true=锁定来源——隐藏「①来源」面板的三处新增/关联入口
   * （SourceTreePicker 加来源表按钮、⋈ 表关联入口 qb-join-entry、逐行关联徽标 qb-join-badge-*），
   * 但**保留**已有来源行列表与其 × 移除按钮（存量越界来源要能看见、能清理，只是不能再新增/关联）。
   * 同时豁免 unlinkedAliases 对「确定」按钮的禁用判据——lockSources 态下用户既不能新建关联，若仍让
   * 未关联来源卡住 validity 就会死锁（既不能关联也不能确认），故视为无未关联项放行。
   * 缺省 false，不影响既有调用方。 */
  lockSources?: boolean;
  /**
   * 2026-08-18 追加（表格编辑器控件设置换轨内嵌本编辑器，纯加法）：true=①来源空态不渲染「隐式主表」
   * 占位行——调用方场景无「空来源=隐式查询本报表」语义（表格编辑器控件取数空来源=配置不完整
   * fail-closed）。缺省 false，不影响既有调用方。 */
  hideImplicitMain?: boolean;
  /**
   * true=③目标段不提供「暂存区」这一目标选项。缺省 false。
   *
   * 🔴 订正（2026-09-04）：本 prop 引入时的注释写着「V4 的填充目标只有数据表……暂存在 V4 里是
   * 来源侧概念」——**那是错的**。事实是当时 V4 两侧都不通：来源侧引擎早已贯通、只是取数文档层
   * 具名拒绝，目标侧则确实没建模。暂存区是「上一步写、下一步读」的管道，只有消费端没有生产端
   * 时管道是死的，不存在"只是来源侧概念"这回事。
   *
   * 暂存区补齐后 V4 两侧都支持（extractdoc 放行 kind=staging + 新增 staging_target），故取数
   * 配置面不再传 true。本 prop 保留，供确实需要收紧该选项的调用方使用。
   */
  hideStagingTarget?: boolean;
  /**
   * 2026-09-07 追加：宿主壳的文档级通知。与编辑器自身的语法三态 / 写模式定位条件
   * 拦截合成校验状态条**同一条** label——按最严重档着色，文案 = 状态词 + 各级计数 + 首条明细（超长省略），
   * 全部条目经点击 popover / title 悬浮展开，不再在编辑器外另起一块列表。取数配置面（记录控件插件）
   * 把收口/编译的逐条提示由此传入；缺省不传 = 状态条只显示语法三态，既有调用方零变化。 */
  notices?: ExpressionNotice[];
  lockConditionMode?: boolean;
  sourcePickerOptions?: {
    selectableKinds?: Array<'table' | 'view' | 'external'>;
    allowCrossApp?: boolean;
    disabledViews?: Array<{ appId?: string; viewId: string; reason: string }>;
  };
  /**
   * 2026-09-12 追加：分段编号偏移量。ExpressionEditor 内部各段
   * （写模式①目标/②来源/③条件、取数模式①来源/②条件/③目标等）的圆圈序号统一加上本值——调用方
   * 若在编辑器之外、之前另起了若干段（如视图设计器的"数据源"段），可借此让编号自然接续，不必
   * 在编辑器内部另开一套"从 N 开始"的特例。缺省 0，与改动前编号逐字一致。
   */
  segmentOffset?: number;
  disableSystemVariables?: boolean;
  /**
   * 2026-09-12 追加：列出的字段数据类型（如 'attachment'/'image'）
   * 在字段面板（FieldTreeDock）与快捷选择（QuickFieldPicker）里改为「显示但置灰、不可选」并带
   * 「暂不支持」提示，而不是（V4 现状）直接从来源字段树隐藏（见 ExpressionEditor.vue
   * sourceTreeFieldsFor 注释）。与 disableSystemVariables 同一 provide/inject 作用域注入通路
   * （见 host.ts ExpressionEditorScopeOptions；判定纯函数 isFieldTypeUnsupported 见
   * useExpressionContext.ts）。缺省空（未传）时维持 V4 既有隐藏行为，不影响既有调用方。
   */
  unsupportedFieldTypes?: string[];
  /**
   * 2026-09-12 追加：true 时不渲染包内自带的语法检查状态条。
   * 视图设计器自己在窗口左下角有一条合并了全部诊断的状态条，两条同时出现是重复信息。缺省
   * false（未传）时渲染行为与本 prop 上线前逐字节一致，既有调用方零改动。
   */
  hideStatusBar?: boolean;
}


/**
 * - `target-panel`（既有，2026-08-18）：存在时右栏渲染调用方内容替代内置目标/写目标段。
 * - `left-top`：存在时在左栏渲染——写模式①目标段之后、来源段之前，
 *   按内容自然高度撑开（flex:0 0 auto，同 .qb-write-target-panel 手法），不参与①②面板 2:3
 *   比例分配。典型消费方＝视图设计器，用它在来源/条件之上插入自定义的"数据源"选择区。
 *   不传时不渲染任何额外容器，DOM 与改动前逐字一致。插槽内容若要复用同款分段标题视觉，
 *   可直接使用本包导出的 .seg-title/.seg-n/.qb-panel 全局样式类（见 qb-segment.css）。
 */

export interface ExpressionEditorEmits {
  'update:modelValue': [value: ExpressionModel];
  'update:validity': [valid: boolean];
}
