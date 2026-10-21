<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { NButton } from 'naive-ui';
import type { TemplateField } from './types';
import type { ValueRef } from './types';
import type { TableFields } from './useExpressionContext';
import { useExpressionDrawer } from './expressionDrawerBus';
import AdvancedExpressionDialog from './AdvancedExpressionDialog.vue';
import QuickFieldPicker from './QuickFieldPicker.vue';
// 表达式胶囊渲染（ValueRef 拍平为带配色 token 片段）2026-09-12 抽成独立组件，
// 供「单行省略 + 悬浮完整表达式浮层」（见下方 singleLine）与本组件默认展示共用同一份逻辑；
// flatten/refShort/varLabel 等实现细节随之搬到该组件，本文件不再直接持有。
import ExpressionTokens from './ExpressionTokens.vue';
import type { DockColumnsBundle } from './dockColumns';
import { useT } from './host';

/**
 * 统一表达式小组件：编辑**单个值引用 ValueRef**。只显示表达式内容本身——
 * 引导式插入的字段/变量按最简形式 {数据表.字段名} / @变量 呈现；复合表达式（算术/函数/CASE/开窗/常量）
 * 一律走「ƒ 表达式」编辑器（产 raw 节点），与引导式互斥。
 *
 * 交互（值单元格三入口）：点值区 → 已是表达式(raw)或 exprOnly 时直接打开「ƒ 表达式编辑器」，
 * 否则按 preferQuickPick 二选一（成为右侧持久抽屉的激活插入目标 / 直接打开 ⊞ 快捷选择器）；
 * ⊞ 快捷选择 → 独立于点值区的第二入口，popover 内直选字段/变量（自持数据，不占用抽屉单激活槽，
 * 详见 QuickFieldPicker.vue 头注释）；✕ 清空。
 */
