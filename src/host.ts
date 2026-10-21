/**
 *
 * 组件通过 inject(EXPRESSION_HOST) 调用，不直连 HTTP。
 * 当前应用 appId 由宿主 adapter 闭包绑定；跨应用取数时相关方法可传可选 appId 尾参覆盖
 * （缺省 = 闭包应用，旧调用方行为不变）。
 * 注入缺失时组件抛错（不静默白屏）。
 */
import { computed, inject, provide, unref, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';
import jaJP from './locales/ja-JP';
import zhTW from './locales/zh-TW';
import type {
  Template,
  TemplateDataTable,
  TemplateField,
  ExpressionPreviewResult,
  ExpressionModel,
  ExpressionTreeNode,
  LowerTextRequest,
  LowerTextResult
} from './types';
// 目录载荷形状（type-only 跨引用，运行期擦除、无循环）。
import type { ExpressionCatalog } from './useExpressionContext';

/**
 * 图表目录条目：动作设计器④目标段「填充到图表」下拉的数据源。
 * 一一对应 表格编辑器插件 插件 capability `kimposheet.chart-catalog` 的返回形状（宿主端点透传，
 * 本包不解释图表内容，只做展示+选择）。
 */
export interface ChartCatalogEntry {
  chartId: string;
  chartType: string;
  /** 归一化数据形态：决定④段渲染哪一套映射槽位（categorySeries/nameValue/points）。 */
  chartForm: 'categorySeries' | 'nameValue' | 'points';
  title: string;
  /** 图表当前数据来源；仅 'pushed' 的图表会消费本目标注入的数据。 */
  source: 'static' | 'pushed' | 'range';
  sheetId: string;
  sheetName: string;
}

/**
 * 应用目录条目（跨应用取数）：来源添加器「其他应用」层级的数据源。
 * is_current=true 的条目是当前应用（其树已平铺在选择器顶层），选择器跳过不重复展示。
 */
export interface AppCatalogEntry {
  app_id: string;
  app_name: string;
  is_current?: boolean;
}

/**
 * 视图目录条目：
 * 来源添加器渲染视图叶子时据此标注「常规/组合」类型图标 + 「· N 列」（column_count）；ExpressionEditor
 * 来源行为已加入的视图来源展示同一档类型标签/列数（见 useExpressionContext.ts ensureViewMeta）。
 * status 预留（如视图停用/草稿态过滤），本次两处消费方均不读取。
 */
export interface ViewCatalogEntry {
  view_id: string;
  view_name: string;
  view_type: 'regular' | 'combined';
  column_count?: number;
  status?: string;
}

export interface ExpressionHost {
  /** 列出应用内全部模板（opts.recursive=true 递归拉全部节点下的模板）。 */
  listTemplates(opts?: { recursive?: boolean }): Promise<Template[]>;
  /**
   * 列出当前用户可选的应用清单（跨应用取数，可选方法）：来源添加器据此在树中挂「其他应用」节点。
   * 旧宿主桥（如 表格编辑器插件 字段控件管道）未实现 = 不支持跨应用，选择器维持单应用行为。
   */
  listApps?(): Promise<AppCatalogEntry[]>;
  /**
   * 列出某应用的视图目录：来源添加器据此在应用子树里给视图叶子标注
   * 「常规视图 · N 列」/「组合视图 · N 列」；ExpressionEditor 来源行对已加入的视图来源展示同一档
   * 类型标签/列数（见 useExpressionContext.ts ensureViewMeta，appId 缺省=当前应用）。旧宿主桥未实现
   * 该方法 = 视图叶子/来源行一律回落既有通用「视图」标签、不显示列数，不阻断编辑器其余功能
   * （容错范式同 listApps/fetchTree）。appId 可选（跨应用取数）：传其他应用 ID 时拉该应用的视图目录；
   * 缺省 = 当前应用。
   */
  listViews?(appId?: string): Promise<ViewCatalogEntry[]>;
  /** 拉取应用真实层级树（目录 category / 资源 resource）。来源选择器据此按层级+顺序渲染、区分目录/模板图标。
   *  可选：旧宿主桥（如 表格编辑器插件 字段控件管道）未实现时，来源选择器回落扁平分组（listTemplates）。
   *  appId 可选（跨应用取数）：传其他应用 ID 时拉该应用的树；缺省 = 当前应用（旧行为不变）。 */
  fetchTree?(appId?: string): Promise<ExpressionTreeNode>;
  /** 列出某模板下的数据表列表。appId 可选（跨应用取数）：缺省 = 当前应用。 */
  listTables(templateId: string, appId?: string): Promise<TemplateDataTable[]>;
  /** 列出某表的字段列表。appId 可选（跨应用取数）：缺省 = 当前应用。 */
  listFields(templateId: string, dataTableId: string, appId?: string): Promise<TemplateField[]>;
  /** 编译预览：dry-run 编译表达式模型，返回 SQL 或错误（不执行）。
   *  stagingSchema（Phase B，动作暂存区，可选第三参，向后兼容）：当前节点「上一步暂存区」的列 schema，
   *  供后端据 source_type='staging' 来源表 / target_kind='staging' 暂存目标解析列引用、编译预览。
   *  未传（旧宿主桥实现 / 当前节点无暂存来源）= 行为不变，实现方缺参时自然忽略。 */
  compilePreview(
    templateId: string,
    model: ExpressionModel,
    stagingSchema?: Array<{ name: string; field_id: string; kind: string }>
  ): Promise<ExpressionPreviewResult>;
  /**
   * 文本表达式降级：把文本模式里的一段原文 + 按序引用绑定送宿主端点
   * `POST …/action-system/expression/lower-text`，降级为既有结构化节点（ValueRef / ConditionGroup）
   * + text_source sidecar。纯句法、不连库、不核字段存在性（那是保存闸的事）。
   *
   * 🔴 **必需方法**（硬切换口径，不是可选）：文本模式确认路径唯一依赖它。旧宿主桥未实现时编辑器
   * 不静默——文本模式入口禁用并显示 `dialog.textModeUnavailable` 提示（见 hostSupportsLowerText）。
   */
  lowerText(req: LowerTextRequest): Promise<LowerTextResult>;
  /**
   * 拉取宿主只读目录（系统变量 / 函数 / 开窗函数）。宿主静态数据、按请求 locale 解析 label。
   * 前端据此替换硬编码常量；失败时编辑器回落包内 fallback 常量（见 useExpressionContext）。
   */
  loadCatalog(): Promise<ExpressionCatalog>;
  /**
   * 拉取某模板的图表目录：动作设计器④段「填充到图表」
   * 选择器据此列出可选图表。未实现该方法或返回空数组 = 目录不可用，UI 按「未检测到图表」处理
   *，不阻断表达式编辑器其余功能。
   */
  fetchChartCatalog?(templateId: string): Promise<ChartCatalogEntry[]>;
  /**
   * 拉取某视图的输出列 schema（views-extraction-b3，可选方法）：取数来源段选择「视图」后，字段面板
   * /标签渲染据此列出视图输出列 / 显示视图名。旧宿主桥未实现该方法时视为「不支持视图字段目录」——
   * 视图来源仍可显示（裸 view_id 回落），字段列表为空，不抛错（见 useExpressionContext
   * ensureViewFields 的容错分支），保证旧宿主不炸。
   *
   * appId 可选：传其他应用 ID 时向该应用拉取该视图
   * schema；缺省 = 当前应用，与本方法引入时的既有单参调用完全等价。
   */
  getViewSchema?(viewId: string, appId?: string): Promise<{
    view_name: string;
    columns: Array<{ code: string; name: string; type: string }>;
  }>;
  /**
   * 拉取某外部数据表的登记 schema：取数来源段
   * 选择「外部数据表」后，字段面板/标签渲染据此列出可用列 / 显示对象展示名。旧宿主桥未实现该方法时
   * 视为「不支持读取外部表字段」——来源仍可显示（裸 object_id 回落），字段列表为空，不抛错（见
   * useExpressionContext ensureExternalFields 的容错分支），保证旧宿主不炸（范式同 getViewSchema）。
   * access_mode：'usable'（可用列，设计器可见）| 'filter_only'（仅供服务端边界使用，本包过滤掉，
   * 永不进入字段列表/快捷选取——安全恒绿探针断言此点）。
   */
  getExternalSchema?(objectId: string): Promise<{
    object_name: string;
    columns: Array<{ code: string; name: string; type: string; access_mode: 'usable' | 'filter_only'; timezone_semantic?: string }>;
  }>;
  /** 可选通知接口（缺省回退组件内 useMessage）。 */
  notify?: {
    success(m: string): void;
    error(m: string): void;
    warning?(m: string): void;
  };
  /**
   * 可选翻译函数：**完全接管**本包文案（优先级最高）。
   * 仅在宿主确实持有本包全部 key 的译文时才实现——宿主若只有部分 key，缺失项会返回空串或 key，
   * 反而不如包内词表。一般场景请改用下方 locale（宿主只告知语言，词表仍由包自带）。
   */
  t?: (key: string, args?: Record<string, unknown>) => string;
  /**
   * 可选当前语言（BCP-47，如 'zh-CN' / 'en-US' / 'ja-JP' / 'zh-TW'）。
   *
   * 这是宿主接入多语言的**推荐方式**：宿主只回答"现在是什么语言"，翻译仍走包内词表——
   * 既不要求宿主搬运本包的两百多条 key，也让 en-US.ts 等语言包真正生效
   * （此前 createWebExpressionHost 既未实现 t 也无从告知语言，导致本包恒显中文、en-US.ts 是死代码）。
   *
   * 声明为函数而非字面量：宿主语言是运行时可切换的响应式状态，取函数才能每次求值拿到当前值
   * （同 ExpressionHost 其余方法一律取函数、不取快照的既定风格）。
   */
  locale?: () => string;
  /**
   *
   * 为什么走 host 注入而不是包内直接读 localStorage：包内不能反向依赖宿主的 @/utils/storage
   * （app 侧封装，带 VITE_STORAGE_PREFIX 前缀与强类型 key 约束，packages/ 引不到）。本包既定范式是
   * 「一切外部能力经 ExpressionHost 注入」（同 notify/t/locale），持久化照此办理，不另开口子。
   */
  loadEditorPrefs?(): EditorPrefs | null;
  /** 可选：保存编辑器窗口/分栏的持久化偏好（理由同 loadEditorPrefs）。未实现 = 不持久化，编辑器每次按默认尺寸打开。 */
  saveEditorPrefs?(prefs: EditorPrefs): void;
}

/**
 *
 * 🔴 顶层两项属于**外层四段式编辑器** ExpressionEditor.vue；单表达式子弹窗
 * AdvancedExpressionDialog.vue 的同名维度另开 `advanced` 命名空间——两者是父子关系（子弹窗由
 * 外层③目标段的 ƒ 入口与②条件段表达式模式唤起），同一次会话里可能先后打开，共用一组键会互相
 * 覆盖尺寸记忆（用户调大了子弹窗，回到外层发现外层也被撑大）。
 */
export interface EditorPrefs {
  /** 编辑器弹窗宽度（px）。 */
  width?: number;
  /** 编辑器弹窗高度（px）。 */
  height?: number;
  /** 窗口相对 CSS 视口的尺寸记忆（旧像素值仍兼容读取）。 */
  wr?: number;
  hr?: number;
  /** 单表达式子弹窗（AdvancedExpressionDialog）的独立几何记忆，键义同上两项。 */
  advanced?: {
    width?: number;
    height?: number;
    /** 窗口相对 CSS 视口的尺寸记忆（旧像素值仍兼容读取）。 */
    wr?: number;
    hr?: number;
  };
  /** 来源树选择弹窗的独立几何记忆。 */
  sourcePicker?: {
    width?: number;
    height?: number;
    /** 窗口相对 CSS 视口的尺寸记忆（旧像素值仍兼容读取）。 */
    wr?: number;
    hr?: number;
  };
  /** 筛选条件编辑弹窗（ConditionEditorDialog）的独立几何记忆。
   *  与 advanced 分开命名空间，理由同上：两者可在同一次会话里先后打开，共用键会互相覆盖。 */
  condition?: {
    width?: number;
    height?: number;
    /** 窗口相对 CSS 视口的尺寸记忆（旧像素值仍兼容读取）。 */
    wr?: number;
    hr?: number;
  };
}

/**
 * 字段引用的书写语法（UI 换轨新增）。
 *
 * 'braces'（缺省，3.4 既有全部场景）：字段引用写作 `{表.字段}`，前端自己做「文本 ⇄ refs」往返
 *   （见 textSource.ts 的 buildLowerTextRefs/restoreTextFromSource）。
 * 'brackets'（表达式引擎 V4 取数场景）：字段引用写作 `[表].[字段]`（WORKFINE 方言，服务端 v4/bind
 *   的唯一认可语法），往返由服务端 tokenize/restore 负责，前端不参与。
 *
 * 只影响「点字段树往编辑区插入时写什么」这一处——轻量语法检查早已按 `[…]` 整段跳过处理
 * （见 syntaxCheck.ts 头注释），花括号往返在无 `{…}` 的文本上自然空转，故两种语法可并存。
 */
export type RefSyntax = 'braces' | 'brackets';

/** 字段引用语法的注入键。未 provide 时一律 'braces'——既有调用方零改动。 */
export const REF_SYNTAX: InjectionKey<RefSyntax> = Symbol('kimpo.expression.ref-syntax');

/** 声明本子树使用的字段引用语法（V4 取数配置面 provide 'brackets'）。 */
export function provideRefSyntax(syntax: RefSyntax): void {
  provide(REF_SYNTAX, syntax);
}

/** 读取当前子树的字段引用语法，缺省 'braces'。 */
export function useRefSyntax(): RefSyntax {
  return inject(REF_SYNTAX, 'braces');
}

/**
 * 系统变量在当前语法下的文本标记解析口。
 * V4（brackets）文本里系统变量不是字段引用，写法是语言包登记的**无引号点路径**（zh `系统变量.当前时间`、
 * en `system.current_time`，由服务端 alice/locale 的 ctx.* 词条决定），`[当前时间]` 这种带方括号的写法会被
 * 当成裸字段查找而解析失败。这份「host_var_id → 文本片段」映射只有 V4 目录（system_variables[].snippet_*）
 * 知道，故由配置面 provide；未 provide 时解析器恒返回 undefined，调用方自行回退。
 */
export type SystemVariableTokenResolver = (varId: string) => string | undefined;

export const SYSTEM_VARIABLE_TOKEN: InjectionKey<SystemVariableTokenResolver> = Symbol('kimpo.expression.system-variable-token');

/** 声明本子树的系统变量文本标记解析口（V4 取数配置面按目录 system_variables 提供）。 */
export function provideSystemVariableToken(resolver: SystemVariableTokenResolver): void {
  provide(SYSTEM_VARIABLE_TOKEN, resolver);
}

/** 读取当前子树的系统变量文本标记解析口，缺省恒 undefined。 */
export function useSystemVariableToken(): SystemVariableTokenResolver {
  return inject(SYSTEM_VARIABLE_TOKEN, () => undefined);
}

export const EXPRESSION_HOST: InjectionKey<ExpressionHost> = Symbol('expression-host');

/** 在 setup 上下文中提供 ExpressionHost。通常由父容器（NodeConfigDialog 等）调用。 */
export function provideExpressionHost(host: ExpressionHost): void {
  provide(EXPRESSION_HOST, host);
}

/**
 * 写模式「引用即入源」候选池表的即时登记回调。
 *
 * ExpressionEditor.vue 在 setup 顶层 provide 一份实现：扫描传入文本，命中候选池表显示名即调用写模式
 * 的 update() 把该表正式登记进 model.source.tables（is_write_target 打标，与 reconcileWriteTargetSources
 * 同一登记口径），并让本次调和的自动 record_id 关联一并生效；未命中/非写模式/无候选池返回 false，
 * 调用方据此判断是否需要等一轮 Vue 响应式刷新（nextTick）再重试 lowerText。
 *
 * 若用户最终没有真正确认这条引用（取消弹窗/又删掉了这段文本），下一次正常 update() 触发的
 * reconcileWriteTargetSources 会按"未引用"把这条投机登记的来源剔除，不会遗留脏数据——本回调只是把
 * 登记时机提前，不改变最终是否登记的判据。
 *
 * 未 provide 时 useWriteTargetPoolTouch() 返回 null（取数模式/judge 模式等非写目标场景，或调用方
 * 未挂在 ExpressionEditor 子树内——如独立单测/Storybook），AdvancedExpressionPanel 据此跳过整段逻辑，
 * 行为与改造前一致。
 */
export type WriteTargetPoolTouch = (text: string) => boolean;

export const WRITE_TARGET_POOL_TOUCH: InjectionKey<WriteTargetPoolTouch> = Symbol('kimpo.expression.write-target-pool-touch');

/** ExpressionEditor.vue 在 setup 顶层调用，声明本子树的候选池表即时登记回调。 */
export function provideWriteTargetPoolTouch(fn: WriteTargetPoolTouch): void {
  provide(WRITE_TARGET_POOL_TOUCH, fn);
}

/** 读取当前子树的候选池表即时登记回调，缺省 null（见上方类型注释「未 provide 时」）。 */
export function useWriteTargetPoolTouch(): WriteTargetPoolTouch | null {
  return inject(WRITE_TARGET_POOL_TOUCH, null);
}

/**
 *
 * disableSystemVariables/unsupportedFieldTypes 均可传 Ref 或裸值：ExpressionEditor.vue 用从自身
 * props 派生的 computed 传入，注入端读到的是活的响应式引用，prop 变化即时反映到子树消费方；
 * 宿主页面若脱离 ExpressionEditor 单独使用 ExpressionInput（如某些嵌入场景），也可在页面/容器根
 * 自行 provide 一份裸值选项（对外由 index.ts 导出 provideExpressionEditorScopeOptions）。
 */
export interface ExpressionEditorScopeOptions {
  /** true=字段面板（FieldTreeDock）/快捷选择（QuickFieldPicker）不提供任何系统变量入口。 */
  disableSystemVariables: Ref<boolean> | boolean;
  /** 命中的字段数据类型在字段面板/快捷选择里改为置灰、不可选（带提示），而不是整体隐藏。 */
  unsupportedFieldTypes: Ref<string[]> | string[];
}

export const EXPRESSION_EDITOR_SCOPE_OPTIONS: InjectionKey<ExpressionEditorScopeOptions> = Symbol(
  'kimpo.expression.editor-scope-options'
);

/** ExpressionEditor.vue 在 setup 顶层调用，声明本子树的作用域选项。 */
export function provideExpressionEditorScopeOptions(opts: ExpressionEditorScopeOptions): void {
  provide(EXPRESSION_EDITOR_SCOPE_OPTIONS, opts);
}

/**
 * 读取当前子树的作用域选项（FieldTreeDock.vue/QuickFieldPicker.vue 等消费方调用）；未 provide 时
 * 返回缺省值——不禁用系统变量、空置灰名单，既有调用方（未使用这两个新 prop 的场景，或脱离
 * ExpressionEditor 独立挂载于单测/其它宿主）零改动、零行为差异。返回值统一包成 ComputedRef——
 * 无论调用方传入的是裸值还是 Ref，消费方读 `.value` 都能保持响应式，不必自行分支处理两种入参形态。
 */
export function useExpressionEditorScopeOptions(): {
  disableSystemVariables: ComputedRef<boolean>;
  unsupportedFieldTypes: ComputedRef<string[]>;
} {
  const injected = inject(EXPRESSION_EDITOR_SCOPE_OPTIONS, null);
  return {
    disableSystemVariables: computed(() => (injected ? !!unref(injected.disableSystemVariables) : false)),
    unsupportedFieldTypes: computed(() => (injected ? unref(injected.unsupportedFieldTypes) : []))
  };
}

/**
 * 组件内获取 ExpressionHost，缺失时抛错。
 * 只能在 setup() 顶层调用（Vue injection 约束）。
 */
export function useExpressionHost(): ExpressionHost {
  const host = inject(EXPRESSION_HOST);
  if (!host) {
    throw new Error(
      '[expression-editor] EXPRESSION_HOST not provided. ' +
        '请在父组件调用 provideExpressionHost(createWebExpressionHost(appId)) 后再挂载表达式编辑器。'
    );
  }
  return host;
}

/**
 * 宿主是否真的实现了 lowerText。类型上它是必需方法，但本包会被插件以 file: 拷贝
 * 内嵌、由各自的宿主桥注入——旧桥（未重建的插件 bundle / 插件单测假桩）在运行期就是没有这个方法。
 * 文本模式入口据此禁用并提示，而不是点确认时才以 TypeError 炸掉（"不静默、也不炸"）。
 * host 允许为 null：AdvancedExpressionPanel 等面板用 inject(…, null) 取宿主（表格编辑器字段控件等调用方
 * 不保证提供 ExpressionHost）。
 */
export function hostSupportsLowerText(host: ExpressionHost | null | undefined): host is ExpressionHost {
  return !!host && typeof (host as Partial<ExpressionHost>).lowerText === 'function';
}

/**
 * 包内词表登记处：新增语言只需在此挂一条（键为 BCP-47）。
 * 四语言与宿主保持一致（宿主 zh-CN/en-US 内联 + 仓库根 i18n-packs/{ja-JP,zh-TW}.json 运行时包）。
 */
const LOCALE_TABLES: Record<string, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  'en-US': enUS as Record<string, string>,
  'ja-JP': jaJP as Record<string, string>,
  'zh-TW': zhTW as Record<string, string>
};

