<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMessage } from 'naive-ui';
import type { TextSourceRef, ConditionGroup, LowerTextDiagnostic, LowerTextPurpose, LowerTextRequest, LowerTextResult, TextSource, ValueRef } from './types';
import { isLowerTextSuccess } from './types';
import FieldTreeDock from './FieldTreeDock.vue';
import OperatorFunctionBar from './OperatorFunctionBar.vue';
import { serializeToText, type SourceTableLite, type FormTableLite } from './rawSerialize';
import { stagingSourceToSourceTableLite, type StagingSourceLite } from './stagingSourceLite';
import { buildDockColumnsFromLite, type DockColumnsBundle } from './dockColumns';
import { checkExpressionSyntax, type SyntaxIssue } from './syntaxCheck';
import SyntaxStatusLine, { type SyntaxStatusState } from './SyntaxStatusLine.vue';
import {
  textPackLangOf,
  textFunctionCatalog,
  useTextFunctionCatalog,
  type FunctionCatalogCategory,
  type FunctionCatalogItem
} from './functionCatalog';
import { buildLowerTextRefs, labelOfTextRef, resolveTextLabel, restoreTextFromSource, runeToUtf16Index } from './textSource';
import { isCompareOperatorAvailable, systemVariablesCatalog } from './useExpressionContext';
import { useResizableSplit } from './useResizableSplit';
import ExpressionSqlEditor from './ExpressionSqlEditor.vue';
import { EXPRESSION_HOST, hostSupportsLowerText, useRefSyntax, useSystemVariableToken, useT, useWriteTargetPoolTouch } from './host';
import { valueRefToBracketText } from './bracketText';
import { buildReferenceCandidates } from './kimpoSqlRefCompletion';
import { instanceSuffix, isReportContextAlias } from './rawSerialize';
import { tableColorClassFor } from './tableThemeColors';
import { aliasOf } from './kimpoSqlCompletion';

/**
 * 表达式编辑主体（F2：从 AdvancedExpressionDialog.vue 纯搬移抽出，供其与 ConditionEditorDialog.vue
 * 表达式模式共享）——树坞双栏 + 运算符/函数条 + 文本编辑区 + 底部说明，即原弹窗的 body 部分。
 * AdvancedExpressionDialog.vue 改为「壳（几何/标题/footer）+ 本面板」；ConditionEditorDialog.vue
 * 表达式模式 body 直接内嵌本面板，替代原先"点击才弹出编辑器"的 ExpressionInput 中转
 *。
 * - `show`：宿主把"这次编辑会话是否已打开"透传进来，本面板据此在**打开那一刻**（false→true
 *   过渡，或组件创建时 show 已为 true——见下方 watch 的 immediate:true 说明）把 modelValue
 *   拍平进文本编辑区；show 变 false 时清掉未触发的防抖检查计时器（原壳 close() 的职责收拢到这里，
 *   因为计时器状态本就是本面板的私有实现细节）。
 * - `shellHeight`：旧宿主首帧的可选兜底；挂载后观察面板自身内容盒子，低高度采用左右布局。
 * - confirm 事件：本面板校验通过才 emit，宿主监听后自行决定"回写父级 + 关闭"（原 confirm() 末尾
 *   的 close() 调用挪到宿主，因为"关闭整个弹窗"是壳的职责，本面板不持有 show 的写权）。
 */
/*
 *   - 确认时把文本 + 按序 {…} 引用绑定送 host.lowerText（宿主 lower-text 端点）降级成既有结构化节点
 *     + text_source sidecar：purpose='value' 时 emit confirm(ValueRef，自带 text_source)；
 *     purpose='where' 时 emit confirmWhere({condition, textSource})；
 *   - 重开时节点/组带 text_source → 文本 = 原文经 restoreTextFromSource 按稳定 ID 重绘字段名；
 *     文本未改直接确认 → 跳过重新降级（value：原节点原样回抛；where：emit confirmUnchanged）；
 *   - 防抖检查改为：本地轻检查（括号/标记）秒出 → 再调 host.lowerText 做真实检查，服务端诊断
 *     （已本地化的 message + rune 偏移）显示在文本框下方并选中出错片段；
 *   - 宿主桥未实现 lowerText（旧插件 bundle）→ 文本框禁用 + 提示，确认按钮禁用，不静默。
 */
const props = defineProps<{
  show: boolean;
  modelValue: ValueRef | null;
  /** 本次文本的用途：value=取值根（输出列/填值，缺省）；where=谓词根（整段 WHERE）。 */
  purpose?: LowerTextPurpose;
  /** purpose='where' 时的既有 sidecar（model.where_text_source）：有它就按原文恢复文本模式显示；
   *  无它（引导式构建的 where 或空）则从空文本开始——不从结构化条件组反推文本。 */
  textSource?: TextSource | null;
  sourceTables: SourceTableLite[];
  formTables: FormTableLite[];
  stagingSource?: StagingSourceLite | null;
  /** 可选：父级已按模板归属精确分组好的树坞列，透传给 FieldTreeDock；未传时从 Lite 形态降级构造
   *  （见 dockColumnsResolved）。 */
  dockColumns?: DockColumnsBundle;
  /** 兼容旧宿主首帧的可选外壳高度（px）；挂载后以面板自身实测内容盒子为准。 */
  shellHeight?: number;
  /** 是否隐藏文本框下方的常驻说明；ConditionEditorDialog 的紧凑布局开启，独立高级表达式弹窗保留。 */
  hidePersistentHints?: boolean;
  /** 条件弹窗专用：函数横条仅展示九个常用项，其余函数收进按类型分组的「更多」面板。 */
  compactFunctionBar?: boolean;
  /** 空文本确认时的产出口径（经 AdvancedExpressionDialog 透传自 ExpressionEditor.vue 填充字段/
   *  写模式字段映射行）：true=不填充占位 {kind:'const'}（value 键缺省）；缺省 false=空字符串常量
   *  {kind:'const', value:''}——与 ConditionTree.emptyRef() 的空串占位语义一致，条件树入口不传即
   *  不受影响。见下方 confirm() 空文本分支。 */
  emptyAsUnconfigured?: boolean;
  /** 语法检查状态条的落位：inline（缺省）＝编辑区文本框下方；external＝本面板不
   *  渲染，由宿主壳从 defineExpose 的 syntaxState/syntaxLabel/syntaxDetail/focusIssue 自行摆放
   *  （ConditionEditorDialog 把它并进页脚、与「确定/取消」同一行靠左）。 */
  syntaxStatusPlacement?: 'inline' | 'external';
}>();
const emit = defineEmits<{
  /** purpose='value'：降级后的 ValueRef（自带 text_source）；文本未改时原样回抛 props.modelValue。 */
  confirm: [v: ValueRef];
  /** purpose='where'：降级后的条件组 + sidecar；文本清空时两者皆 null（= 清除条件）。 */
  confirmWhere: [payload: { condition: ConditionGroup | null; textSource: TextSource | null }];
  /** purpose='where' 且文本未改：宿主保留既有 where + where_text_source 对，不重新降级。 */
  confirmUnchanged: [];
}>();