const props = withDefaults(
  defineProps<{
    modelValue: ValueRef | null;
    sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[] }[];
    formTables: (TableFields & { alias?: string })[];
    /** 全局唯一槽 key（驱动激活高亮 + 抽屉插入路由）。 */
    slotKey: string;
    placeholder?: string;
    /** true=显示「ƒ 表达式」入口（仅顶层表达式槽开启，嵌套上下文关闭以免无意义深层嵌套）。 */
    advanced?: boolean;
    /** true=仅表达式模式（如整段 where）：点击直接进表达式编辑器，不走引导式抽屉。 */
    exprOnly?: boolean;
    /** 可选：父级（ExpressionEditor.vue）已按模板归属精确分组好的树坞列，原样透传给内部挂载的
     *  AdvancedExpressionDialog——有模型上下文的调用方传入即用精确分组，不必再降级重算。
     *  **必须可选**：ConditionTree.vue、表格编辑器字段控件、视图过滤等其余调用方没有模型上下文，不传时
     *  AdvancedExpressionDialog 按 sourceTables/formTables 自行降级构造（见 dockColumns.ts），
     *  不是破坏性改动。 */
    dockColumns?: DockColumnsBundle;
    /** 已退役（反馈批3，2026-08-18）：⊞ 独立按钮全局移除，快捷选择唯一入口=点值区。保留声明仅为
     *  兼容存量传参（不再被消费）。 */
    quickPick?: boolean;
    /** true=点空值区不再走 bus.setActive（单激活槽、需要外部常驻字段树坞配合插入），改为直接打开
     *  ⊞ 快捷选择器——供页面上没有常驻字段树坞的调用域接线（P3 撤树坞前的过渡兜底，任务单背景）。
     *  默认 false，既有 27 处挂载点行为不变（仍走抽屉总线）。 */
    preferQuickPick?: boolean;
    quickPickTitle?: string;
    /** P6c（2026-08-12 权限架构终局裁定②）：true=只读——点值区不再打开「ƒ 表达式」/「⊞ 快捷选择」，
     *  ✕ 清空按钮禁用；内容仍以 tok 片段渲染、可选中复制。缺省 false，不影响既有挂载点。 */
    readonly?: boolean;
    /** 「空值」快捷选项（条件筛选新增）：透传给内部 QuickFieldPicker，控制其列表是否出现「空值」项
     *  （kind='const'+value=null 的真正空值常量）。缺省 false——只有 ConditionTree.vue 的条件值输入
     *  按语义需要它，其余挂载点（输出映射/图表目标等）不传即不受影响。 */
    allowNullConst?: boolean;
    /** ƒ 表达式面板「删光文本→确定」的产出口径：true=不填充占位 {kind:'const'}（value 键缺省）；
     *  缺省 false=空字符串常量 {kind:'const', value:''}。只有填充字段/写模式字段映射行的值单元格
     *  打开（三态口径的第三处遗漏，见 ExpressionEditor.vue isEmptyExpr 注释），条件树（ConditionTree
     *  的 emptyRef() 空串占位语义）等其余挂载点不传即不受影响。透传给内部 AdvancedExpressionDialog。 */
    emptyAsUnconfigured?: boolean;
    /** ✕ 按钮的 title 提示。暂存区列行（StagingTargetSection）把 ✕ 当「删除此列」用（收到 null 即删行），
     *  需要一句区别于「清空」的提示；其余挂载点不传即无 title。 */
    clearTitle?: string;
    /** 单行模式：true=值框恒不换行（胶囊区域
     *  overflow:hidden），内容超宽时末尾显示「…」指示、悬停约 300ms 浮出完整表达式（naive-ui
     *  NPopover + ExpressionTokens mode="wrap"，自动换行展示）；点击等编辑交互与非单行模式完全一致。
     *  默认 false，既有 27 处挂载点渲染与交互零变化（不新增任何 DOM/观察器）。 */
    singleLine?: boolean;
    /** 透传给内部 QuickFieldPicker 的 currentFirst：true=快捷选择里本报表分组置顶（2026-09-28，仅
     *  动作「新增数据/修改数据」的填充字段行传入）。缺省 false，其余挂载点分组顺序不变。 */
    quickPickCurrentFirst?: boolean;
  }>(),
  { quickPick: true, preferQuickPick: false, readonly: false, allowNullConst: false, emptyAsUnconfigured: false, singleLine: false, quickPickCurrentFirst: false }
);

const emit = defineEmits<{
  'update:modelValue': [value: ValueRef | null];
  /** ⊞ 快捷选择器关闭（选中或点外部/取消都算）：宿主据此清行级激活高亮——「插完跳下一行」自动
   *  打开下一行的选择器，用户不选就关掉时，下一行不该继续顶着"已激活"的蓝描边（UI 反馈 2026-09-07 ③）。 */
  'quick-pick-close': [];
  'quick-pick-open': [point: { x: number; y: number }];
}>();

const t = useT();
const bus = useExpressionDrawer();
const isActive = computed(() => bus?.activeKey.value === props.slotKey);
const current = computed(() => props.modelValue);
/** 「文本模式产物」判定：带 text_source sidecar 的节点（降级产物）或历史 raw 节点，点值区都
 *  直接进「ƒ 表达式」编辑器（文本模式重开）。 */
const isRaw = computed(() => !!current.value && (current.value.kind === 'raw' || !!current.value.text_source));
/** ⊞ 快捷选择器开关（QuickFieldPicker 自持，本处只是受控开关的落点）。 */
const showQuickPick = ref(false);
/** ⊞ 快捷面板定位点：由 activate() 收到的
 *  鼠标事件写入，透传给 QuickFieldPicker 的 x/y 坐标定位 props；无事件（键盘触发 / 「插完跳下一行」
 *  自动打开下一行）时保持 undefined，QuickFieldPicker 回落既有 trigger 锚点定位，行为不变。 */
const quickPickX = ref<number | undefined>(undefined);
const quickPickY = ref<number | undefined>(undefined);

