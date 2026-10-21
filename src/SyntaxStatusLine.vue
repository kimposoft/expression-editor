<script setup lang="ts">
import { useT } from './host';

export type SyntaxStatusState = 'idle' | 'typing' | 'checking' | 'ok' | 'error';

defineProps<{
  /** 三态：idle 不渲染；typing 灰 / checking 蓝 / ok 绿 / error 红（可点击定位出错片段）。 */
  state: SyntaxStatusState;
  /** 状态文案（由持有方按状态/服务端诊断算好）。 */
  label: string;
  /** 错误明细（服务端本地化 message 或本地轻检查 detail），仅 error 态有值。 */
  detail?: string;
}>();
const emit = defineEmits<{ jump: [] }>();
const t = useT();
</script>

<template>
  <div
    v-if="state !== 'idle'"
    class="adv-status"
    :class="`adv-status--${state}`"
    data-testid="adv-syntax-status"
    :title="state === 'error' ? t('dialog.syntaxHintJump') : ''"
    @click="state === 'error' && emit('jump')"
  >
    <span class="adv-status-mark" aria-hidden="true">{{ state === 'ok' ? '✓' : state === 'error' ? '✗' : '•' }}</span>
    <span class="adv-status-label">{{ label }}</span>
    <!-- 明细可能很长（服务端诊断原文）：单行省略，完整文本放 title。 -->
    <span v-if="detail" class="adv-status-detail" :title="detail">{{ detail }}</span>
  </div>
</template>

<style scoped>
.adv-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
}
.adv-status--typing {
  color: rgb(var(--text-secondary-color));
}
.adv-status--checking {
  color: rgb(var(--info-color));
}
.adv-status--ok {
  color: rgb(var(--success-color));
}
.adv-status--error {
  color: rgb(var(--error-color));
  cursor: pointer;
}
.adv-status-mark {
  flex-shrink: 0;
  font-weight: 600;
}
.adv-status-label {
  flex-shrink: 0;
}
.adv-status-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--text-secondary-color));
}
</style>
