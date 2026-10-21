<script setup lang="ts">
import type { TemplateField, ValueRef } from './types';
import type { TableFields } from './useExpressionContext';
import FieldTreePanel from './FieldTreePanel.vue';

/**
 *
 * 向后兼容类名：NodeConfigDialog.vue里有一条 :deep(.drawer-tabs
 * .n-tab-pane) 选择器，专门覆盖旧 FieldDrawer 内部 NTabs 的 tab-pane 滚动行为（该弹窗布局下需要
 * 块级+独立滚动而非 flex 填充）。旧实现的 NTabs 元素本身带 `drawer-tabs` class；新实现委托给
 * FieldTreePanel（内部 NTabs 类名已改为 `ft-tabs`），故在此把 `drawer-tabs` 作为兼容类名透传到
 * FieldTreePanel 根元素上——CSS 后代选择器不要求直接父子关系，`.drawer-tabs .n-tab-pane` 仍可穿透
 * 匹配到 FieldTreePanel 内部的 tab-pane，NodeConfigDialog 的既有覆盖规则得以继续生效，无需改该文件。
 */
const props = defineProps<{
  /** viewFieldsUnsupported（views-extraction-b3 R3，可选）：view 来源且宿主不支持视图字段目录时为 true，
   *  该分组保留在列表并显示提示文案（否则零字段分组会被过滤而"静默消失"，用户不知为何没字段）。
   *  stagingUnsupported（Phase B，动作暂存区，可选）：同一范式——staging 来源但当前画布拓扑取不到
   *  「上一步暂存区」列（ExpressionEditor.vue 的 stagingSource prop 为空，如前驱节点被删）时为 true。
   *  externalFieldsUnsupported（S2b，外部数据表来源，可选）：同一范式——external 来源但宿主未实现
   *  host.getExternalSchema 时为 true。 */
  sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[]; viewFieldsUnsupported?: boolean; stagingUnsupported?: boolean; externalFieldsUnsupported?: boolean }[];
  /** 本报表各表（含为其预留的隐式 context 别名 alias）：点选产 source_field（本报表=物化临时表来源）。 */
  formTables: (TableFields & { alias: string })[];
}>();

const emit = defineEmits<{ insert: [ref: ValueRef] }>();
</script>

<template>
  <!-- FieldTreePanel 的 pick 即 FieldDrawer 既有的 insert（同一 ValueRef 结构），原样转发。 -->
  <FieldTreePanel class="drawer-tabs" :source-tables="props.sourceTables" :form-tables="props.formTables" @pick="ref => emit('insert', ref)" />
</template>