// 表达式编辑器开关。
const showAdv = ref(false);
function applyAdvanced(v: ValueRef) {
  emit('update:modelValue', v);
}

/**
 *  @click 场景下 Vue 直接把 MouseEvent 传入，用于取 clientX/clientY 作为 ⊞ 面板定位点；opts.x/y
 *  是程序化定位坐标（如 ExpressionEditor「插完跳下一行」续接上次弹出点做层叠偏移），与鼠标事件同路
 *  但不依赖真实点击；opts.drawerOnly（404:22903 二轮新增，行级点击激活用）：true 时强制走
 *  bus.setActive 分支，即便当前值是 raw/exprOnly 也不弹出表达式编辑器——由外部（如 ExpressionEditor
 *  的目标行点击）程序化调用，语义是"把此槽设为抽屉插入目标"而非"用户点了表达式框想编辑"，二者意图
 *  不同。三种入参互斥（同一次调用要么是浏览器点击事件，要么是程序化 opts），不传（键盘触发 / 无上次
 *  弹出点记录时的「插完跳下一行」）时按旧行为回落锚点定位。 */
function activate(evtOrOpts?: MouseEvent | { x?: number; y?: number; drawerOnly?: boolean }) {
  // P6c 只读闸：任何激活路径（原生点击 / 宿主行级点击程序化调用）一律吞掉，值区保持当前展示不变。
  if (props.readonly) return;
  const opts = evtOrOpts instanceof MouseEvent ? undefined : evtOrOpts;
  const evt = evtOrOpts instanceof MouseEvent ? evtOrOpts : undefined;
  // exprOnly（整段 where 等布尔表达式槽）：点值区就是进表达式编辑器，没有"值"可快捷选。
  if (props.exprOnly && !opts?.drawerOnly) {
    showAdv.value = true;
    return;
  }
  // preferQuickPick：点值区一律打开 ⊞ 快捷选择器（UI 反馈 2026-09-07 ④）——**不再看当前值是不是
  // raw/text_source**：V4 壳下每个已配表达式都是 text_source 形态，连清空后往返回来的空表达式也是，
  // 此前"raw 即进编辑器"的分支让点已配字段/刚清空的字段都直接弹出表达式编辑器，快捷选择只剩空值
  // 首次能用。三入口分工固定：点值区=⊞ 快捷选择，ƒ 按钮=表达式编辑器，✕=清空。drawerOnly 强制路径
  //（ExpressionEditor 行级点击的程序化调用）语义是"把此槽设为抽屉插入目标"，不受本 prop 改道。
  if (props.preferQuickPick && !opts?.drawerOnly) {
    // 面板定位点：优先取程序化坐标 opts.x/y（宿主
    // 「插完跳下一行」续接上次弹出点做层叠偏移）；否则按鼠标事件点击处（clientX/clientY）定位；
    // 都没有时显式清空，回落 QuickFieldPicker 既有的 trigger 锚点定位——不清空会导致下次程序化
    // 打开仍沿用上次点击坐标，位置对不上触发它的那一行。
    quickPickX.value = opts?.x ?? evt?.clientX;
    quickPickY.value = opts?.y ?? evt?.clientY;
    showQuickPick.value = true;
    if (quickPickX.value !== undefined && quickPickY.value !== undefined) {
      emit('quick-pick-open', { x: quickPickX.value, y: quickPickY.value });
    }
    return;
  }
  if (!opts?.drawerOnly && isRaw.value && props.advanced) {
    showAdv.value = true;
    return;
  }
  bus?.setActive(props.slotKey, handleInsert);
}
// ⊞ 关闭即通知宿主（见 emits 注释）。只在由开到关时发，避免初始化/重复置假空发。
watch(showQuickPick, (open, was) => {
  if (was && !open) emit('quick-pick-close');
});
// 供宿主（ExpressionEditor）行级点击程序化调用：refs map + activate({drawerOnly:true})。
defineExpose({ activate });