const t = useT();
const message = useMessage();
const purpose = computed<LowerTextPurpose>(() => props.purpose ?? 'value');
/** 系统变量目录（响应式）：文本里系统变量写成 {目录标签}，解析/重绘都要它。 */
const systemVars = systemVariablesCatalog;
const sourceTablesResolved = computed<SourceTableLite[]>(() =>
  props.stagingSource?.columns.length ? [...props.sourceTables, stagingSourceToSourceTableLite(props.stagingSource)] : props.sourceTables
);
/** 树坞列：优先用宿主已算好的精确分组（props.dockColumns），未传时从 Lite 形态降级构造
 *  （一张显式来源表单独成一列，当前模板列头回退 FieldTreePanel 既有「本报表」tab 同一文案）。 */
const dockColumnsResolved = computed<DockColumnsBundle>(
  () => props.dockColumns ?? buildDockColumnsFromLite(sourceTablesResolved.value, props.formTables, t('drawer.tabForm'))
);

const text = ref('');
const initialText = ref('');
const dirty = computed(() => text.value !== initialText.value);
/** 编辑区实例（ExpressionSqlEditor 暴露 insertAtCursor / focusRange / focus）。 */
const taRef = ref<InstanceType<typeof ExpressionSqlEditor> | null>(null);
const dockRef = ref<InstanceType<typeof FieldTreeDock> | null>(null);
const selectedFunction = ref<FunctionCatalogItem | null>(null);
/** 条件弹窗函数横条的九个常用项，顺序即产品指定顺序；完整目录仍由 functionCatalog.ts 持有。 */
const COMMON_FUNCTION_KEYS = new Set(['sum', 'count', 'avg', 'min', 'max', 'concat', 'round', 'len', 'trim']);
const FUNCTION_CATEGORY_ORDER: readonly FunctionCatalogCategory[] = [
  'aggregate',
  'numeric',
  'text',
  'dateTime',
  'conditional'
];
const FUNCTION_CATEGORY_LABEL_KEYS: Record<FunctionCatalogCategory, string> = {
  aggregate: 'operatorBar.categoryAggregate',
  numeric: 'operatorBar.categoryNumeric',
  text: 'operatorBar.categoryText',
  dateTime: 'operatorBar.categoryDateTime',
  conditional: 'operatorBar.categoryConditional'
};
const reactiveTextFunctionCatalog = useTextFunctionCatalog();
/** 着色用的字段/变量类型表：来自 sidecar 的 refs（服务端 tokenize 产出，带 kind 与显示标签）。 */
/** 最近一次真实检查成功带回的引用绑定（label 即 `[表].[字段]` 文本）。与打开时的 sidecar refs 合并喂给
 *  编辑区做类型着色——否则用户新敲进去的引用在重新打开之前一直是通用引用色。
 *  检查失败不清空：旧绑定仍是「上一次合法状态」的事实，比什么都没有强。 */
const checkedRefs = ref<TextSourceRef[]>([]);
const highlightRefs = computed(() =>
  [...(initialSource.value?.refs ?? []), ...checkedRefs.value].map(r => ({
    kind: (r as { kind?: string }).kind,
    last_label: (r as { last_label?: string }).last_label,
    label: r.label
  }))
);
/**
 * 波浪线区间：服务端诊断的 rune 下标换算成 UTF-16（编辑器坐标系）。本地轻检查只有单点下标，
 * 画一个 1 字符宽的区间，够指出位置。
 */
const editorErrorRanges = computed(() => {
  const ranges: Array<{ from: number; to: number; message?: string }> = [];
  const len = text.value.length;
  for (const d of diagnostics.value) {
    let from = Math.min(runeToUtf16Index(text.value, d.rune_start), len);
    let to = Math.min(Math.max(from, runeToUtf16Index(text.value, d.rune_end)), len);
    // 零宽诊断（典型：「缺少操作数」落在文末，rune_start==rune_end）：mark 装饰画不出零宽区间，
    // 退一格画在紧邻的那个字符上（文末则画最后一个字符），让用户看得见出错位置。
    if (to <= from) {
      if (from < len) to = from + 1;
      else if (len > 0) { from = len - 1; to = len; }
    }
    if (to > from) ranges.push({ from, to, message: d.message });
  }
  if (!ranges.length && syntaxIssue.value) {
    const from = Math.min(syntaxIssue.value.index, text.value.length);
    ranges.push({ from, to: Math.min(from + 1, text.value.length) });
  }
  return ranges;
});
/** 函数补全项：整份目录（不止横条那九个常用项——补全的价值正是覆盖记不住的长尾）。 */
/** 函数英文规范名（按 key 取英文包别名）：任何界面语言下都作为补全的常驻匹配键（见 kimpoSqlCompletion.ts
 *  CompletionFunctionItem.aliases 注释）；只匹配不插入，插入仍是当前语言的 snip。 */
