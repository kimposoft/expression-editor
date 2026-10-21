<script setup lang="ts">
import { computed, inject, ref, useSlots } from 'vue';
import { useDialog, type DialogApi } from 'naive-ui';
import { KDialog, KDialogFooter, KDIALOG_CONFIRM_CLOSE, getKimpoUiHostDefaults } from '@kimposoft/ui-kit';
import AdvancedExpressionPanel from './AdvancedExpressionPanel.vue';
import SyntaxStatusLine from './SyntaxStatusLine.vue';
import type { ConditionGroup, LowerTextPurpose, TextSource, ValueRef } from './types';
import type { SourceTableLite, FormTableLite } from './rawSerialize';
import type { StagingSourceLite } from './stagingSourceLite';
import type { DockColumnsBundle } from './dockColumns';
import { EXPRESSION_HOST, useT, type EditorPrefs } from './host';

/**
 *   - value：单个取值表达式，确认产出 ValueRef（confirm 事件）；
 *   - where：整段筛选条件，确认产出条件组 + 文本 sidecar（confirmWhere / confirmUnchanged 事件）。
 * 两个既有组件 AdvancedExpressionDialog / ConditionEditorDialog 现为本壳的薄包装，对外 props/emits/
 * testid 逐字不变；壳根 data-testid 经 prop 注入（原最大化 / 缩放手柄的 testid 随 KDialog 窗控一并退役，
 * 改用 KDialog 自带的 .kdlg-btn / .kdlg-rz-se 选择器；页脚按钮改用 KDialogFooter 的 data-kdlf）。
 *
 * bodyMode='slot'：主体换成 #body 插槽内容（视图设计器仍在用的引导式条件树），此时页脚「确定」直接
 * emit confirmBody，不挂语法状态条、不做脏确认。提供了 #body 插槽时插槽主体与面板主体**同时挂载、
 * 按 bodyMode 用 v-show 切换**（两种主体的会话草稿都保活，是宿主侧既有测试锁定的行为）。
 */
const props = withDefaults(
  defineProps<{
    show: boolean;
    /** 文本用途：value=取值表达式；where=筛选条件谓词。决定标题缺省、面板降级用途与确认事件。 */
    purpose: LowerTextPurpose;
    /** 主体：panel（缺省）内嵌 AdvancedExpressionPanel；slot 显示 #body 插槽内容（引导式条件树）。 */
    bodyMode?: 'panel' | 'slot';
    /** 标题覆盖；缺省按 purpose 取「筛选条件」/「表达式编辑器」译文。 */
    title?: string;
    /** 壳根元素 data-testid。 */
    shellTestId?: string;
    /** 几何记忆命名空间（EditorPrefs.advanced / .condition）；缺省按 purpose：value→advanced、where→condition。
     *  两者分开是因为可在同一会话先后打开，共用键会互相覆盖尺寸。 */
    prefsKey?: 'advanced' | 'condition';
    /** purpose=value 的编辑对象（打开那一刻由面板拍平成文本）。 */
    modelValue?: ValueRef | null;
    /** purpose=where 的既有 sidecar（有它按原文恢复，无则从空文本开始）。 */
    textSource?: TextSource | null;
    sourceTables: SourceTableLite[];
    formTables: FormTableLite[];
    stagingSource?: StagingSourceLite | null;
    /** 父级已按模板归属分好的树坞列；未传由面板按 Lite 形态降级构造。 */
    dockColumns?: DockColumnsBundle;
    /** purpose=value：空文本确认时产出「未配置」占位而非空串常量（见面板 confirm 空文本分支）。 */
    emptyAsUnconfigured?: boolean;
  }>(),
  { bodyMode: 'panel', modelValue: null, textSource: null }
);
const emit = defineEmits<{
  'update:show': [v: boolean];
  /** purpose=value：面板校验/降级通过后的 ValueRef。 */
  confirm: [v: ValueRef];
  /** purpose=where：降级后的条件组 + sidecar（文本清空时两者皆 null）。 */
  confirmWhere: [payload: { condition: ConditionGroup | null; textSource: TextSource | null }];
  /** purpose=where 且文本未改：宿主保留既有 where + where_text_source。 */
  confirmUnchanged: [];
  /** bodyMode=slot：点「确定」，由插槽主体的持有方自行取值回写。 */
  confirmBody: [];
}>();

const t = useT();
const slots = useSlots();
const hasBodySlot = computed(() => !!slots.body);
const title = computed(() => props.title ?? t(props.purpose === 'where' ? 'qb.conditionEditorTitle' : 'dialog.title'));

let dialog: DialogApi | null = null;
try {
  dialog = useDialog();
} catch {
  dialog = null;
}

const panelRef = ref<InstanceType<typeof AdvancedExpressionPanel> | null>(null);
/** KDialog 实例：取外壳元素（量高度）与 requestClose（取消按钮走带脏确认的关闭流程）。 */
const dialogRef = ref<InstanceType<typeof KDialog> | null>(null);