/** 抽屉插入（引导式）：直接替换为该原子（字段/变量），即「最简单的一种表达式」。 */
function handleInsert(ref: ValueRef) {
  emit('update:modelValue', ref);
}

function clear() {
  if (props.readonly) return;
  emit('update:modelValue', null);
}

/** ✕ 按钮以外的「ƒ 表达式」入口打开：只读态守卫（与 activate() 同一纪律，供 ƒ 按钮独立点击路径用，
 *  该路径 @click.stop 不经过 activate()）。 */
function openAdvanced(): void {
  if (props.readonly) return;
  showAdv.value = true;
}
// （openQuickPick 已随 ⊞ 独立按钮一并退役——反馈批3；快捷选择唯一入口=点值区 activate()。）

/**
 * 单行模式（singleLine）溢出检测：仅 singleLine=true 时才
 * 装 ResizeObserver + 内容变化监听，非单行模式零额外开销、零 DOM 变化。
 *
 * 胶囊区域（.expr-tokens-clip，包住 ExpressionTokens mode="single" 那一层）在容器变窄或内容变长时
 * 都可能溢出：
 *   - 容器尺寸变化（如视图设计器拖动列宽）→ ResizeObserver 能侦测到胶囊区域自身盒子尺寸变化；
 *   - 内容变化（modelValue 变化，同一胶囊区域宽度不变但文本变长/变短）→ ResizeObserver 侦测不到
 *     （它只看被观察元素自身的盒子尺寸，不看内容/子树），需要另外 watch current 主动重测一次。
 * 两路径共同调用 checkOverflow，都在 nextTick 后测（等 DOM 按新内容/新宽度完成一轮布局）。
 */
/** 胶囊裁切区的原生 DOM ref（不是组件 ref）：ExpressionTokens 顶层模板是 mode 驱动的
 *  v-if（'single' 时单元素 span）/v-else（'wrap' 时内嵌自身 v-if/v-else 的 template 片段）分支，
 *  SFC 编译器无法静态证明「整个组件恒单根」，会给组件整体套一层隐式 Fragment 兜底——此时组件
 *  实例的 `$el` 指向 Fragment 锚点（注释节点），不是我们想测量的那个 span，量出来的 scrollWidth/
 *  clientWidth 恒 undefined（已用最小复现验证）。改为在本文件自己包一层原生 span 做测量边界，
 *  绕开这层不确定性——测量对象换成我们自己写的、无条件单元素的原生标签，永远可靠。 */
const tokensClipRef = ref<HTMLElement | null>(null);
const overflowing = ref(false);
let tokensResizeObserver: ResizeObserver | null = null;

/** 比较取整避免亚像素误差导致的临界抖动（同宽时两者可能相差 <1px）。 */
function checkOverflow(): void {
  if (!props.singleLine) {
    overflowing.value = false;
    return;
  }
  const el = tokensClipRef.value;
  overflowing.value = !!el && Math.ceil(el.scrollWidth) > Math.ceil(el.clientWidth);
}

/** singleLine 生效/失效时装卸 ResizeObserver（缺省 false 的既有 27 处挂载点因此完全不受影响）。 */
watch(
  () => props.singleLine,
  enabled => {
    tokensResizeObserver?.disconnect();
    tokensResizeObserver = null;
    if (!enabled) {
      overflowing.value = false;
      return;
    }
    nextTick(() => {
      const el = tokensClipRef.value;
      if (!el) return;
      checkOverflow();
      tokensResizeObserver = new ResizeObserver(checkOverflow);
      tokensResizeObserver.observe(el);
    });
  },
  { immediate: true }
);
// 内容变化（取数/清空/重新编辑表达式）后胶囊区域宽度可能变，ResizeObserver 侦测不到"内容"变化，
// 需要主动重测一次（见上方头注释）。
watch(current, () => nextTick(checkOverflow));