const ENGLISH_FUNCTION_ALIAS = new Map(textFunctionCatalog('en').map(fn => [fn.key, aliasOf(fn.snip)] as const));
const completionFunctions = computed(() =>
  reactiveTextFunctionCatalog.value.map(fn => {
    const en = ENGLISH_FUNCTION_ALIAS.get(fn.key);
    return { snip: fn.snip, label: t(fn.labelKey), detail: t(fn.descKey), aliases: en ? [en] : [] };
  })
);
/** 表显示名（文本里 `[表]` 的写法，与候选片段同一口径）→ 表主题色类：编辑区把 `[表].[字段]` 的表段按此实底着色。 */
const tableClasses = computed(() => {
  const map = new Map<string, string>();
  for (const source of sourceTablesResolved.value) {
    if (isReportContextAlias(source.alias)) continue;
    // Phase B 暂存来源不产出 `[产出名].[列]` 形态的文本（保留前缀 暂存表.[列]，见 bracketText.
    // stagingBracketToken），这里按「来源显示名」建的索引永远不会被 ExpressionSqlEditor 的 tok.table
    // 命中，登记了也是死条目——跳过，避免误导（暂存表段的着色走 tok.staging 分支，见该组件注释）。
    if (source.dataTableId === '__staging__') continue;
    const cls = tableColorClassFor(source.alias, sourceTablesResolved.value);
    if (cls) map.set(`${source.name}${instanceSuffix(source.alias, source.dataTableId, sourceTablesResolved.value)}`, cls);
  }
  return map;
});
/** 引用补全候选：显式来源字段 + 本报表字段 + 系统变量，片段与 ⊞/ƒ 拾取同一份口径
 *  （bracketText），分组文案走语言包。systemVariableToken 在下方声明，computed 惰性求值故可前置引用。 */
const referenceCandidates = computed(() =>
  buildReferenceCandidates(
    refSyntax,
    sourceTablesResolved.value,
    props.formTables,
    systemVars.value,
    { source: t('completion.sourceGroup'), report: t('completion.reportGroup'), variable: t('completion.variableGroup') },
    { systemVariableToken }
  )
);
/** 仅紧凑模式整体替换横条目录；非条件弹窗传 undefined，OperatorFunctionBar 继续展示完整默认目录。 */
const compactFunctionItems = computed(() => {
  if (!useCompactFunctions.value) return undefined;
  return reactiveTextFunctionCatalog.value
    .filter(fn => COMMON_FUNCTION_KEYS.has(fn.key))
    .map(fn => ({ label: t(fn.labelKey), snip: fn.snip }));
});
/** 「更多」只收纳九个常用项之外的函数，并按目录自带类型稳定分组。 */
const moreFunctionGroups = computed(() =>
  FUNCTION_CATEGORY_ORDER.map(category => ({
    category,
    labelKey: FUNCTION_CATEGORY_LABEL_KEYS[category],
    items: reactiveTextFunctionCatalog.value.filter(fn => !COMMON_FUNCTION_KEYS.has(fn.key) && fn.category === category)
  })).filter(group => group.items.length > 0)
);
const moreFunctionsOpen = ref(false);

// —— 树区/编辑区上下分栏——
//
// host 用 inject(…, null) 取而非 useExpressionHost()：后者在缺 provider 时**抛错**，而本面板还会被
// 表格编辑器字段控件、视图过滤等独立调用方使用，那些场景不保证提供 ExpressionHost。持久化是可选增强，
// 拿不到 host 就退化成"每次按默认比例打开"，不能因此让整个编辑器挂掉。
const host = inject(EXPRESSION_HOST, null);
/** 宿主是否实现 lowerText：否则文本模式不可用——文本框禁用、确认禁用、显示提示。 */
const lowerTextAvailable = computed(() => hostSupportsLowerText(host));
const writeTargetPoolTouch = useWriteTargetPoolTouch();
/**
 * 服务端校验（lowerText）前的一次性"提前登记"：把当前文本交给 touch 回调扫描，命中候选池表引用
 * 时它会立即把该表注册进父级模型（is_write_target），但注册本身要经一轮 Vue 响应式刷新才能传到
 * 宿主的作用域信封（setScope）——故命中后 `await nextTick()` 两次（同批常见"跨组件树响应式传播"
 * 等待惯例，见 expressionEditorWriteTargetFirst.spec.ts flushMounted 同类写法）再让调用方发起真正
 * 的 lowerText，否则本轮请求仍会带着"还没这张表"的旧作用域，白等一轮响应式刷新却没用上。 */
async function ensureWriteTargetPoolTouched(): Promise<void> {
  if (!writeTargetPoolTouch || !writeTargetPoolTouch(text.value)) return;
  await nextTick();
  await nextTick();
}
/** 文本模式别名语言包（函数条插入 / 结构反写用），跟随宿主语言。 */
const textLang = computed(() => textPackLangOf(host?.locale?.()));

