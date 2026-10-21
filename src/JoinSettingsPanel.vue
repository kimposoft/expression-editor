<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSelect, NEmpty } from 'naive-ui';
import { KControlSize, type KControlSizeTiers } from '@kimposoft/ui-kit';
import type { SelectNodeProps } from 'naive-ui';
import type { JoinSpec, CompareOp } from './types';
import { useT } from './host';

const DASHED_ADD_TIERS: KControlSizeTiers = { medium: { height: 32, fontSize: 12, paddingX: 6 } };

/**
 * 关联设置面板（通用组件，346:10750 Figma「手动关联」浮层重塑抽出）：
 * 编辑「手动关联」清单——同模板主+明细的自动 record_id 关联由 ExpressionEditor.reconcile 隐式维护，
 * 不在此展示/编辑。原内联实现（旧 ExpressionEditor.vue :829-859 一带）整体搬入本组件，逻辑零改动，
 * 只重塑视觉，供动作设计器其他需要「关联设置」的场景复用（如写动作来源段、其他取数类动作）。
 */
const props = defineProps<{
  /** 完整关联数组（含自动 record_id 关联，只读——本组件内部不直接改它，一律深拷贝后 emit 新数组）。 */
  joins: JoinSpec[];
  /** 可选左右表候选：调用方喂什么就是什么，本组件不关心来源类别。取数模式沿用旧口径只喂显式来源
   *  （本报表隐式上下文表不作候选）；写模式起，调用方
   *  ExpressionEditor.aliasOptions 会额外把「本报表」自身各表也并进来——写模式常见诉求正是
   *  「目录表 × 本报表明细」手动关联，若仍按旧口径排除本报表表，候选池常年 <2 张，
   *  下方「新增手动关联」的数量门槛（canAddJoin）永远不满足。 */
  sourceOptions: { label: string; value: string }[];
  /** 按别名取字段下拉选项（沿用调用方现有字段目录，本组件不持有字段数据）。 */
  fieldOptions: (alias: string) => { label: string; value: string }[];
  defaultJoinType?: 'left' | 'inner';
  writeTargetAlias?: string;
}>();
const emit = defineEmits<{ 'update:joins': [JoinSpec[]] }>();

const t = useT();
const stableOptionNodeProps: SelectNodeProps = option => {
  const value = 'value' in option ? option.value : undefined;
  // value 是持久化 JoinSpec 使用的 source alias / field_id / relation enum；
  // 缺失时禁止从 label 或 DOM 顺序派生自动化身份。
  if (typeof value !== 'string' || value.trim() === '') return {};
  return { 'data-option-value': value };
};

// 展示口径：仅手动关联；idx 是**原始** joins 数组下标（与自动关联共享同一数组），
// 所有变更函数都按此下标改写，保证与自动关联不错位。
const manualJoins = computed(() => props.joins.map((j, idx) => ({ j, idx })).filter(x => !x.j.auto_record_id));

const joinTypeOptions = computed(() => [
  { label: t('editor.joinTypeInner'), value: 'inner' },
  { label: t('editor.joinTypeLeft'), value: 'left' }
]);
// 比较符全集（对齐 ExpressionEditor 原实现，等比较符集合不含判空算子——关联条件恒需双端字段）。
const opOptions: { label: string; value: CompareOp }[] = [
  { label: '=', value: 'eq' },
  { label: '≠', value: 'neq' },
  { label: '<', value: 'lt' },
  { label: '≤', value: 'lte' },
  { label: '>', value: 'gt' },
  { label: '≥', value: 'gte' }
];
const canAddJoin = computed(() => props.sourceOptions.length >= 2);

/** 深拷贝当前 joins → 交给 mut 原地改写 → 整体 emit（与 ExpressionEditor.update() 同款写法）。 */
function emitUpdate(mut: (list: JoinSpec[]) => void): void {
  const next: JoinSpec[] = JSON.parse(JSON.stringify(props.joins));
  mut(next);
  emit('update:joins', next);
}