// —— 窗口尺寸记忆——
// 沿用原实现的 EditorPrefs 命名空间（advanced / condition 两个，分开是因为可在同一会话先后打开，共用键会互相覆盖尺寸），
// 不新增任何存储键；用户已记住的尺寸不丢。
// host 用 inject(…, null) 而非 useExpressionHost()：后者缺 provider 时**抛错**，而本壳也被表格编辑器等
// 不保证提供 ExpressionHost 的调用方使用；持久化是可选增强，拿不到 host 就退化成「每次按默认尺寸打开」。
const host = inject(EXPRESSION_HOST, null);
const prefsKey = computed<'advanced' | 'condition'>(() => props.prefsKey ?? (props.purpose === 'value' ? 'advanced' : 'condition'));
function loadPrefs(): { width?: number; height?: number; wr?: number; hr?: number } | null {
  const all = host?.loadEditorPrefs?.() ?? null;
  return (prefsKey.value === 'advanced' ? all?.advanced : all?.condition) ?? null;
}
function savePrefs(patch: { width?: number; height?: number; wr?: number; hr?: number }): void {
  if (!host?.saveEditorPrefs) return;
  const existing = host.loadEditorPrefs?.() ?? null;
  const next: EditorPrefs = { ...existing };
  if (prefsKey.value === 'advanced') next.advanced = { ...(existing?.advanced ?? {}), ...patch };
  else next.condition = { ...(existing?.condition ?? {}), ...patch };
  host.saveEditorPrefs(next);
}
/** KDialog 尺寸记忆适配器：memoryKey 只是启用开关，真正的存取键由 prefsKey 决定（见上）。 */
const dialogMemoryStore = {
  load: () => loadPrefs(),
  save: (_key: string, size: { width: number; height: number; wr?: number; hr?: number }) => savePrefs(size)
};

const DEFAULT_WIDTH = 830;
const DEFAULT_HEIGHT = 660;

function close(): void {
  emit('update:show', false);
}

const isDirty = computed(() => props.bodyMode === 'panel' && !!panelRef.value?.dirty);
function confirmDiscard(): Promise<boolean> {
  if (!dialog) return Promise.resolve(true);
  const api = dialog;
  return new Promise<boolean>(resolve => {
    api.warning({
      title: t('dialog.discardTitle'),
      content: t('dialog.discardContent'),
      positiveText: t('common.confirm'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false)
    });
  });
}
// 宿主是否已提供默认关闭确认：inject（宿主应用树内）或模块级宿主默认值（插件独立 createApp 时 inject 落空）
const injectedConfirmClose = inject(KDIALOG_CONFIRM_CLOSE, null);
/** 传给 KDialog 的 confirmClose：宿主有就不传（undefined，让 KDialog 自己走 inject → 宿主默认值），否则传本包兜底。 */
function fallbackConfirmClose(): (() => Promise<boolean>) | undefined {
  return injectedConfirmClose || getKimpoUiHostDefaults().confirmClose ? undefined : confirmDiscard;
}
/** 取消 / 标题栏关闭：走 KDialog 的关闭流程（dirty 时先确认）；KDialog 尚未就绪时直接关。 */
function requestClose(): void {
  if (dialogRef.value) void dialogRef.value.requestClose();
  else close();
}

/**
 * Esc 内层分流：函数「更多」目录 → 树坞搜索清空，
 * 返回 true 表示已消费；返回 false 时 KDialog 继续「从最大化还原 → 关闭（dirty 先确认）」。
 * 否则用户搜到一半按 Esc 会直接关掉弹窗、丢掉正在写的表达式。
 * 弹层栈在 window 捕获阶段派发，先于树坞搜索框自带的 @keydown.esc="clearSearch"，所以此处读到的
 * searching 仍是按键前的真实状态（原实现要绑捕获阶段就是为了这个顺序，现由栈保证）。
 */
function onEscapeInner(): boolean {
  const panel = props.bodyMode === 'panel' ? panelRef.value : null;
  if (panel?.isFunctionCatalogOpen()) {
    panel.closeFunctionCatalog();
    return true;
  }
  if (panel?.isSearching()) {
    panel.clearSearch();
    return true;
  }
  return false;
}
/**
 * 函数目录是 NPopover，开着时弹层栈会把 Esc 让给 Naive 弹层，而 NPopover 自己不响应 Esc；
 * 所以外壳捕获阶段再兜一道：目录开着时 Esc 只收目录，不再往下传（原 onShellKeydown 的第一级）。
 */
function onShellKeydownCapture(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const panel = props.bodyMode === 'panel' ? panelRef.value : null;
  if (!panel?.isFunctionCatalogOpen()) return;
  e.stopPropagation();
  panel.closeFunctionCatalog();
}

/** 确定：面板主体委托面板校验 + 降级（结果经其 confirm/confirmWhere/confirmUnchanged 事件回抛）；
 *  插槽主体直接 emit confirmBody 交给持有方。 */