const panelRoot = ref<HTMLElement | null>(null);
const contentSize = ref({ width: 0, height: 0 });
let panelObserver: ResizeObserver | null = null;
function measurePanel(): void {
  const el = panelRoot.value;
  if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return;
  contentSize.value = { width: el.clientWidth, height: el.clientHeight };
}
onMounted(() => {
  measurePanel();
  if (typeof ResizeObserver === 'undefined' || !panelRoot.value) return;
  panelObserver = new ResizeObserver(measurePanel);
  panelObserver.observe(panelRoot.value);
});
onBeforeUnmount(() => panelObserver?.disconnect());
const SPLIT_PX = 10;
const fallbackHeight = computed(() => Math.max(260, (props.shellHeight ?? 660) - 106));
const contentHeight = computed(() => contentSize.value.height || fallbackHeight.value);
/** 低高度把字段列表改放侧栏，避免在上下两个区域之间争抢少量高度。 */
const sideLayout = computed(() => contentHeight.value <= 520);
const availableHeight = computed(() => Math.max(0, contentHeight.value - SPLIT_PX));
const compactLayout = computed(() => props.hidePersistentHints === true && props.syntaxStatusPlacement === 'external');
const minEditorPx = computed(() => compactLayout.value ? 210 : 270);
const useCompactFunctions = computed(() => props.compactFunctionBar || sideLayout.value);
const initialAvailable = availableHeight.value;
const defaultDockPx = Math.max(120, initialAvailable - minEditorPx.value);
const split = useResizableSplit({ initialHeight: defaultDockPx, resetHeight: defaultDockPx, minHeight: 120, maxHeight: 4000 });
/** 大屏保留原约定：编辑区高度固定，增量全部给字段树；分栏只在本次会话有效。 */
const editorHeight = ref(Math.max(minEditorPx.value, initialAvailable - split.height.value));
watch(() => split.height.value, h => {
  editorHeight.value = Math.max(minEditorPx.value, availableHeight.value - h);
});
const dockHeight = computed(() => Math.max(0, Math.min(availableHeight.value - editorHeight.value, availableHeight.value - minEditorPx.value)));
const preferredSideWidth = ref<number | null>(null);
const sidebarWidth = computed(() => {
  const width = contentSize.value.width || 720;
  return Math.min(Math.max(164, width - 220), Math.max(164, preferredSideWidth.value ?? Math.min(260, width * 0.38)));
});
const sideResizing = ref(false);
let stopSideResize: (() => void) | null = null;
function onSplitPointerDown(e: PointerEvent): void {
  if (!sideLayout.value) {
    split.height.value = dockHeight.value;
    split.onPointerDown(e);
    return;
  }
  e.preventDefault();
  stopSideResize?.();
  sideResizing.value = true;
  const startX = e.clientX;
  const startWidth = sidebarWidth.value;
  const move = (event: PointerEvent) => {
    preferredSideWidth.value = Math.min(Math.max(164, contentSize.value.width - 220), Math.max(164, startWidth + event.clientX - startX));
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    sideResizing.value = false;
    stopSideResize = null;
  };
  stopSideResize = stop;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}
function resetPanelSplit(): void {
  if (sideLayout.value) preferredSideWidth.value = null;
  else {
    split.height.value = Math.max(120, availableHeight.value - minEditorPx.value);
    editorHeight.value = minEditorPx.value;
  }
}
onBeforeUnmount(() => stopSideResize?.());
// —— 语法检查三态——
type SyntaxState = SyntaxStatusState;
const syntaxState = ref<SyntaxState>('idle');
/** 本地轻检查命中的问题（括号/标记），与 diagnostics 二选一非空。 */
const syntaxIssue = ref<SyntaxIssue | null>(null);
/** 服务端 lower-text 的诊断（422 原样带回，message 已本地化）。 */
const diagnostics = ref<LowerTextDiagnostic[]>([]);
const CHECK_DEBOUNCE_MS = 1500;
let checkTimer: number | null = null;
/** 真实检查的序号：每次发起自增，回包时不匹配即"过期"不落地（照 ExpressionEditor.runPreview 的机制）。 */
let checkSeq = 0;

/** 字段标签是否可解析（字段目录 + 系统变量目录）：与 confirm() 的 buildLowerTextRefs 共用同一口径，
 *  否则会出现"状态条说没问题、点确定却报无法识别字段"的自相矛盾。 */
function isKnownLabel(label: string): boolean {
  return resolveTextLabel(label, sourceTablesResolved.value, props.formTables, systemVars.value) !== null;
}

/** 本地轻检查（同步）：有问题 → error 态并返回 false；通过返回 true（不改状态，交给后续真实检查定夺）。 */
function runLightCheck(): boolean {
  const result = checkExpressionSyntax(text.value, { isKnownLabel });
  syntaxIssue.value = result.issue ?? null;
  diagnostics.value = [];
  if (!result.ok) {
    syntaxState.value = 'error';
    return false;
  }
  return true;
}

function cancelPendingCheck(): void {
  if (checkTimer !== null) {
    window.clearTimeout(checkTimer);
    checkTimer = null;
  }
}

/** 组 lower-text 请求；标签解析不到时返回 unresolved（调用方决定提示/拦截）。 */
function buildRequest(): { req: LowerTextRequest; unresolved: string[] } {
  const { refs, unresolved } = buildLowerTextRefs(text.value, sourceTablesResolved.value, props.formTables, systemVars.value);
  return { req: { text: text.value, locale: host?.locale?.() || undefined, purpose: purpose.value, refs }, unresolved };
}

/** 把一次 lower-text 结果落进三态；返回是否成功。调用方已保证序号未过期。 */
function applyLowerResult(result: LowerTextResult): boolean {
  if (isLowerTextSuccess(result)) {
    diagnostics.value = [];
    syntaxIssue.value = null;
    syntaxState.value = 'ok';
    checkedRefs.value = result.text_source?.refs ?? [];
    return true;
  }
  diagnostics.value = result.diagnostics;
  syntaxIssue.value = null;
  syntaxState.value = 'error';
  return false;
}

/**
 * 真实检查（防抖到点后调用）：先本地轻检查秒出，再调 host.lowerText；空文本短路成 idle（清空重写是
 * 正常操作，判错会锁死「确定」）。宿主缺 lowerText 时只做轻检查（入口本就禁用，这里不再报错打扰）。
 */
async function runCheck(): Promise<void> {
  const seq = ++checkSeq;
  if (!text.value.trim()) {
    syntaxState.value = 'idle';
    syntaxIssue.value = null;
    diagnostics.value = [];
    return;
  }
  if (!runLightCheck()) return;
  if (!hostSupportsLowerText(host)) {
    syntaxState.value = 'ok';
    return;
  }
  const { req, unresolved } = buildRequest();
  if (unresolved.length > 0) {
    // 理论不可达（轻检查已按同一口径拦下 unknownField），防御性兜底。
    syntaxIssue.value = { code: 'unknownField', index: 0, detail: unresolved[0] };
    syntaxState.value = 'error';
    return;
  }
  syntaxState.value = 'checking';
  try {
    await ensureWriteTargetPoolTouched();
    if (seq !== checkSeq) return;
    const result = await host.lowerText(req);
    if (seq !== checkSeq) return; // 已过期：更新的一轮检查已发出，本次结果作废
    applyLowerResult(result);
  } catch (e) {
    if (seq !== checkSeq) return;
    // 400/5xx/网络错误：不是"文本写错了"，用统一文案提示、不伪装成语法错误。
    diagnostics.value = [
      { code: 'HOST_ERROR', severity: 'error', message: e instanceof Error ? e.message : t('common.requestFailed'), start: 0, end: 0, rune_start: 0, rune_end: 0 }
    ];
    syntaxIssue.value = null;
    syntaxState.value = 'error';
  }
}

