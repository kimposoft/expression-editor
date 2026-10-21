<script setup lang="ts">
/**
 * 「暂存目标」自由列编辑器（Phase B，动作暂存区）。
 *
 * 单 spec 进/出接线，照抄 ChartTargetSection.vue 的既有约定：modelValue=当前这一个 TargetSpec（挂载在
 * ExpressionEditor.vue ③目标区「暂存区」tab 内容区），增删列/改列名/改表达式后整体 emit 新 TargetSpec，
 * 由父组件通过 readTableTargets()+该 spec 重新 writeTargets() 回写模型（唯一入口）。
 *   - 行容器/高亮/值格入口（ƒ + ✕）与普通字段行同一套；列名位取代字段名块，仍可编辑；
 *   - 撤掉行尾「删除」按钮，值格的 ✕ 即删除整列（ExpressionInput ✕ 回抛 null，本组件据此删行）；
 *   - ⊞ 快捷选择插入字段时列名为空则用该字段的字段名作列名；
 *   - 新列的表达式用「不填充」占位 {kind:'const'}（与普通字段行同款，空态显示短横杠而非空串常量的 ''），
 *     确认时未配置的列由 ExpressionEditor.finalize 静默剔除。
 */
import { computed } from 'vue';
import { NButton, NInput } from 'naive-ui';
import type { TargetSpec, ValueRef, TemplateField, OutputMapping } from './types';
import { useT } from './host';
import type { TableFields } from './useExpressionContext';
import type { DockColumnsBundle } from './dockColumns';
import { isUnconfiguredOutputExpr } from './outputExprState';
import { generateStagingColumnId } from './v4/definitionDoc';
import ExpressionInput from './ExpressionInput.vue';

const props = defineProps<{
  modelValue: TargetSpec;
  sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[] }[];
  formTables: (TableFields & { alias?: string })[];
  /** 父级已按模板归属分好的树坞列，透传给值格的 ƒ 表达式弹窗（与普通字段行同款）。 */
  dockColumns?: DockColumnsBundle;
  /** P6c（2026-08-12 权限架构终局裁定②）：由父组件 ExpressionEditor.vue 透传，只读态下禁用增删列/
   *  改列名/改表达式，内容仍可读。缺省 false。 */
  readonly?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: TargetSpec] }>();

const t = useT();

function update(mut: (spec: TargetSpec) => void) {
  // P6c 只读闸：本组件全部变更唯一收口点，只读态一律吞掉（与 ExpressionEditor.vue update() 同一纪律）。
  if (props.readonly) return;
  // 浅拷贝 outputs 数组（元素级不可变更新在各 mutator 里各自处理），风格对齐 ChartTargetSection.update。
  const next: TargetSpec = { ...props.modelValue, outputs: [...props.modelValue.outputs] };
  mut(next);
  emit('update:modelValue', next);
}

/** 新列的表达式占位：「不填充」{kind:'const'}（value 缺省），与普通字段行 ✕ 清空 / ƒ 删光文本同一形态。
 *  此前用空串常量 {kind:'const', value:''}，V4 壳下会往返成 '' 字面量、值格显示一个引号 token，且未配置
 *  的列会被当成真实空串列存下来。 */
function emptyExpr(): ValueRef {
  return { kind: 'const' };
}

function addColumn() {
  update(spec => {
    spec.outputs = [
      ...spec.outputs,
      { target_field_id: generateStagingColumnId(), target_field_label: '', expression: emptyExpr() } satisfies OutputMapping
    ];
  });
}
function removeColumn(idx: number) {
  update(spec => {
    spec.outputs = spec.outputs.filter((_, i) => i !== idx);
  });
}
/** 改显示名：只写 target_field_label，column_id（target_field_id）保持不变——这正是「稳定键」的意义。 */
function setColumnLabel(idx: number, label: string) {
  update(spec => {
    spec.outputs = spec.outputs.map((o, i) => (i === idx ? { ...o, target_field_label: label } : o));
  });
}

/** ⊞ 快捷选择产出的字段引用 → 字段名（source_field 按别名定位所在表；form_field 按 field_id 在本报表各表里找）。
 *  找不到（系统变量 / 常量 / 文本表达式）返回 undefined，不自动命名。 */
function fieldNameOfRef(v: ValueRef): string | undefined {
  if ((v.kind !== 'source_field' && v.kind !== 'form_field') || !v.field_id) return undefined;
  const fieldId = v.field_id;
  const pools: { alias?: string; fields: TemplateField[] }[] = [
    ...props.sourceTables,
    ...props.formTables.map(ft => ({ alias: ft.alias, fields: ft.fields }))
  ];
  const candidates = v.kind === 'source_field' ? pools.filter(tb => tb.alias === v.alias) : pools;
  for (const tb of candidates) {
    const f = tb.fields.find(x => x.field_id === fieldId);
    if (f) return f.field_name;
  }
  return undefined;
}

