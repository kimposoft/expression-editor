<script setup lang="ts">
import { KDialog, KDialogFooter } from '@kimposoft/ui-kit';
import type { JoinSpec } from './types';
import JoinSettingsPanel from './JoinSettingsPanel.vue';
import { useT } from './host';

/**
 * 表关联设计器（数据流左右分栏改版）：640 宽弹窗，内嵌既有 JoinSettingsPanel（逻辑零改动，
 * 只搬进弹窗壳）+ 顶部橙色「待配」来源清单（unlinked，未被任何 join 覆盖的显式来源，见
 * ExpressionEditor.vue 的 unlinkedAliases computed）。
 *
 * 到达路径三条（均由 ExpressionEditor.vue 驱动 show）：①来源面板头部「⋈ 表关联」入口 /
 * ②来源行尾橙色「未关联」徽标点击 / ③选完来源后若判定存在无法自动 record_id 联合的新增表，自动弹出。
 *
 * 与既有 NPopover+JoinSettingsPanel 内联弹层不同的是改走独立弹窗——JoinSettingsPanel 本身的
 * 增删改仍是**即时生效**（emit update:joins 直接经父级 update() 落盘，同原弹层行为，不是"确定才生效"
 * 的草稿模式，故本组件不设"取消"按钮丢弃改动的语义，右下角只有一个「确定」用于关闭）。
 *
 * 外壳：自 NModal + 手写 .jd-shell 迁到 KDialog。宽 640 > 480 按尺寸线走 standard 档
 * （原 16px 标题变为统一的 20px）；原来不能最大化 / 缩放 / 拖动，所以关闭这三项；原本就没有尺寸记忆，不新增。
 * 点遮罩无动作；页脚 KDialogFooter 隐藏取消，只留「确定」。
 */
defineProps<{
  show: boolean;
  joins: JoinSpec[];
  sourceOptions: { label: string; value: string }[];
  fieldOptions: (alias: string) => { label: string; value: string }[];
  /** 待配（未被任何 join 覆盖）的显式来源清单，供顶部橙色提示——自动弹出场景引导用户逐一处理。 */
  unlinked: { alias: string; label: string }[];
  defaultJoinType?: 'left' | 'inner';
  writeTargetAlias?: string;
}>();
const emit = defineEmits<{ 'update:show': [boolean]; 'update:joins': [JoinSpec[]] }>();

const t = useT();

function close(): void {
  emit('update:show', false);
}
</script>

<template>
  <KDialog
    size-preset="M"
    :show="show"
    :title="t('qb.joinDesignerTitle')"
    class="jd-shell"
    data-testid="join-designer-dialog"
    :default-size="{ width: 640, height: 520 }"
    :maximizable="false"
    :resizable="false"
    :draggable="false"
    @update:show="v => !v && close()"
  >
    <div class="jd-body">
      <div v-if="unlinked.length > 0" class="jd-pending">
        <div class="jd-pending-title">{{ t('qb.joinPendingTitle') }}</div>
        <div class="jd-pending-list">
          <span v-for="u in unlinked" :key="u.alias" class="jd-pending-chip">{{ u.label }}</span>
        </div>
      </div>
      <JoinSettingsPanel
        :joins="joins"
        :source-options="sourceOptions"
        :field-options="fieldOptions"
        :default-join-type="defaultJoinType"
        :write-target-alias="writeTargetAlias"
        @update:joins="v => emit('update:joins', v)"
      />
    </div>
    <template #footer>
      <!-- 即时生效的设置面板，没有可丢弃的草稿，所以只留「确定」（隐藏取消） -->
      <KDialogFooter hide-cancel :confirm-text="t('common.confirm')" @confirm="close" />
    </template>
  </KDialog>
</template>

<style scoped>
/* 内容区的内边距与滚动由 KDialog 提供，这里只留业务样式 */
.jd-body {
  min-height: 160px;
}
/* 待配来源提示：橙色系，与①来源行尾「未关联」徽标同一色板（--warning-color）。 */
.jd-pending {
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid rgb(var(--warning-color) / 0.35);
  border-radius: 6px;
  background: rgb(var(--warning-color) / 0.08);
}
.jd-pending-title {
  margin-bottom: 6px;
  font-size: 12.5px;
  color: rgb(var(--warning-color));
}
.jd-pending-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.jd-pending-chip {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgb(var(--warning-color) / 0.16);
  color: rgb(var(--warning-color));
  font-size: 12px;
}
</style>