/** 停止输入 1.5s 后触发；输入过程只置"输入中"，从不打断用户。 */
function scheduleCheck(): void {
  cancelPendingCheck();
  checkSeq += 1; // 文本已变：任何飞行中的旧检查结果作废
  if (!text.value.trim()) {
    syntaxState.value = 'idle';
    syntaxIssue.value = null;
    diagnostics.value = [];
    return;
  }
  syntaxState.value = 'typing';
  checkTimer = window.setTimeout(() => {
    checkTimer = null;
    void runCheck();
  }, CHECK_DEBOUNCE_MS);
}

watch(text, scheduleCheck);
onBeforeUnmount(() => {
  cancelPendingCheck();
  checkSeq += 1;
});

/** 首条服务端诊断（状态条展示 + 定位用）。 */
const firstDiagnostic = computed(() => diagnostics.value[0] ?? null);
/** 状态条文案：三态各一句；错误态优先显示服务端本地化 message，否则取本地轻检查的 syntaxErr.<code>。 */
const syntaxLabel = computed(() => {
  switch (syntaxState.value) {
    case 'typing':
      return t('dialog.syntaxTyping');
    case 'checking':
      return t('dialog.syntaxChecking');
    case 'ok':
      return t('dialog.syntaxOk');
    case 'error': {
      const d = firstDiagnostic.value;
      // 服务端诊断 message 已本地化，直接显示；宿主/网络错误（HOST_ERROR）不是"文本写错了"，加「解析失败」前缀区分。
      if (d) return d.code === 'HOST_ERROR' ? `${t('dialog.lowerFailed')}：${d.message}` : d.message;
      return syntaxIssue.value ? t(`dialog.syntaxErr.${syntaxIssue.value.code}`) : '';
    }
    default:
      return '';
  }
});
/** 错误态附加片段：服务端诊断 → 原文里出错的那段（按 rune 偏移截取）；本地轻检查 → detail（如未知字段名）。 */
const syntaxDetail = computed(() => {
  if (syntaxState.value !== 'error') return '';
  const d = firstDiagnostic.value;
  if (d) {
    const s = runeToUtf16Index(text.value, d.rune_start);
    const e = runeToUtf16Index(text.value, d.rune_end);
    return e > s ? text.value.slice(s, e) : '';
  }
  return syntaxIssue.value?.detail ?? '';
});
/** 语法错误时禁用「确定」；宿主缺 lowerText 时恒禁用。
 *  输入中/检查中不禁用——确定时会先同步补跑检查（见 confirm），安全性由那道兜住。 */
const confirmDisabled = computed(() => syntaxState.value === 'error' || !lowerTextAvailable.value);

/** 「定位/高亮出错片段」：服务端诊断按 rune_start/rune_end 选中那段（textarea 无法染色，选区即高亮）；
 *  本地轻检查只有单点下标，把光标跳过去。 */
function focusIssue(): void {
  const ed = taRef.value;
  if (!ed) return;
  const d = firstDiagnostic.value;
  if (d) {
    const s = Math.min(runeToUtf16Index(text.value, d.rune_start), text.value.length);
    const e = Math.min(Math.max(s, runeToUtf16Index(text.value, d.rune_end)), text.value.length);
    ed.focusRange(s, e);
    return;
  }
  const issue = syntaxIssue.value;
  if (!issue) return;
  const p = Math.min(issue.index, text.value.length);
  ed.focusRange(p, p);
}

/** 打开时既有的 sidecar：value 看节点自带的 text_source，where 看父级传入的 where_text_source。 */
const initialSource = computed<TextSource | null>(() =>
  purpose.value === 'where' ? (props.textSource ?? null) : (props.modelValue?.text_source ?? null)
);
/**
 * 打开那一刻的文本：有 sidecar → 原文按稳定 ID 重绘字段名（字段改名同步）；无 sidecar 且是取值节点 →
 * 从结构 best-effort 反写（字段/常量/算术/已知函数）；where 无 sidecar → 空（不从条件组反推）。
 */
function initialTextOf(): string {
  const src = initialSource.value;
  if (src) return restoreTextFromSource(src, sourceTablesResolved.value, props.formTables, systemVars.value);
  if (purpose.value === 'where') return '';
  return serializeToText(props.modelValue, sourceTablesResolved.value, props.formTables, { lang: textLang.value, systemVars: systemVars.value });
}