function addJoin(): void {
  if (!canAddJoin.value) return;
  const left = props.sourceOptions[0].value;
  const right = props.sourceOptions[1].value;
  emitUpdate(list => {
    list.push({
      left_alias: left,
      right_alias: right,
      join_type: props.defaultJoinType ?? 'left',
      auto_record_id: false,
      on: [{ left: { alias: left, field_id: '' }, op: 'eq', right: { alias: right, field_id: '' } }]
    });
  });
}
function showWriteLeftJoinNotice(j: JoinSpec): boolean {
  if (!props.writeTargetAlias) return false;
  if (j.join_type !== 'left') return false;
  return j.left_alias === props.writeTargetAlias || j.right_alias === props.writeTargetAlias;
}
function removeJoin(idx: number): void {
  emitUpdate(list => {
    list.splice(idx, 1);
  });
}
function setJoinField<K extends keyof JoinSpec>(idx: number, key: K, value: JoinSpec[K]): void {
  emitUpdate(list => {
    const j = list[idx];
    (j[key] as JoinSpec[K]) = value;
    if (key === 'left_alias' || key === 'right_alias') {
      const side: 'left' | 'right' = key === 'left_alias' ? 'left' : 'right';
      (j.on ?? []).forEach(on => {
        on[side] = { alias: value as string, field_id: '' };
      });
    }
  });
}
function addOn(idx: number): void {
  emitUpdate(list => {
    const j = list[idx];
    (j.on ??= []).push({ left: { alias: j.left_alias, field_id: '' }, op: 'eq', right: { alias: j.right_alias, field_id: '' } });
  });
}
function setOnField(jIdx: number, onIdx: number, side: 'left' | 'right', fieldId: string): void {
  emitUpdate(list => {
    const on = list[jIdx].on;
    if (on) on[onIdx][side].field_id = fieldId;
  });
}
function setOnOp(jIdx: number, onIdx: number, op: CompareOp): void {
  emitUpdate(list => {
    const on = list[jIdx].on;
    if (on) on[onIdx].op = op;
  });
}
function removeOn(jIdx: number, onIdx: number): void {
  emitUpdate(list => {
    const on = list[jIdx].on;
    if (on) on.splice(onIdx, 1);
  });
}
</script>

