<script setup lang="ts">
import ExpressionDialogShell from './ExpressionDialogShell.vue';
import type { ValueRef } from './types';
import type { SourceTableLite, FormTableLite } from './rawSerialize';
import type { DockColumnsBundle } from './dockColumns';

/**
 * 表达式编辑器弹窗（单个取值表达式粒度）：③目标段每行的 ƒ 入口（经 ExpressionInput.vue）打开的就是它。
 */
defineProps<{
  show: boolean;
  modelValue: ValueRef | null;
  sourceTables: SourceTableLite[];
  formTables: FormTableLite[];
  /** 可选：父级（经 ExpressionInput.vue 透传自 ExpressionEditor.vue）已按模板归属精确分组好的树坞列。 */
  dockColumns?: DockColumnsBundle;
  /** ƒ 面板「删光文本→确定」的产出口径：true=不填充占位 {kind:'const'}；缺省 false=空字符串常量。 */
  emptyAsUnconfigured?: boolean;
}>();
const emit = defineEmits<{ 'update:show': [v: boolean]; confirm: [v: ValueRef] }>();
</script>

<template>
  <ExpressionDialogShell
    :show="show"
    purpose="value"
    shell-test-id="advanced-expression-dialog"
    prefs-key="advanced"
    :model-value="modelValue"
    :source-tables="sourceTables"
    :form-tables="formTables"
    :dock-columns="dockColumns"
    :empty-as-unconfigured="emptyAsUnconfigured"
    @update:show="emit('update:show', $event)"
    @confirm="emit('confirm', $event)"
  />
</template>