// —— 打开/关闭 ——
// immediate:true（较改造前新增）：宿主壳把本面板 v-if 挂载（如 ConditionEditorDialog 表达式模式切换）
// 时，show 可能"已经是 true"（弹窗本身早已打开，只是这一刻才切到表达式模式、面板才第一次创建）——
// 若不带 immediate，watch 只在后续"值发生变化"时触发，会错过这次"创建即已打开"的初始化时机，
// 表现为文本区永远是空的、从未从 modelValue 拍平过。AdvancedExpressionDialog 场景（组件常驻挂载、
// show 从 false 变 true 才是真正的打开）不受影响：immediate 首次触发时 s 为 false，早退不做任何事，
// 与不带 immediate 时的首帧行为等价。
watch(
  () => props.show,
  s => {
    if (!s) {
      // 关闭：清掉未触发的防抖计时器（原 AdvancedExpressionDialog.close() 的职责收拢到这里，
      // 因为计时器状态是本面板私有——宿主壳看不到也管不了 checkTimer）。
      cancelPendingCheck();
      moreFunctionsOpen.value = false;
      return;
    }
    const flat = initialTextOf();
    text.value = flat;
    initialText.value = flat;
    cancelPendingCheck();
    checkSeq += 1;
    // 说明条属于「本次编辑会话」，重开须清空，否则会带着上次选的函数说明打开。
    selectedFunction.value = null;
    moreFunctionsOpen.value = false;
    // 打开时先按现有内容跑一次本地轻检查，让用户一眼看到既有表达式的字段是否还在（字段可能已被删改）；
    // 不立即打服务端——原文未改时确认会跳过重新降级，没必要为"只是看一眼"发请求。
    if (flat.trim()) {
      if (runLightCheck()) syntaxState.value = 'ok';
    } else {
      syntaxState.value = 'idle';
      syntaxIssue.value = null;
      diagnostics.value = [];
    }
    void nextTick(() => taRef.value?.focus());
  },
  { immediate: true }
);

/** 在光标处插入文本，back=插入后光标回退字符数（落到括号内等）。 */
function insertAtCursor(snippet: string, back = 0) {
  const ed = taRef.value;
  // 编辑器在场时由它自己处理光标（CodeMirror 的选区不是 DOM selectionStart）；未挂载时退回追加。
  if (ed) ed.insertAtCursor(snippet, back);
  else text.value += snippet;
}

function onBarInsert(snippet: string) {
  const back = snippet.endsWith('()') ? 1 : 0;
  insertAtCursor(snippet, back);
}

/**
 * 运算符条的成对包裹条目（`()` / `''`）：有选区时给选中内容左右各插一个符号（选区保持选中，
 * 可连点套多层），无选区时插入一对并把光标落中间——两种情形都由 ExpressionSqlEditor.wrapSelection 处理
 * （CodeMirror 的选区不是 DOM selectionStart，必须问编辑器要）。编辑器未挂载时退回追加一对符号，
 * 与 insertAtCursor 的兜底同口径。
 */
function onBarWrap(left: string, right: string) {
  const ed = taRef.value;
  if (ed) ed.wrapSelection(left, right);
  else text.value += `${left}${right}`;
}

/** 条件弹窗或低高度紧凑工具栏的「更多」开关；大屏完整工具栏不额外展开分类面板。 */
function toggleMoreFunctions(): void {
  if (!useCompactFunctions.value) return;
  moreFunctionsOpen.value = !moreFunctionsOpen.value;
}
function closeFunctionCatalog(): void {
  moreFunctionsOpen.value = false;
}


/** 本子树的字段引用书写语法（见 ./host.ts RefSyntax）：3.4 各场景恒 'braces'，
 *  表达式引擎 V4 取数配置面 provide 'brackets'。 */
const refSyntax = useRefSyntax();

/** 系统变量的 V4 文本标记解析口（配置面按目录 provide；braces 场景不用）。 */
const systemVariableToken = useSystemVariableToken();

function onPick(v: ValueRef) {
  if (refSyntax === 'brackets') {
    const token = valueRefToBracketText(v, sourceTablesResolved.value, props.formTables, systemVars.value, { systemVariableToken });
    if (token) insertAtCursor(token);
  } else {
    const label = labelOfTextRef(v, sourceTablesResolved.value, props.formTables, systemVars.value);
    if (label) insertAtCursor(`{${label}}`);
  }
  // 可选调用：单测里 FieldTreeDock 常被 stub 成空组件（没有 clearSearch），真组件恒有。
  dockRef.value?.clearSearch?.();
}

/**
 * 点选函数树里的函数：插入片段 + 记下选中项以展示说明。（selectedFunction ref 声明已上移至文件
 * 靠前处，见该处注释——避免"打开/关闭" immediate watch 的 TDZ 问题。）
 * 光标回退语义与 OperatorFunctionBar 横条完全一致（以 "()" 结尾则回退 1 落到括号内），
 * 否则同一个 SUM() 从两个入口点进来光标落点不同，是很难察觉的体验分叉。
 */
function onPickFunction(fn: FunctionCatalogItem) {
  selectedFunction.value = fn;
  insertAtCursor(fn.snip, fn.snip.endsWith('()') ? 1 : 0);
  dockRef.value?.clearSearch();
}

/** 「更多」中的函数复用函数树插入链路，确保光标回退与说明条行为完全一致。 */
function onPickMoreFunction(fn: FunctionCatalogItem): void {
  onPickFunction(fn);
  closeFunctionCatalog();
}

/** 确认是否正在进行中（等待 lower-text 回包）：期间重复点确定直接忽略，避免双发。 */
const confirming = ref(false);

/**
 * 校验并确认：
 *   ① 宿主缺 lowerText → 提示不可用，不 emit；
 *   ② 空文本 → value：emit 空常量占位（与 ConditionTree.emptyRef 同形）；where：emit confirmWhere(null,null)=清除；
 *   ③ 文本未改且打开时有 sidecar → 跳过重新降级（digest 不变）：value 原节点回抛 / where emit confirmUnchanged；
 *   ④ 否则本地轻检查 → 组 refs（解析不到的标签拦下提示）→ await host.lowerText → 成功 emit、失败显示诊断
 *     并选中出错片段，确认被拦。
 * 是否关闭弹窗/回写父级模型由宿主壳监听事件后自行决定（本面板不持有 show 的写权）。
 */