/**
 * 悬浮完整表达式浮层（singleLine 溢出时）：自绘轻量浮层（Teleport 到 body + fixed 定位），
 * **不依赖 naive-ui NPopover**。
 * ⑦ 等）——任何新增的顶层 naive-ui 具名导入都可能撞上某个调用方的部分桩，故改用平台内置
 * Teleport + 手写 hover 计时器/定位，彻底不产生新的 naive-ui 顶层依赖。
 */
const HOVER_POPOVER_DELAY_MS = 300;
const popoverOpen = ref(false);
const popoverStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' });
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoverTimer(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}
/** 悬停胶囊裁切区：仅溢出时才计时弹出（未溢出没有"看完整"的必要，也不应弹出）。 */
function onTokensRowMouseEnter(): void {
  if (!overflowing.value) return;
  clearHoverTimer();
  hoverTimer = setTimeout(() => {
    const el = tokensClipRef.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      // 简单钳制：浮层左边不超出视口右侧（480 为浮层 CSS 里的 max-width，8 是留白）；
      // 顶部固定贴在胶囊裁切区正下方 4px。测试环境（happy-dom）window.innerWidth 有默认值，
      // 钳制算式在那里同样安全可算，不会报错。
      const left = Math.min(rect.left, Math.max(8, window.innerWidth - 480 - 8));
      popoverStyle.value = { left: `${left}px`, top: `${rect.bottom + 4}px` };
    }
    popoverOpen.value = true;
  }, HOVER_POPOVER_DELAY_MS);
}
function onTokensRowMouseLeave(): void {
  clearHoverTimer();
  popoverOpen.value = false;
}
// 溢出态在浮层已弹出期间被"追上"（如拖宽了列）：不留一个内容其实没截断却还开着的浮层。
watch(overflowing, ok => {
  if (!ok) {
    clearHoverTimer();
    popoverOpen.value = false;
  }
});

onBeforeUnmount(() => {
  tokensResizeObserver?.disconnect();
  tokensResizeObserver = null;
  clearHoverTimer();
});
</script>