function onConfirmClick(): void {
  if (props.bodyMode === 'panel') void panelRef.value?.confirm();
  else emit('confirmBody');
}
function onPanelConfirm(v: ValueRef): void {
  emit('confirm', v);
  close();
}
function onPanelConfirmWhere(payload: { condition: ConditionGroup | null; textSource: TextSource | null }): void {
  emit('confirmWhere', payload);
  close();
}
function onPanelConfirmUnchanged(): void {
  emit('confirmUnchanged');
  close();
}
</script>

<template>
  <!-- 外壳迁到 KDialog：standard 档、可最大化 / 缩放 / 记忆尺寸；点遮罩无动作；
       dirty 且面板有改动时关闭先确认（确认框优先用宿主统一实现，仅无宿主时回退本包 Naive 确认框，见 fallbackConfirmClose）。exd-shell 类名保留作稳定选择器（宿主 / 插件测试与样式锚点）。 -->
  <KDialog
    size-preset="M"
    ref="dialogRef"
    :show="show"
    :title="title"
    class="exd-shell"
    :data-testid="shellTestId"
    :default-size="{ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }"
    :memory-key="`expression-editor-${prefsKey}`"
    :memory-store="dialogMemoryStore"
    :flush="bodyMode === 'panel'"
    :dirty="isDirty"
    :confirm-close="fallbackConfirmClose()"
    :escape-interceptor="onEscapeInner"
    @update:show="emit('update:show', $event)"
    @keydown.capture="onShellKeydownCapture"
  >
    <!-- flush 仅面板主体：面板内部各区自带内边距，外层不再加一圈（两层叠加会把面板按 shell-height 换算的可用高度挤穿）；
         插槽主体（引导式）沿用 KDialog 内容区的 16/24 内边距并可滚动 -->
    <div class="exd-body" :class="{ 'exd-body--panel': bodyMode === 'panel' }">
      <!-- 插槽主体（引导式条件树等）：提供了插槽就常驻挂载，按 bodyMode 切可见态。 -->
      <div v-if="show && hasBodySlot" v-show="bodyMode === 'slot'" class="exd-mode-content">
        <slot name="body" />
      </div>
      <!-- 面板主体：show 转发本壳的 show（面板据此在打开那一刻拍平/恢复文本）；统一采用紧凑外观——
           隐藏常驻说明、九项常用函数 + 更多、语法状态条外置到页脚。 -->
      <div v-if="show" v-show="bodyMode === 'panel'" class="exd-mode-content exd-mode-content--panel">
        <AdvancedExpressionPanel
          ref="panelRef"
          :show="show"
          :purpose="purpose"
          :model-value="purpose === 'value' ? modelValue : null"
          :text-source="purpose === 'where' ? textSource : null"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :staging-source="stagingSource"
          :dock-columns="dockColumns"
          :empty-as-unconfigured="emptyAsUnconfigured"
          :hide-persistent-hints="true"
          :compact-function-bar="true"
          syntax-status-placement="external"
          @confirm="onPanelConfirm"
          @confirm-where="onPanelConfirmWhere"
          @confirm-unchanged="onPanelConfirmUnchanged"
        />
      </div>
    </div>
    <template #footer>
      <!-- 页脚：小档按钮取消在左、确定在右；语法状态条并入页脚左侧 extra、与按钮同一行：
           状态由面板持有（面板自己不渲染），这里读其 expose。
           原按钮 testid（adv-expression-cancel / adv-expression-confirm）随 KDialogFooter 退役，改用其 data-kdlf。 -->
      <KDialogFooter
        class="exd-footer"
        :confirm-disabled="bodyMode === 'panel' && (panelRef?.confirmDisabled ?? false)"
        @cancel="requestClose"
        @confirm="onConfirmClick"
      >
        <template #extra>
          <div class="exd-footer-status">
            <SyntaxStatusLine
              v-if="bodyMode === 'panel' && panelRef"
              :state="panelRef.syntaxState"
              :label="panelRef.syntaxLabel"
              :detail="panelRef.syntaxDetail"
              @jump="panelRef.focusIssue()"
            />
          </div>
        </template>
      </KDialogFooter>
    </template>
  </KDialog>
</template>

<style scoped>
/* 外壳几何 / 标题栏 / 页脚 / 圆角阴影 / 最大化 / 八向缩放全部由 KDialog 提供，
   🔴 外壳不能 overflow:hidden：
   naive 会把弹窗内的 NPopover 传送进 NModal 的 body 元素，一裁就没；KDialog 外壳 overflow:visible，
   各区各自滚动（KDialog 内容区 / 面板编辑区）。 */
/* 主体：撑满 KDialog 内容区；各区自己滚动，外层不叠内边距（内边距见模板注释）。 */
.exd-body {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}
.exd-mode-content {
  min-height: 0;
  flex: 1 1 auto;
}
.exd-mode-content--panel {
  display: flex;
  flex-direction: column;
}
/* 状态条槽：吃掉剩余宽度、可收缩，长明细在 SyntaxStatusLine 内单行省略（放在 KDialogFooter 的 extra 里）。 */
.exd-footer-status {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
}
</style>