/** 值格回写：
 *  - null（值格 ✕）＝删除整列；
 *  - 其余 ValueRef 写入表达式；若显示名为空且新值是 ⊞ 拾取的字段引用，用该字段名补显示名
 *   。 */
function onColumnExpr(idx: number, v: ValueRef | null) {
  if (v === null) {
    removeColumn(idx);
    return;
  }
  update(spec => {
    spec.outputs = spec.outputs.map((o, i) => {
      if (i !== idx) return o;
      const autoLabel = (o.target_field_label ?? '').trim() ? undefined : fieldNameOfRef(v);
      return { ...o, expression: v, target_field_label: autoLabel ?? o.target_field_label };
    });
  });
}

/** 显示名重复即时校验（不阻止保存，仅可视警示——与 ChartTargetSection 的 missingSlots 标红惯例一致）：
 *  记录每个非空显示名出现的下标集合，出现 ≥2 次的下标即判重复。column_id（target_field_id）由生成
 *  保证唯一，不参与判重。 */
const dupeIndexes = computed<Set<number>>(() => {
  const byName = new Map<string, number[]>();
  props.modelValue.outputs.forEach((o, i) => {
    const name = (o.target_field_label ?? '').trim();
    if (!name) return;
    const bucket = byName.get(name);
    if (bucket) bucket.push(i);
    else byName.set(name, [i]);
  });
  const dupes = new Set<number>();
  for (const idxs of byName.values()) {
    if (idxs.length > 1) idxs.forEach(i => dupes.add(i));
  }
  return dupes;
});
</script>

<template>
  <section class="staging-target-panel">
    <div
      v-for="(o, idx) in modelValue.outputs"
      :key="o.target_field_id"
      class="staging-col-row"
      :data-testid="`staging-col-row-${idx}`"
      :class="{ dupe: dupeIndexes.has(idx), filled: !isUnconfiguredOutputExpr(o.expression) }"
    >
      <NInput
        size="small"
        class="staging-col-name"
        :value="o.target_field_label"
        :readonly="readonly"
        :placeholder="t('editor.stagingColumnName')"
        @update:value="v => setColumnLabel(idx, v)"
      />
      <ExpressionInput
        class="staging-col-expr"
        :model-value="o.expression"
        :source-tables="sourceTables"
        :form-tables="formTables"
        :dock-columns="dockColumns"
        :advanced="true"
        :prefer-quick-pick="true"
        :readonly="readonly"
        :slot-key="`staging-${idx}`"
        :placeholder="t('editor.targetExprPlaceholder')"
        :quick-pick-title="o.target_field_label || t('editor.stagingColumnName')"
        :allow-null-const="true"
        :empty-as-unconfigured="true"
        :clear-title="t('editor.stagingRemoveColumn')"
        @update:model-value="v => onColumnExpr(idx, v)"
      />
    </div>
    <div v-if="dupeIndexes.size > 0" class="staging-dupe-hint">{{ t('editor.stagingColumnDupe') }}</div>
    <NButton size="tiny" dashed :disabled="readonly" data-testid="staging-add-column" @click="addColumn">{{ t('editor.stagingAddColumn') }}</NButton>
  </section>
</template>

<style scoped>
.staging-target-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 列行：照抄 ExpressionEditor.vue 的 .target-row（描边圆角 8、内边距 4/8、间距 8）。 */
.staging-col-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid rgb(var(--border-color));
  border-radius: 8px;
}
/* 已配置表达式的行整行蓝描边高亮（同 .target-row.filled）。 */
.staging-col-row.filled {
  border-color: rgb(var(--primary-color) / 0.45);
  background: rgb(var(--primary-color) / 0.04);
}
/* 列名输入：与普通字段行的字段名块同宽（180）、同高（NInput small = 28）。 */
.staging-col-name {
  width: 180px;
  flex-shrink: 0;
}
.staging-col-expr {
  flex: 1;
  min-width: 0;
}
/* 列名重复标红（不阻止保存，仅可视警示，风格对齐 ChartTargetSection 的 .invalid 惯例）。 */
.staging-col-row.dupe .staging-col-name :deep(.n-input__border),
.staging-col-row.dupe .staging-col-name :deep(.n-input__state-border) {
  border-color: rgb(var(--error-color));
}
.staging-dupe-hint {
  font-size: 12px;
  color: rgb(var(--error-color));
}
</style>
