<script lang="ts">
/**
 * 模块级共享滚动位置（2026-09-02）：用户连续给多个字段做快捷填充时，本面板每次都从头滚很低效——
 * 上一个实例滚到哪，下一个实例打开就停在哪。模块作用域天然跨实例共享；只存像素值不存 DOM 引用，
 * 页面内多处挂载/卸载互不干扰。会话内存活即可，不落 localStorage（换页面/换数据即失义）。
 */
let qfpSharedScrollTop = 0;
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { NEmpty, NInput, NPopover } from 'naive-ui';
import type { TemplateField, ValueRef } from './types';
import type { DockColumnsBundle } from './dockColumns';
import { buildDockColumnsFromLite } from './dockColumns';
import type { FormTableLite, SourceTableLite } from './rawSerialize';
import { systemVariablesCatalog, isFieldTypeUnsupported } from './useExpressionContext';
import { matchField } from './fieldSearch';
import { useT, useExpressionEditorScopeOptions } from './host';
import FieldTypeIcon from './FieldTypeIcon.vue';
import { tableColorClassFor } from './tableThemeColors';

/**
 * ⊞ 快捷字段选择器（值单元格三入口之一：点值区 / ⊞ 快捷选择 / ✕ 清空）。
 *
 * 【为什么不走 expressionDrawerBus】expressionDrawerBus 是"单激活槽"总线——同一时刻全页只有一个槽能
 * 被激活，插入路由到该槽的处理器；这要求存在一个**持久常驻**的字段抽屉/树坞供用户点选（见
 * ExpressionEditor.vue 内嵌的 FieldTreeDock）。但本组件恰恰是给**没有任何常驻字段树**的调用域
 * （FromDataPipeline 已移除 FieldDrawer、ViewDesigner 的两个画布从未有过树坞）兜底的——这些域挂载
 * ExpressionInput 时若仍复用总线的 setActive，点击空值区只会把自己注册成"激活槽"，但没有树可点、
 * 没有 UI 能触发 insert()，用户点了只看到蓝框高亮、毫无后续反馈（即任务单描述的"死点击"）。
 * 因此本组件自持数据与开关状态（source/formTables 直接作为 props 传入、show 由调用方 v-model 控制），
 * 不注册进总线，也不会与页面上其余 27 处 ExpressionInput 挂载的单激活槽互踢。
 *
 * 数据入参与 AdvancedExpressionDialog.vue 同款（sourceTables/formTables/dockColumns?，未传时用
 * buildDockColumnsFromLite 降级构造），点选语义照抄 FieldTreeDock 的 pickField/pickVar（field 恒
 * emit kind='source_field'，无论来自「本报表」bt* 列还是显式来源 t* 列——读取端按 alias 前缀分流，
 * 不是本组件要关心的事）。搜索过滤复用 fieldSearch.ts 的 matchField，与 FieldTreeDock/FieldTreePanel
 * 同一份判据，不另发明一套。
 */
const props = defineProps<{
  /** 受控开关：popover 是否展开，由调用方（ExpressionInput）以 v-model:show 驱动。 */
  show: boolean;
  /** 头部「插入到 <字段名/槽位标题>」的标题片段；未传时头部只显示前缀，不拼接冒号+空标题。 */
  title?: string;
  sourceTables: SourceTableLite[];
  formTables: FormTableLite[];
  /** 可选：父级已按模板归属精确分组好的树坞列（同 AdvancedExpressionDialog 的同名 prop）。 */
  dockColumns?: DockColumnsBundle;
  /** 「空值」快捷选项（条件筛选新增）：true 时在列表最前追加一项，点选即 emit kind='const'+value=null
   *  的真正空值常量（与「为空/不为空」判空算子并存，不是替代）。缺省 false——本组件挂载点很多
   *  （输出映射/图表目标/暂存目标等），只有 ConditionTree.vue 的条件值输入按语义需要它，其余调用方
   *  不传即不受影响。 */
  allowNullConst?: boolean;
  /** ⊞ 面板跟随指针弹出的定位坐标：均传入时面板改按
   *  该坐标定位（等同 naive-ui NPopover 自身 x/y「手动定位」模式，判据同它——两者都传才生效）；
   *  缺一个（多为未传，即调用方无鼠标事件可用，如键盘触发 / 「插完跳下一行」自动 activate()）时保持
   *  既有 trigger 锚点定位，行为不变。 */
  x?: number;
  y?: number;
  /** 本报表分组置顶：true 时
   *  本报表（当前模板各表）整体排在最前，其后才是显式来源表（及写模式「目标」组）——这两类动作要拿
   *  本报表的值去匹配/修改，本报表字段是高频目标。缺省 false 维持「来源在前、本报表垫底」既有顺序，
   *  其余挂载点（取数输出、条件、图表/暂存目标等）零变化。 */
  currentFirst?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [v: boolean];
  pick: [v: ValueRef];
}>();