async function confirm(): Promise<void> {
  if (confirming.value) return;
  cancelPendingCheck();
  checkSeq += 1; // 确认本身就是一次权威检查，飞行中的防抖检查结果作废
  if (!lowerTextAvailable.value) {
    message.error(t('dialog.textModeUnavailable'));
    return;
  }
  const current = text.value;
  if (!current.trim()) {
    syntaxState.value = 'idle';
    syntaxIssue.value = null;
    diagnostics.value = [];
    if (purpose.value === 'where') emit('confirmWhere', { condition: null, textSource: null });
    // 四动作口径按调用方分流：填充字段/写模式字段映射行传
    // emptyAsUnconfigured=true，删光文本确认＝「不填充」占位（与✕清除同一形状），不是填了空串；
    // 条件树 ConditionTree.emptyRef() 仍是空串占位语义，未传该 prop 时保持原有行为不变。
    else emit('confirm', props.emptyAsUnconfigured ? { kind: 'const' } : { kind: 'const', value: '' });
    return;
  }
  if (!dirty.value && initialSource.value) {
    if (purpose.value === 'where') emit('confirmUnchanged');
    else if (props.modelValue) emit('confirm', props.modelValue);
    return;
  }
  if (!runLightCheck()) {
    focusIssue();
    return;
  }
  const { req, unresolved } = buildRequest();
  if (unresolved.length > 0) {
    message.error(`${t('dialog.unresolvedField')}{${unresolved.join('}、{')}}，${t('dialog.pleaseSelectFromDrawer')}`);
    return;
  }
  confirming.value = true;
  syntaxState.value = 'checking';
  try {
    await ensureWriteTargetPoolTouched();
    if (text.value !== current) return; // 等待期间用户又改了文本：本次结果不落地，让防抖检查接手
    const result = await host!.lowerText(req);
    if (text.value !== current) return; // 等待期间用户又改了文本：本次结果不落地，让防抖检查接手
    if (!applyLowerResult(result)) {
      focusIssue();
      return;
    }
    if (purpose.value === 'where') {
      emit('confirmWhere', { condition: result.condition ?? null, textSource: result.text_source ?? null });
    } else if (result.value) {
      emit('confirm', result.value);
    }
  } catch (e) {
    if (text.value !== current) return;
    diagnostics.value = [
      { code: 'HOST_ERROR', severity: 'error', message: e instanceof Error ? e.message : t('common.requestFailed'), start: 0, end: 0, rune_start: 0, rune_end: 0 }
    ];
    syntaxIssue.value = null;
    syntaxState.value = 'error';
  } finally {
    confirming.value = false;
  }
}

defineExpose({
  dirty,
  confirmDisabled,
  /** 语法检查三态 + 文案 + 定位（syntaxStatusPlacement='external' 时宿主壳据此自渲染状态条）。 */
  syntaxState,
  syntaxLabel,
  syntaxDetail,
  focusIssue,
  /** 宿主缺 lowerText 时为 false：壳可据此在标题/按钮上额外提示。 */
  lowerTextAvailable,
  confirm,
  isFunctionCatalogOpen: () => moreFunctionsOpen.value,
  closeFunctionCatalog,
  isSearching: () => dockRef.value?.searching ?? false,
  clearSearch: () => dockRef.value?.clearSearch()
});
</script>

<template>
  <div ref="panelRoot" class="adv-panel" :class="{ 'adv-panel--side': sideLayout }" :data-layout="sideLayout ? 'side' : 'stacked'">
  <!-- 单根内容盒子供 ResizeObserver 实测；布局切换只改变排列，不重建字段树和编辑器会话。 -->
  <!-- 上：字段树坞，高度由分隔条驱动 -->
  <div class="adv-dock" :class="{ 'adv-dock--resizing': split.resizing.value }" :style="sideLayout ? { width: `${sidebarWidth}px` } : { height: `${dockHeight}px` }">
    <FieldTreeDock
      ref="dockRef"
      :current-column="dockColumnsResolved.current"
      :source-columns="dockColumnsResolved.sources"
      :compact="sideLayout"
      show-functions
      @pick="onPick"
      @pick-function="onPickFunction"
    />
  </div>

  <!-- 中：可拖分隔条，双击复位 -->
  <div
    class="adv-split"
    :class="{ 'adv-split--active': split.resizing.value || sideResizing }"
    role="separator"
    :aria-orientation="sideLayout ? 'vertical' : 'horizontal'"
    @pointerdown="onSplitPointerDown"
    @dblclick="resetPanelSplit"
  >
    <span class="adv-split-grip" aria-hidden="true"></span>
  </div>

  <!-- 下：编辑区。状态条外置（external）时文本框成为最后一项，补一段底边距免得贴住页脚顶边。 -->
  <div class="adv-editor" :class="{ 'adv-editor--status-external': syntaxStatusPlacement === 'external' }">
    <div class="adv-function-bar-wrap">
      <OperatorFunctionBar
        :function-items="compactFunctionItems"
        :more-open="moreFunctionsOpen"
        @insert="onBarInsert"
        @wrap="onBarWrap"
        @more="toggleMoreFunctions"
        @update:more-open="moreFunctionsOpen = $event"
      >
        <template v-if="useCompactFunctions" #more>
          <div
            class="adv-more-functions"
            data-testid="condition-function-more-panel"
            role="menu"
            :aria-label="t('operatorBar.moreFunctions')"
            @click.stop
          >
            <section
              v-for="group in moreFunctionGroups"
              :key="group.category"
              class="adv-more-function-group"
              :data-function-category="group.category"
            >
              <h4 class="adv-more-function-title">{{ t(group.labelKey) }}</h4>
              <div class="adv-more-function-items">
                <button
                  v-for="fn in group.items"
                  :key="fn.key"
                  type="button"
                  class="adv-more-function-item"
                  role="menuitem"
                  :data-function-key="fn.key"
                  @click="onPickMoreFunction(fn)"
                >
                  {{ t(fn.labelKey) }}
                </button>
              </div>
            </section>
          </div>
        </template>
      </OperatorFunctionBar>
    </div>
    <div v-if="!lowerTextAvailable" class="adv-unavailable" data-testid="adv-text-mode-unavailable">
      {{ t('dialog.textModeUnavailable') }}
    </div>
    <ExpressionSqlEditor
      ref="taRef"
      v-model="text"
      :disabled="!lowerTextAvailable"
      :refs="highlightRefs"
      :error-ranges="editorErrorRanges"
      :functions="completionFunctions"
      :references="referenceCandidates"
      :table-classes="tableClasses"
    />
    <!-- 三态状态条（视觉/交互见 SyntaxStatusLine.vue）：错误文案＝服务端 lower-text 诊断（已本地化）
         优先，本地轻检查 syntaxErr.* 兜底。external 落位时由宿主壳渲染（见 syntaxStatusPlacement）。 -->
    <SyntaxStatusLine
      v-if="syntaxStatusPlacement !== 'external'"
      :state="syntaxState"
      :label="syntaxLabel"
      :detail="syntaxDetail"
      @jump="focusIssue"
    />
    <div v-if="selectedFunction" class="adv-fn-desc">
      <span class="adv-fn-name">{{ t(selectedFunction.labelKey) }}</span>
      <span>{{ t(selectedFunction.descKey) }}</span>
    </div>
    <div v-if="!hidePersistentHints" class="adv-hint">{{ t('dialog.exprHint') }}</div>
    <div
      v-if="!hidePersistentHints && isCompareOperatorAvailable('like')"
      class="adv-hint"
      data-testid="adv-text-mode-like-hint"
    >
      {{ t('dialog.textModeLikeHint') }}
    </div>
  </div>
  </div>
