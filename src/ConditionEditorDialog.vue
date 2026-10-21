<script lang="ts">
import type { ConditionGroup as ConditionGroupType, TextSource as TextSourceType, ValueRef as ValueRefType } from './types';

/** ConditionEditorDialog 确定事件载荷。 */
export interface ConditionConfirmPayload {
  /** 确认时所处的模式：父级据此决定写 where（guided，并清 where_text_source）还是写 where + where_text_source（expr）。 */
  mode: 'guided' | 'expr';
  /** guided：编辑后的条件组；expr：文本降级产物（清空时为空组）。unchanged=true 时不携带。 */
  group?: ConditionGroupType;
  /** expr：文本模式 sidecar（清空时 null）。 */
  whereTextSource?: TextSourceType | null;
  /** expr：文本未改，父级保留既有 where + where_text_source。 */
  unchanged?: boolean;
  /** @deprecated raw where_expr 已退役，本弹窗不再产出；字段保留只为旧调用方的类型兼容。 */
  whereExpr?: ValueRefType | null;
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue';
import ExpressionDialogShell from './ExpressionDialogShell.vue';
import ConditionTree from './ConditionTree.vue';
import type { ConditionGroup, TextSource, ValueRef, TemplateField } from './types';
import type { DockColumnsBundle } from './dockColumns';
import type { TableFields } from './useExpressionContext';
import type { StagingSourceLite } from './stagingSourceLite';

/**
 * 筛选条件弹窗：②条件段（取数配置面，恒表达式模式）与宿主视图设计器（仍可能是引导式）打开的就是它。
 *
 * 本地缓冲语义（不变）：打开那一刻深拷贝父级 group / where_text_source 进本地态，「取消」不残留半途编辑；
 * 确定按当前 mode 回写一份（见 ConditionConfirmPayload）。
 */
const props = withDefaults(
  defineProps<{
    show: boolean;
    mode: 'guided' | 'expr';
    group: ConditionGroup;
    whereExpr?: ValueRef | null;
    /** 表达式模式的既有 sidecar（model.where_text_source）：有它就按原文恢复文本；无则从空文本开始。 */
    whereTextSource?: TextSource | null;
    sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[] }[];
    formTables: (TableFields & { alias?: string })[];
    stagingSource?: StagingSourceLite | null;
    dockColumns?: DockColumnsBundle;
    /** @deprecated 标题栏两态切换已移除（模式由②筛选条件面板头唯一决定），本 prop 不再有任何作用。 */
    allowModeSwitch?: boolean;
  }>(),
  { allowModeSwitch: true }
);
const emit = defineEmits<{
  'update:show': [boolean];
  /** 确定：mode='guided' 带编辑后的 group；mode='expr' 带降级产物 group + whereTextSource（清空时
   *  空组 + null）或 unchanged=true（文本未改）。 */
  confirm: [payload: ConditionConfirmPayload];
}>();

const localGroup = ref<ConditionGroup>(JSON.parse(JSON.stringify(props.group)));
/** 表达式模式的本地 sidecar 草稿（打开时拷自父级 where_text_source）。
 *  🔴 初值必须直接取 props：壳内面板在首帧就按它恢复文本，等 watch 再赋值就晚了。 */
const localWhereTextSource = ref<TextSource | null>(props.whereTextSource ? JSON.parse(JSON.stringify(props.whereTextSource)) : null);

/** 打开那一刻深拷贝父级当前值进本地态，保证「取消」不残留半途编辑（几何复位/聚焦由壳负责）。 */
watch(
  () => props.show,
  shown => {
    if (!shown) return;
    localGroup.value = JSON.parse(JSON.stringify(props.group));
    localWhereTextSource.value = props.whereTextSource ? JSON.parse(JSON.stringify(props.whereTextSource)) : null;
  }
);

function close(): void {
  emit('update:show', false);
}
/** 引导式确定：直接回写本地 group。 */
function onConfirmGuided(): void {
  emit('confirm', { mode: 'guided', group: localGroup.value });
  close();
}
/** 表达式模式：面板降级成功后回写父级 where + sidecar。清空文本时 condition/textSource 皆 null →
 *  父级收到空组 + null sidecar（= 清除条件）。壳已负责关闭。 */
function onConfirmWhere(payload: { condition: ConditionGroup | null; textSource: TextSource | null }): void {
  emit('confirm', {
    mode: 'expr',
    group: payload.condition ?? { logic: 'and', items: [] },
    whereTextSource: payload.textSource
  });
}
/** 文本未改（digest 不变）：不重新降级，父级保留既有 where + where_text_source 一对。 */
function onConfirmUnchanged(): void {
  emit('confirm', { mode: 'expr', unchanged: true });
}
</script>

<template>
  <ExpressionDialogShell
    :show="show"
    purpose="where"
    shell-test-id="condition-editor-dialog"
    prefs-key="condition"
    :body-mode="mode === 'guided' ? 'slot' : 'panel'"
    :text-source="localWhereTextSource"
    :source-tables="sourceTables"
    :form-tables="formTables"
    :staging-source="stagingSource"
    :dock-columns="dockColumns"
    @update:show="emit('update:show', $event)"
    @confirm-where="onConfirmWhere"
    @confirm-unchanged="onConfirmUnchanged"
    @confirm-body="onConfirmGuided"
  >
    <!-- 引导式主体（视图设计器仍在用）：经壳的 #body 插槽常驻挂载，mode='expr' 时被壳 v-show 隐藏。 -->
    <template #body>
      <ConditionTree
        :group="localGroup"
        :source-tables="sourceTables"
        :form-tables="formTables"
        :advanced="true"
        key-prefix="qbw"
        @update:group="v => (localGroup = v)"
      />
    </template>
  </ExpressionDialogShell>
</template>