const t = useT();

const scope = useExpressionEditorScopeOptions();
/** 「变量」组实际展示的变量目录：scope.disableSystemVariables 为真时恒空，不改
 *  systemVariablesCatalog 单例本身内容（同 FieldTreeDock.vue 的 visibleSystemVariables 注释）。 */
const visibleSystemVariables = computed(() => (scope.disableSystemVariables.value ? [] : systemVariablesCatalog.value));
/** 某字段 data_type 是否命中当前子树的置灰名单。 */
function fieldUnsupported(dataType?: string | null): boolean {
  return isFieldTypeUnsupported(dataType, scope.unsupportedFieldTypes.value);
}

/** 树坞列：优先用父级精确分组，未传时从 Lite 形态降级构造（口径与 AdvancedExpressionDialog 完全一致）。 */
const dockColumnsResolved = computed<DockColumnsBundle>(
  () => props.dockColumns ?? buildDockColumnsFromLite(props.sourceTables, props.formTables, t('drawer.tabForm'))
);

/** 头部标题：有 title 时「插入到：<title>」，否则只显示前缀本身，不留下多余的空冒号。 */
const headerText = computed(() => (props.title ? `${t('quickPick.insertInto')}：${props.title}` : t('quickPick.insertInto')));

/** ⊞ 面板跟随指针——视口钳制估算尺寸：面板固定宽 360（同下方
 *  NPopover :width），高度按 header + 搜索框 + 列表上限 320 + 内外边距估算 420；面板本身不可拖拽/
 *  缩放，不必像 useDialogGeometry 那样按真实 DOM 量测，钳制目标只是「整条不越界」而非像素级贴边，
 *  固定估算值够用。 */
const QFP_PANEL_WIDTH = 360;
const QFP_PANEL_HEIGHT_ESTIMATE = 420;
const QFP_VIEWPORT_MARGIN = 8;
/** x/y 均传入才进坐标定位模式（判据同 naive-ui NPopover 自身 positionManuallyRef：`x !== undefined &&
 *  y !== undefined`），否则透传 undefined 令 NPopover 回落既有 trigger 锚点定位。进入坐标模式时按
 *  上方估算尺寸把左上角钳制在视口内，避免点击靠近右/下边缘时面板被裁切到视口外。 */
const resolvedX = computed<number | undefined>(() => {
  if (props.x === undefined || props.y === undefined) return undefined;
  const maxX = Math.max(QFP_VIEWPORT_MARGIN, window.innerWidth - QFP_PANEL_WIDTH - QFP_VIEWPORT_MARGIN);
  return Math.min(Math.max(props.x, QFP_VIEWPORT_MARGIN), maxX);
});
const resolvedY = computed<number | undefined>(() => {
  if (props.x === undefined || props.y === undefined) return undefined;
  const maxY = Math.max(QFP_VIEWPORT_MARGIN, window.innerHeight - QFP_PANEL_HEIGHT_ESTIMATE - QFP_VIEWPORT_MARGIN);
  return Math.min(Math.max(props.y, QFP_VIEWPORT_MARGIN), maxY);
});

// —— 搜索（复用 drawer.searchPlaceholder 既有键，判据复用 fieldSearch.matchField，同 FieldTreeDock）——
const keyword = ref('');
const lowerKeyword = computed(() => keyword.value.trim().toLowerCase());
const searching = computed(() => lowerKeyword.value.length > 0);
// popover 每次收起都清空搜索，重开是"干净"的一次新选择，不带着上次的过滤条件。
// 滚动位置例外（2026-09-02）：跨实例共享、重开还原——连续填多个字段时不必每次从头找（见模块级
// qfpSharedScrollTop 注释）。还原等 nextTick：v-if 内容此刻才挂载；scrollTop 超出内容高度由浏览器自动钳制。
watch(
  () => props.show,
  s => {
    if (!s) {
      keyword.value = '';
      return;
    }
    nextTick(() => {
      if (listEl.value) listEl.value.scrollTop = qfpSharedScrollTop;
    });
  }
);
const listEl = ref<HTMLElement | null>(null);
function onListScroll(): void {
  if (listEl.value) qfpSharedScrollTop = listEl.value.scrollTop;
}