/**
 * 按 BCP-47 选包内词表，三级匹配：
 * 1. 精确命中（zh-CN / en-US / ja-JP / zh-TW）；
 * 2. 中文按**字形**回退——繁体区（TW/HK/MO 或 Hant 子标签）走 zh-TW，其余中文走 zh-CN。
 *    不能只按 `zh` 前缀取第一张表：zh-HK 是繁体使用地区，回落简体属于错误本地化；
 * 3. 其余语言按主语言回退（en-GB → en-US），仍无命中则回中文（本包默认语言），
 *    保证任何未知语言都不会退化成裸 key。
 *
 * 导出供单测直接验证选表规则（useT 依赖 Vue inject，纯逻辑单独暴露更好测）。
 */
export function pickLocaleTable(locale: string | undefined): Record<string, string> {
  if (!locale) return LOCALE_TABLES['zh-CN'];
  if (LOCALE_TABLES[locale]) return LOCALE_TABLES[locale];

  const lower = locale.toLowerCase();
  const lang = lower.split('-')[0];

  if (lang === 'zh') {
    const traditional = /(^|-)(tw|hk|mo|hant)(-|$)/.test(lower);
    return traditional ? LOCALE_TABLES['zh-TW'] : LOCALE_TABLES['zh-CN'];
  }

  const fallbackKey = Object.keys(LOCALE_TABLES).find(k => k.split('-')[0]?.toLowerCase() === lang);
  return fallbackKey ? LOCALE_TABLES[fallbackKey] : LOCALE_TABLES['zh-CN'];
}

/**
 * 返回一个 t(key, args?) 翻译函数，三级回退：
 *   host.t（宿主完全接管，仅在宿主持有全部 key 时用）
 *   → 按 host.locale() 选中的包内词表（**推荐路径**：宿主只告知语言）
 *   → 包内 zh-CN → key 本身。
 *
 * 每次调用都重新求值 host.locale()，故宿主切换语言后组件重渲即跟随，无需重挂载。
 */
export function useT(): (key: string, args?: Record<string, unknown>) => string {
  // inject 加 null 默认值，避免在非 host 提供的环境下抛错（如 Storybook / 单测）
  const host = inject(EXPRESSION_HOST, null);
  return (key: string, args?: Record<string, unknown>) => {
    if (host?.t) return host.t(key, args);
    const table = pickLocaleTable(host?.locale?.());
    return table[key] ?? (zhCN as Record<string, string>)[key] ?? key;
  };
}