</template>

<style scoped>
.adv-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.adv-panel--side { flex-direction: row; }
.adv-panel--side .adv-dock { box-sizing: border-box; padding: 10px 0 10px 12px; height: auto; }
.adv-panel--side .adv-split { width: 10px; height: auto; cursor: col-resize; }
.adv-panel--side .adv-split-grip { width: 3px; height: 36px; }
.adv-panel--side .adv-editor { padding: 10px 12px 10px 2px; min-width: 0; }
/* 侧栏只留一个搜索框；各字段/变量分组改为纵向可读列表，统一在搜索栏下滚动。 */
/* 常用工具收成两行，长尾函数仍在“更多”目录；不挤占编辑输入。 */
.adv-panel--side :deep(.op-fn-bar) { gap: 4px; }
.adv-panel--side :deep(.op-row) { flex-wrap: nowrap; align-items: flex-start; gap: 6px; }
.adv-panel--side :deep(.op-label) { min-width: 36px; font-size: 12px; line-height: 20px; }
.adv-panel--side :deep(.op-items) { gap: 4px; }
.adv-panel--side :deep(.kq-editor) { min-height: 98px; }

.adv-dock {
  flex: 0 0 auto;
  min-height: 0;
  padding: 12px 16px 0;
  overflow: hidden;
}
/* 拖拽中关掉高度过渡，否则跟手会有回弹感（同 useResizableSplit 头注释的既有约定）。 */
.adv-dock--resizing {
  transition: none;
}
.adv-split {
  display: flex;
  height: 10px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
}
.adv-split-grip {
  width: 40px;
  height: 3px;
  border-radius: 2px;
  background: rgb(var(--border-color));
}
.adv-split:hover .adv-split-grip,
.adv-split--active .adv-split-grip {
  background: rgb(var(--primary-color));
}
.adv-editor {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
  /* 兜住极窄窗口：内容再挤也只在本区内滚动，绝不外溢盖住页脚。 */
  overflow: hidden auto;
}
.adv-function-bar-wrap {
  position: relative;
  flex: 0 0 auto;
}
/* 「更多」函数面板由 NPopover 承载（弹窗内被 naive 传送进弹窗 body），不受 .adv-editor 的滚动裁切。 */
.adv-more-functions {
  width: min(560px, calc(100vw - 48px));
  max-height: min(360px, calc(100vh - 96px));
  padding: 8px 12px;
  border: 1px solid rgb(var(--border-color));
  border-radius: 8px;
  overflow-y: auto;
  background: rgb(var(--container-bg-color, 255 255 255));
  box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
}
.adv-more-function-group {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgb(var(--border-light-color));
}
.adv-more-function-group:last-child {
  border-bottom: 0;
}
.adv-more-function-title {
  margin: 0;
  color: rgb(var(--text-secondary-color));
  font-size: 12px;
  font-weight: 500;
  line-height: 24px;
}
.adv-more-function-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.adv-more-function-item {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  color: rgb(var(--primary-color));
  background: rgb(var(--primary-50-color) / 0.5);
  font: inherit;
  font-size: 12px;
  line-height: 24px;
  cursor: pointer;
}
.adv-more-function-item:hover,
.adv-more-function-item:focus-visible {
  background: rgb(var(--primary-50-color) / 0.85);
  outline: none;
}
.adv-textarea {
  width: 100%;
  min-height: 96px;
  flex: 1 1 auto;
  padding: 7px;
  border: 1px solid rgb(var(--border-color));
  border-radius: 4px;
  background: transparent;
  color: rgb(var(--base-text-color));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  outline: none;
  resize: none; /* 高度由分隔条统一控制，再留一个原生把手会有两套互相打架的调节方式 */
}
.adv-textarea:focus {
  border-color: rgb(var(--primary-color));
}
.adv-textarea::placeholder {
  color: rgb(var(--text-hint-color));
}
.adv-unavailable {
  padding: 6px 10px;
  border-radius: 4px;
  background: rgb(var(--warning-color) / 0.12);
  color: rgb(var(--warning-color));
  font-size: 12px;
  line-height: 1.6;
}
/* 状态条外置（筛选条件弹窗）：编辑区最后一项是文本框，补 12px 底边距（与树坞区 12px 顶边距对称），
   免得文本框贴住页脚顶边。状态条样式随其迁到 SyntaxStatusLine.vue。 */
.adv-editor--status-external {
  padding-bottom: 12px;
}
.adv-fn-desc {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  border-left: 2px solid rgb(var(--primary-color));
  border-radius: 0 4px 4px 0;
  background: rgb(var(--fill-lightest-color));
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--text-secondary-color));
}
.adv-fn-name {
  flex: 0 0 auto;
  font-weight: 600;
  color: rgb(var(--base-text-color));
}
.adv-hint {
  font-size: 12px;
  color: rgb(var(--text-hint-color));
  line-height: 1.6;
}
</style>