/** Esc 自卫：受控 show 模式下 NPopover 不吃 Esc，事件会一路冒泡到宿主设置
 *  弹窗的 document 监听、把整个外壳连未保存草稿一起关掉（数据丢失级）。且焦点常在触发按钮或 body
 *  上（点选字段后尤甚）——元素级 @keydown 根本收不到按键，故必须像 ConditionEditorDialog 的实测
 *  经验一样绑 **document 捕获阶段**：面板开着时 Esc 只收起面板并 stop，分级交还外层。
 *  仅 show=true 的实例挂监听，多实例互不干扰；组件卸载兜底移除。 */
function onDocEscCapture(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  e.preventDefault();
  emit('update:show', false);
}
watch(
  () => props.show,
  s => {
    if (s) document.addEventListener('keydown', onDocEscCapture, true);
    else document.removeEventListener('keydown', onDocEscCapture, true);
  },
  { immediate: true }
);
onBeforeUnmount(() => document.removeEventListener('keydown', onDocEscCapture, true));

/** 一个扁平分组：标题「模板/来源 · 表」（唯一表且列头即表名时省略中点，避免「订单 · 订单」这类冗余），
 *  alias 供点选时随 field_id 一并 emit。 */
interface FlatGroup {
  key: string;
  label: string;
  alias: string;
  fields: TemplateField[];
}
/** 「按模板 · 表分组的字段」：把树坞列（各数据源列 + 当前模板列）拍平成一维分组列表——本组件是
 *  360px 紧凑 popover，FieldTreeDock 那套「列头 + 可折叠表节点」两层结构在这里放不下，也没必要，
 *  拍平成「一个分组一张表」更贴合快捷选择的使用场景（找到就点，不需要来回折叠）。
 *  分组顺序（2026-09-02 改版）：显式来源表按其配置先后顺序在前，本报表（当前模板各表）整体
 *  垫底——快捷选择的高频目标是来源表字段，本表字段沿用其在 sources 之后的兜底位。
 *  例外（2026-09-28）：props.currentFirst 为真时本报表整体置顶，来源表顺序不变、顺延其后。 */
const allGroups = computed<FlatGroup[]>(() => {
  const { sources, current } = dockColumnsResolved.value;
  const cols = props.currentFirst ? [current, ...sources] : [...sources, current];
  const groups: FlatGroup[] = [];
  for (const col of cols) {
    for (const tb of col.tables) {
      // 降级提示分组（viewFieldsUnsupported/stagingUnsupported）本身无字段可选，快捷选择器里跳过，
      // 提示文案该去哪由 ƒ 表达式编辑器的树坞承担，本组件只做「能点选」的字段。
      if (tb.fields.length === 0) continue;
      const label = col.tables.length === 1 && col.header === tb.label ? tb.label : `${col.header} · ${tb.label}`;
      groups.push({ key: `${col.header}::${tb.alias}`, label, alias: tb.alias, fields: tb.fields });
    }
  }
  return groups;
});
/** 搜索后的分组：字段按 matchField 过滤，过滤后一个都不剩的分组整体剔除。 */
const filteredGroups = computed<FlatGroup[]>(() => {
  if (!searching.value) return allGroups.value;
  return allGroups.value
    .map(g => ({ ...g, fields: g.fields.filter(f => matchField(f, lowerKeyword.value)) }))
    .filter(g => g.fields.length > 0);
});

// 「变量」组：口径与 FieldTreeDock 的 vars 过滤逻辑一致（label/var_id 双路大小写不敏感包含匹配）。
// 复用既有 drawer.tabVars 作组标题——语义完全等价「变量」，不新增一条 key。
// 2026-09-12 追加：底数据源从 systemVariablesCatalog 改为 visibleSystemVariables——
// 后者已叠加本子树的 disableSystemVariables 开关，为真时恒空数组，变量组不出现。
const filteredVars = computed(() => {
  if (!searching.value) return visibleSystemVariables.value;
  return visibleSystemVariables.value.filter(
    v => v.label.toLowerCase().includes(lowerKeyword.value) || v.var_id.toLowerCase().includes(lowerKeyword.value)
  );
});