<template>
  <!-- @click 直接绑 activate：原先因 activate() 的 { drawerOnly } 形参是"全可选属性"弱类型、直接绑
       原生 DOM click 处理器会被 TS 判「与 PointerEvent 无公共属性」报错，故包一层零参箭头函数吞掉事件。
       形参放宽为 MouseEvent | {drawerOnly} 后，PointerEvent
       是 MouseEvent 的子类型，直接绑定类型检查通过，且原生点击事件的 clientX/clientY 得以传入
       activate() 用作面板定位点——不再需要这层包裹。 -->
  <div
    class="expr-input"
    :class="{ active: isActive, 'expr-input--readonly': readonly, 'expr-input--single-line': singleLine }"
    :data-slot-key="slotKey"
    :title="placeholder ?? (exprOnly ? t('input.clickToWriteExpr') : t('input.clickToSelectField'))"
    @click="activate"
  >
    <!-- 默认（非 singleLine）：ExpressionTokens 默认 mode="wrap" 渲染裸片段（无包裹元素），
         与抽取前逐字节一致的 DOM 结构与类名——token 拍平/着色逻辑见该组件头注释。 -->
    <ExpressionTokens
      v-if="!singleLine"
      :model-value="current"
      :source-tables="sourceTables"
      :form-tables="(formTables as any)"
    />
    <!-- 单行模式：胶囊区域包一层可裁切根
         （ExpressionTokens mode="single"，样式见下方 .expr-tokens-clip），超宽时末尾追加「…」指示；
         悬停（仅溢出时，见 onTokensRowMouseEnter 守卫）约 300ms 浮出自绘浮层（Teleport 到 body，
         不依赖 naive-ui NPopover——理由见上方 popoverOpen 声明处头注释），内容是 mode="wrap" 的
         完整表达式（自动换行）。点击等编辑交互与非单行模式完全一致（浮层只挂 hover 触发，不拦截
         点击，@click 仍冒泡到外层 .expr-input 的 activate()）。 -->
    <template v-else>
      <span class="expr-tokens-row" @mouseenter="onTokensRowMouseEnter" @mouseleave="onTokensRowMouseLeave">
        <!-- 原生 span 承担测量边界（ref 是纯 DOM 引用，理由见上方 tokensClipRef 声明处注释）；
             ExpressionTokens mode="single" 只负责其内部 token 的不换行布局。 -->
        <span ref="tokensClipRef" class="expr-tokens-clip">
          <ExpressionTokens
            mode="single"
            :model-value="current"
            :source-tables="sourceTables"
            :form-tables="(formTables as any)"
          />
        </span>
        <span v-if="overflowing" class="expr-overflow-ellipsis" data-testid="expr-overflow-ellipsis" aria-hidden="true">…</span>
      </span>
      <Teleport to="body">
        <div
          v-if="popoverOpen && overflowing"
          class="expr-tokens-popover-body"
          data-testid="expr-tokens-popover"
          :style="popoverStyle"
        >
          <ExpressionTokens mode="wrap" :model-value="current" :source-tables="sourceTables" :form-tables="(formTables as any)" />
        </div>
      </Teleport>
    </template>

    <span class="spacer" />
    <div class="expr-actions">
      <!-- 「ƒ 表达式」入口：自由写 算术 / 函数 / CASE / 开窗 / 常量 -->
      <NButton
        v-if="advanced || exprOnly"
        size="tiny"
        quaternary
        class="mini adv-entry"
        data-testid="expr-fx-entry"
        :disabled="readonly"
        @click.stop="openAdvanced"
      >ƒ</NButton>
      <!-- ⊞ 快捷选择入口（值单元格三入口之一）：exprOnly 是整段布尔表达式槽，不是"值"概念，恒不渲染；
           其余场景默认开启（quickPick 缺省 true）。开启由本组件显式置位（不依赖 NPopover 自身
           trigger="click" 的内建切换——那需要事件合并到与我们的 @click.stop 完全相同的节点才不冲突，
           过于依赖 naive-ui 内部实现细节）；NPopover 的 trigger="click" 只用于承担其内建的
           点击外部自动收起。.stop 阻止事件冒泡到外层 .expr-input 触发 activate()。 -->
      <QuickFieldPicker
        v-if="!exprOnly"
        v-model:show="showQuickPick"
        :title="quickPickTitle"
        :source-tables="sourceTables"
        :form-tables="(formTables as any)"
        :dock-columns="dockColumns"
        :allow-null-const="allowNullConst"
        :current-first="quickPickCurrentFirst"
        :x="quickPickX"
        :y="quickPickY"
        @pick="handleInsert"
      >
        <template #trigger>
          <span class="qp-anchor" aria-hidden="true" />
        </template>
      </QuickFieldPicker>
      <!-- ✕ 清空常驻（UI 反馈 2026-09-07 二轮①）：此前随「有内容才显示」切换，清空后按钮消失、右侧入口组从
           两枚变一枚，值框内容区宽度跳变；且 V4 壳下"空"有多种形态（占位 const / 往返回来的空 text_source），
           显隐判据在不同阶段不一致。改为恒渲染，空值时点击是无害的空操作（emit null，模型已是空）。 -->
      <NButton size="tiny" quaternary class="mini" :disabled="readonly" data-testid="expr-clear" :title="clearTitle" @click.stop="clear">✕</NButton>
    </div>

    <AdvancedExpressionDialog
      v-if="showAdv"
      :show="showAdv"
      :model-value="current"
      :source-tables="sourceTables"
      :form-tables="(formTables as any)"
      :dock-columns="dockColumns"
      :empty-as-unconfigured="emptyAsUnconfigured"
      @update:show="v => (showAdv = v)"
      @confirm="applyAdvanced"
    />
  </div>
</template>