<template>
  <div class="jp-root">
    <div class="native-text-hint" data-testid="join-native-text-hint">
      {{ t('editor.nativeTextEqualityHint') }}
    </div>
    <NEmpty v-if="manualJoins.length === 0" size="small" :description="t('editor.manualJoinHint')" />

    <!-- 每条手动关联一个分节：标题「手动关联{序号}」+ 右上关闭（删除本条关联） -->
    <div v-for="(item, seq) in manualJoins" :key="item.idx" class="jp-section">
      <div class="jp-section-head">
        <span class="jp-section-title">{{ t('editor.manualJoinSectionTitle').replace('{n}', String(seq + 1)) }}</span>
        <button type="button" class="jp-icon-btn jp-close" :title="t('common.delete')" @click="removeJoin(item.idx)">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <!-- 三联下拉：左表 · 联接方式 · 右表 -->
      <div class="jp-tri-row">
        <NSelect size="small" class="jp-w-table" :data-join-index="item.idx" data-join-part="left-source" :options="sourceOptions" :value="item.j.left_alias" :node-props="stableOptionNodeProps" @update:value="v => setJoinField(item.idx, 'left_alias', v)" />
        <NSelect size="small" class="jp-w-type" :data-join-index="item.idx" data-join-part="type" :options="joinTypeOptions" :value="item.j.join_type" :node-props="stableOptionNodeProps" @update:value="v => setJoinField(item.idx, 'join_type', v)" />
        <NSelect size="small" class="jp-w-table" :data-join-index="item.idx" data-join-part="right-source" :options="sourceOptions" :value="item.j.right_alias" :node-props="stableOptionNodeProps" @update:value="v => setJoinField(item.idx, 'right_alias', v)" />
      </div>

      <!-- 关联条件：字段① = 字段② + 右侧红色删除；虚线整宽「+ 关联条件」 -->
      <div class="jp-cond-block">
        <div class="jp-cond-label">{{ t('editor.joinConditionLabel') }}</div>
        <div v-for="(on, oi) in item.j.on ?? []" :key="oi" class="jp-cond-row">
          <span class="jp-seq-badge">{{ oi + 1 }}</span>
          <NSelect
            size="small"
            class="jp-w-table"
            :data-join-index="item.idx"
            :data-join-on-index="oi"
            data-join-part="left-field"
            :options="fieldOptions(item.j.left_alias)"
            :value="on.left.field_id"
            :placeholder="t('editor.leftField')"
            :node-props="stableOptionNodeProps"
            @update:value="v => setOnField(item.idx, oi, 'left', v)"
          />
          <NSelect size="small" class="jp-w-op" :data-join-index="item.idx" :data-join-on-index="oi" data-join-part="operator" :options="opOptions" :value="on.op" :node-props="stableOptionNodeProps" @update:value="v => setOnOp(item.idx, oi, v)" />
          <NSelect
            size="small"
            class="jp-w-table"
            :data-join-index="item.idx"
            :data-join-on-index="oi"
            data-join-part="right-field"
            :options="fieldOptions(item.j.right_alias)"
            :value="on.right.field_id"
            :placeholder="t('editor.rightField')"
            :node-props="stableOptionNodeProps"
            @update:value="v => setOnField(item.idx, oi, 'right', v)"
          />
          <button type="button" class="jp-icon-btn jp-trash" :title="t('common.delete')" @click="removeOn(item.idx, oi)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <path
                d="M3 4.5H13M6.5 4.5V3.2C6.5 2.8 6.8 2.5 7.2 2.5H8.8C9.2 2.5 9.5 2.8 9.5 3.2V4.5M6 4.5V12.3C6 12.9 6.5 13.5 7.1 13.5H8.9C9.5 13.5 10 12.9 10 12.3V4.5"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
        <KControlSize include-button :tiers="DASHED_ADD_TIERS">
          <NButton block dashed class="jp-dashed-btn" @click="addOn(item.idx)">{{ t('editor.addJoinCondition') }}</NButton>
        </KControlSize>
      </div>

      <div v-if="showWriteLeftJoinNotice(item.j)" class="jp-write-left-join-notice" data-testid="write-left-join-notice">
        {{ t('editor.writeLeftJoinNotice') }}
      </div>
    </div>

    <!-- 底部整宽虚线「+ 新增手动关联」：不足两张显式来源表时禁用（同原实现）。 -->
    <KControlSize include-button :tiers="DASHED_ADD_TIERS">
      <NButton block dashed class="jp-dashed-btn jp-dashed-btn-add" data-testid="join-add-manual" :disabled="!canAddJoin" @click="addJoin">
        {{ t('editor.addManualJoin') }}
      </NButton>
    </KControlSize>
  </div>
</template>

<style scoped>
.jp-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}
.native-text-hint {
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--base-text-color) / 0.62);
}
.jp-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.jp-section + .jp-section {
  padding-top: 16px;
  border-top: 1px dashed rgb(var(--border-color));
}
.jp-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.jp-section-title {
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--base-text-color));
}
.jp-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgb(var(--text-secondary-color));
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.jp-icon-btn:hover {
  background: rgb(var(--fill-light-color));
}
.jp-close:hover {
  color: rgb(var(--base-text-color));
}
.jp-trash {
  color: rgb(var(--error-color));
}
.jp-trash:hover {
  background: rgb(var(--error-color) / 0.1);
}
.jp-tri-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.jp-w-table {
  flex: 1 1 0;
  min-width: 120px;
}
.jp-w-type {
  width: 96px;
  flex-shrink: 0;
}
.jp-w-op {
  width: 64px;
  flex-shrink: 0;
}
.jp-cond-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.jp-write-left-join-notice {
  padding: 6px 10px;
  border-radius: 4px;
  background: rgb(var(--warning-color) / 0.08);
  color: rgb(var(--warning-color));
  font-size: 12px;
  line-height: 1.5;
}
.jp-cond-label {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--text-secondary-color));
}
.jp-cond-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 条件序号徽记：蓝色圆形小序号①②…（呼应步骤序号徽记的配色语言，弱化版）。 */
.jp-seq-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  background: rgb(var(--primary-color) / 0.15);
  color: rgb(var(--primary-color));
  font-size: 10px;
  font-weight: 600;
}
.jp-dashed-btn-add {
  margin-top: 4px;
}
</style>