// 「空值」快捷项：随搜索关键字一并过滤（与变量组同一判据——按当前语言下的展示文案做大小写不敏感
// 包含匹配），未搜索时恒显示（allowNullConst=true 时）。
const nullConstLabel = computed(() => t('common.nullValue'));
const showNullConst = computed(() => {
  if (!props.allowNullConst) return false;
  if (!searching.value) return true;
  return nullConstLabel.value.toLowerCase().includes(lowerKeyword.value);
});

const isEmpty = computed(() => filteredGroups.value.length === 0 && filteredVars.value.length === 0 && !showNullConst.value);

/** 点选字段：口径照抄 FieldTreeDock.pickField——恒 emit kind='source_field'（本报表 bt* 与显式来源 t*
 *  共用同一套语义，读取端按 alias 前缀分流），选中后自动关闭（任务单要求）。
 *  2026-09-12 追加：命中调用方「置灰名单」（fieldUnsupported）的字段直接拦下，
 *  不 emit 也不关闭面板——与模板里 .qfp-item--unsupported 置灰视觉配套，同 FieldTreeDock.pickField
 *  同一判据、同一拦截手法。 */
function pickField(alias: string, field: TemplateField): void {
  if (fieldUnsupported(field.data_type)) return;
  emit('pick', { kind: 'source_field', alias, field_id: field.field_id });
  emit('update:show', false);
}
/** 点选变量：口径照抄 FieldTreeDock.pickVar。 */
function pickVar(varId: string): void {
  emit('pick', { kind: 'system_var', var_id: varId });
  emit('update:show', false);
}
/** 点选「空值」：emit 真正的 JSON null 常量（kind='const', value=null），不是空字符串/字面量文本
 *  "NULL"。与「为空/不为空」判空算子并存——用户可以在 =/≠/NOT IN 等常规算子下直接把右值设为空值，
 *  不必换成判空算子。 */
function pickNullConst(): void {
  emit('pick', { kind: 'const', value: null });
  emit('update:show', false);
}
/** 点面板外部 → 收起自己（见模板 on-clickoutside 注释：手动定位模式下 naive 不自动挂 clickoutside）。
 *  不再判 props.show：naive 只在面板展开时才回调 onClickoutside（Popover.handleClickOutside 先查
 *  getMergedShow），这里无条件置 false 即可。 */
function onClickOutside(): void {
  emit('update:show', false);
}
</script>