<style scoped>
.expr-input {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 32px;
  padding: 3px 8px 3px 4px;
  border: 1px solid rgb(var(--border-color, 220 223 230));
  border-radius: 4px;
  background: rgb(var(--container-bg-color, 255 255 255));
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
/* quickPick=false + preferQuickPick 时 QuickFieldPicker 的 0 尺寸定位锚点（见模板注释）。 */
.qp-anchor {
  width: 0;
  height: 0;
  overflow: hidden;
  flex: 0 0 auto;
}
.expr-input.active {
  border-color: rgb(var(--primary-color, 8 119 244));
  box-shadow: 0 0 0 2px rgb(var(--primary-color, 8 119 244) / 0.15);
}
/* P6c 只读：仅换光标视觉提示（内容仍可选中复制，不设 pointer-events:none）。 */
.expr-input--readonly {
  cursor: default;
}
/* 单行模式：值框恒不换行——胶囊区域超宽由 .expr-tokens-clip 的
   overflow:hidden 裁切 + 「…」指示承担，不再走 .expr-input 本身换行到第二行。 */
.expr-input--single-line {
  flex-wrap: nowrap;
}
.spacer {
  flex: 1 1 auto;
}
/* 空态短横杠（.expr-empty-dash）唯一定义处已随抽取搬到 ExpressionTokens.vue——
   两种 mode 渲染的空态占位共用同一份组件内 scoped 样式，本文件不再重复定义。 */
/* singleLine 悬浮 trigger 整行：包住胶囊裁切区 + 「…」指示，撑满值框剩余宽度，
   与非单行模式下 ExpressionTokens 直接占据的空间等价（不额外增减值框视觉宽度）。 */
.expr-tokens-row {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}
/* 胶囊裁切区：本文件自己的原生 span（测量边界，理由见 tokensClipRef 声明处注释），内嵌
   ExpressionTokens mode="single" 的 inline-flex 不换行内容——子级天然内容宽度不参与本容器的
   flex 收缩计算，超出父级分配宽度时被 overflow:hidden 裁切，scrollWidth 仍如实反映内容真实宽度。
   「…」指示是否显示由 JS 侧 ResizeObserver 比较 scrollWidth/clientWidth 判定，不依赖原生
   text-overflow，避免在 token 胶囊中间截断。 */
.expr-tokens-clip {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
/* 「…」溢出指示：固定宽度不参与收缩，恒排在胶囊裁切区之后、ƒ/✕ 按钮之前。 */
.expr-overflow-ellipsis {
  flex: 0 0 auto;
  margin-left: 2px;
  color: rgb(var(--text-hint-color));
}
/* 悬浮浮层：自绘（不依赖 naive-ui NPopover，理由见 popoverOpen 声明处头注释），Teleport 到 body，
   left/top 由 onTokensRowMouseEnter 按胶囊裁切区实测位置算好、内联写入 style。与胶囊裁切区不同，
   这里允许换行展示完整表达式（设计要求「自动换行」）；z-index 取一个明显高于普通页面内容、
   同时不至于压过原生浏览器 UI 的值，参照 naive-ui popover 的量级。 */
.expr-tokens-popover-body {
  position: fixed;
  z-index: 3000;
  max-width: 480px;
  padding: 8px 12px;
  border: 1px solid rgb(var(--border-lighter-color, 235 238 245));
  border-radius: 6px;
  background: rgb(var(--container-bg-color, 255 255 255));
  box-shadow: 0 6px 16px -9px rgb(0 0 0 / 8%), 0 9px 28px 0 rgb(0 0 0 / 5%), 0 12px 48px 16px rgb(0 0 0 / 3%);
  white-space: normal;
  word-break: break-word;
  line-height: 1.6;
}
.expr-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.mini {
  width: 16px;
  height: 16px;
  min-width: 16px;
  padding: 0;
  font-size: 12px;
}
.adv-entry {
  color: var(--n-text-color-3, #888);
  font-weight: 600;
}
/* token 语义色板见 ./token-colors.css（唯一定义处，随 ExpressionTokens.vue 头部 import，
   本文件不再消费 .tok 类，改由该组件渲染）。 */
</style>