<template>
  <!-- trigger="click" + 受控 show：点触发按钮由 NPopover 自身的点击切换逻辑处理（开/关都对），
       点击外部/Esc 由其内置 clickoutside 处理自动收起；preferQuickPick 域的"点空值区直接打开"
       走 ExpressionInput 侧对 show 的编程式赋值，同一条受控通路，不冲突。
       🔴 on-clickoutside 必须显式传：naive-ui
       2.44 的 PopoverBody 在 x/y 手动定位模式（positionManually）下**不再自动挂** clickoutside 指令，
       只有给了 onClickoutside 才挂——跟随指针弹出后，点别的行/空白处上一块面板不会收起，多行连点
       就叠出好几块。这里显式接上并收起自己；非手动定位（锚点）模式下 naive 会自动挂一份，两份都
       只是置 false，重复无害。 -->
  <NPopover
    :show="show"
    trigger="click"
    placement="bottom-start"
    :show-arrow="false"
    :width="QFP_PANEL_WIDTH"
    :x="resolvedX"
    :y="resolvedY"
    :on-clickoutside="onClickOutside"
    @update:show="v => emit('update:show', v)"
  >
    <template #trigger>
      <slot name="trigger" />
    </template>
    <!-- @click.stop：popover 内容真实生产环境经 NPopover 默认 teleport 到 body、天然脱离 .expr-input
         的 DOM 子树，不会冒泡触发外层 activate()；这里仍显式挡一道，防御性隔离——不依赖"content
         是否被 teleport"这一实现细节（单测用简化 stub 不做 teleport，真实挂载点也可能被上层改动）。
         Esc 自卫走 script 里的 document 捕获监听（onDocEscCapture），不在此处绑元素级 keydown——
         焦点常在触发按钮/body 上，元素级根本收不到，详见 script 注释。 -->
    <div class="qfp-panel" data-testid="quick-field-picker-panel" @click.stop>
      <div class="qfp-header">{{ headerText }}</div>
      <NInput v-model:value="keyword" size="small" clearable class="qfp-search" :placeholder="t('drawer.searchPlaceholder')" />
      <div ref="listEl" class="qfp-list" @scroll.passive="onListScroll">
        <!-- 「空值」快捷项：置顶独立一行（不归在任何表/变量分组下），仅 allowNullConst=true 的
             调用方（ConditionTree.vue 条件值输入）显示。 -->
        <div v-if="showNullConst" class="qfp-group">
          <div class="qfp-item qfp-item-null" data-testid="quick-field-picker-null" @click="pickNullConst">
            <span class="qfp-item-name">{{ nullConstLabel }}</span>
            <span class="qfp-item-alias">NULL</span>
          </div>
        </div>
        <div v-for="g in filteredGroups" :key="g.key" class="qfp-group">
          <div class="qfp-group-title">
            <!-- 表主题色圆点（2026-09-02 草案）：来源表按别名取色，本报表 bt* 回落中性灰——与①来源行/
                 字段树坞/表达式 token 同色同源，快速对上"这组字段是哪张表的"。 -->
            <span class="ttc-dot qfp-group-dot" :class="tableColorClassFor(g.alias, props.sourceTables)" aria-hidden="true" />
            {{ g.label }}
          </div>
          <!-- 2026-09-12 追加：命中调用方 unsupportedFieldTypes 置灰名单的字段——保留展示，
               置灰 + title 提示「暂不支持」，pickField 内部已拦截点选，这里仅负责视觉与 aria-disabled。 -->
          <div
            v-for="f in g.fields"
            :key="f.field_id"
            class="qfp-item"
            :class="{ 'qfp-item--unsupported': fieldUnsupported(f.data_type) }"
            :title="fieldUnsupported(f.data_type) ? t('drawer.fieldTypeUnsupported') : undefined"
            :aria-disabled="fieldUnsupported(f.data_type) || undefined"
            :data-source-alias="g.alias"
            :data-field-id="f.field_id"
            @click="pickField(g.alias, f)"
          >
            <span class="qfp-item-name">{{ f.field_name }}</span>
            <!-- 行尾标（2026-09-02 改版）：原所属表别名文字（bt0/t1 等，对用户是内部实现细节）
                 改为字段数据类型图标；表归属信息由分组标题承担，不再重复。 -->
            <FieldTypeIcon :data-type="f.data_type" />
          </div>
        </div>
        <div v-if="filteredVars.length > 0" class="qfp-group">
          <div class="qfp-group-title">{{ t('drawer.tabVars') }}</div>
          <div v-for="v in filteredVars" :key="v.var_id" class="qfp-item" @click="pickVar(v.var_id)">
            <span class="qfp-item-name">{{ v.label }}</span>
            <!-- 变量行尾标同批改版：原 var 字样改为 @ 变量图标，与字段行的类型图标视觉统一。 -->
            <FieldTypeIcon data-type="variable" />
          </div>
        </div>
        <NEmpty v-if="isEmpty" size="small" :description="t('editor.dockNoMatch')" />
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.qfp-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.qfp-header {
  font-size: 12.5px;
  font-weight: 600;
  color: rgb(var(--base-text-color));
}
.qfp-search :deep(.n-input__border),
.qfp-search :deep(.n-input__state-border) {
  border-color: rgb(var(--border-deep-color));
}
.qfp-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}
.qfp-group {
  display: flex;
  flex-direction: column;
}
.qfp-group-title {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 4px 2px;
  font-size: 11.5px;
  color: rgb(var(--text-hint-color));
}
/* 分组圆点略缩一号（分组标题字号小），色值来自全局 ttc-N 变量。 */
.qfp-group-dot {
  width: 7px;
  height: 7px;
}
.qfp-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: rgb(var(--base-text-color));
}
.qfp-item:hover {
  background: rgb(var(--fill-light-color));
}
/* 置灰不可选：命中调用方 unsupportedFieldTypes 的字段——弱化文字色 + 不可点
 * 光标，hover 不再变色，提示文案经 title 属性呈现（见模板）。 */
.qfp-item--unsupported {
  color: rgb(var(--text-hint-color));
  cursor: not-allowed;
}
.qfp-item--unsupported:hover {
  background: none;
}
/* 「空值」快捷项：斜体次要色，与常规字段/变量项（实色）视觉区分——它不是一个"数据"，是一个特殊常量。 */
.qfp-item-null .qfp-item-name {
  font-style: italic;
  color: rgb(var(--text-secondary-color));
}
.qfp-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qfp-item-alias {
  flex-shrink: 0;
  color: rgb(var(--text-hint-color));
  font-size: 11px;
}
</style>
