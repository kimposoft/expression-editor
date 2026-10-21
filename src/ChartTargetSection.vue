<script setup lang="ts">
/**
 * 「图表目标」单图表映射编辑器。
 *
 * 改造说明（多目标改造，图表 tab 化）：本组件原是「填充到图表」整段区块——自带图表目录下拉 + 增删卡片列表
 * （多图表纵向平铺）。二轮改造后，③目标段升级为「表 + 图表」统一多选 tabs，图表的增删由 ExpressionEditor.vue
 * 顶部目标多选控件统一负责（见其 onUpdateTargetSelection），本组件降级为**单个图表目标**的槽位映射编辑器——
 * 挂载在某个已选中的「图表」tab 内容区，只负责编辑传入的这一个 ChartTargetSpec。
 * 保留：槽位读写（categorySeries 长/宽表切换、nameValue、points）、必填槽位缺失标红、三类一致性警示
 *（图表已删除/类型变更/非取数填充模式）——均从原实现原样保留，只是数据源从"数组第 idx 项"改为"单个 modelValue"。
 * 移除：图表目录拉取（改由父组件统一拉一次，通过 catalogEntry 传入警示所需的目录条目）、加图表下拉、
 * 移除按钮、自动预指派（创建时机上移到父组件 ExpressionEditor.onUpdateTargetSelection，见其注释）。
 *
 * 数据流左右分栏改版：ExpressionEditor.vue 撤下常驻字段树坞后，本组件全部槽位 ExpressionInput 加
 * prefer-quick-pick，避免点值区注册进抽屉总线却无任何 UI 消费（死点击）。
 *
 * 「槽位与普通字段填充行对齐」改造：
 * - 类目/系列/值（含宽表值列）全部按**表达式**编写，与③目标段的字段填充行同款三入口——点值区=⊞ 快捷
 *   选择、ƒ=表达式编辑器、✕=清空。此前槽位没传 advanced，连 ƒ 入口都没有，只能靠快捷选择点一个字段。
 * - 值后面的「聚合方式」下拉整体撤除：聚合由值表达式自己表达（要合计写 SUM(…)，要计数写 COUNT(…)）。
 *   模型字段 mapping.aggregate **保留**（存量文档原样往返、执行期归一化仍按它折叠同键多行，缺省 sum），
 *   只是不再有配置入口——不替用户改存量配置。
 */
import { computed } from 'vue';
import { NButton, NTag, NRadioGroup, NRadioButton, NInput } from 'naive-ui';
import type { ChartTargetSpec, ValueRef, TemplateField } from './types';
import type { ChartCatalogEntry } from './host';
import { useT } from './host';
import type { DockColumnsBundle } from './dockColumns';
import type { TableFields } from './useExpressionContext';
import ExpressionInput from './ExpressionInput.vue';

const props = defineProps<{
  modelValue: ChartTargetSpec;
  /** 该图表在目录中的条目（由父组件统一拉取一次后按 chart_id 查得）：未找到 = 图表已被删除（见 warningsFor）。 */
  catalogEntry: ChartCatalogEntry | undefined;
  sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[] }[];
  formTables: (TableFields & { alias?: string })[];
  /** 由父组件 ExpressionEditor.vue 透传的树坞列（与③目标段字段填充行同一份），供槽位内挂载的
   *  「ƒ 表达式」面板用精确分组；不传时 AdvancedExpressionDialog 自行按 sourceTables/formTables 降级。 */
  dockColumns?: DockColumnsBundle;
  /** P6c（2026-08-12 权限架构终局裁定②）：由父组件 ExpressionEditor.vue 透传，只读态下禁用全部槽位
   *  编辑（长/宽表切换、字段映射、聚合、宽表增删值列），内容仍可读。缺省 false。 */
  readonly?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: ChartTargetSpec] }>();

const t = useT();

function update(mut: (spec: ChartTargetSpec) => void) {
  // P6c 只读闸：本组件全部变更唯一收口点，只读态一律吞掉（与 ExpressionEditor.vue update() 同一纪律）。
  if (props.readonly) return;
  const next: ChartTargetSpec = { ...props.modelValue, mapping: { ...props.modelValue.mapping } } as ChartTargetSpec;
  mut(next);
  emit('update:modelValue', next);
}

function emptyRef(): ValueRef {
  return { kind: 'const', value: '' };
}

// —— 槽位读写（categorySeries）——
function setLayout(layout: 'long' | 'wide') {
  update(next => {
    const m = next.mapping;
    if (m.form !== 'categorySeries') return;
    if (layout === 'wide') {
      next.mapping = { form: 'categorySeries', layout: 'wide', category: m.category, values: [] };
    } else {
      next.mapping = { form: 'categorySeries', layout: 'long', category: m.category };
    }
  });
}
function setSlot(key: 'category' | 'series' | 'value' | 'name' | 'x' | 'y', v: ValueRef | null) {
  update(next => {
    (next.mapping as any)[key] = v ?? emptyRef();
  });
}
// （setAggregate 已随「聚合方式」下拉一并撤除，见文件头改造说明：聚合写在值表达式里；
//   mapping.aggregate 仍由存量文档原样承载，只是不再有配置入口。）
function addValueColumn() {
  update(next => {
    const m = next.mapping;
    if (m.form !== 'categorySeries' || m.layout !== 'wide') return;
    m.values = [...(m.values ?? []), { name_key: '', expression: emptyRef() }];
  });
}
function removeValueColumn(vIdx: number) {
  update(next => {
    const m = next.mapping;
    if (m.form !== 'categorySeries' || m.layout !== 'wide') return;
    m.values = (m.values ?? []).filter((_, i) => i !== vIdx);
  });
}
function setValueColumnNameKey(vIdx: number, nameKey: string) {
  update(next => {
    const m = next.mapping;
    if (m.form !== 'categorySeries' || m.layout !== 'wide') return;
    const values = [...(m.values ?? [])];
    values[vIdx] = { ...values[vIdx], name_key: nameKey };
    m.values = values;
  });
}
function setValueColumnExpr(vIdx: number, v: ValueRef | null) {
  update(next => {
    const m = next.mapping;
    if (m.form !== 'categorySeries' || m.layout !== 'wide') return;
    const values = [...(m.values ?? [])];
    values[vIdx] = { ...values[vIdx], expression: v ?? emptyRef() };
    m.values = values;
  });
}

/** 长表/宽表切换的说明文案（「动态系列 / 固定系列」两个名字都很短，含义靠这一行副标题承载）。 */
const layoutHint = computed(() =>
  props.modelValue.mapping.form === 'categorySeries' && props.modelValue.mapping.layout === 'wide'
    ? t('chart_target.layout_wide_hint')
    : t('chart_target.layout_long_hint')
);

// —— 三类一致性警示（R13.4 沿用）：与目录条目比对，不阻止保存 ——
type Warning = { level: 'error' | 'warning'; text: string };
function warningsFor(spec: ChartTargetSpec): Warning[] {
  const entry = props.catalogEntry;
  if (!entry) return [{ level: 'error', text: t('chart_target.warn_deleted') }];
  const warns: Warning[] = [];
  if (entry.chartForm !== spec.chart_form) warns.push({ level: 'warning', text: t('chart_target.warn_form_changed') });
  if (entry.source !== 'pushed') warns.push({ level: 'warning', text: t('chart_target.warn_not_pushed') });
  return warns;
}
// 空标题回退：后端目录对未设标题的图表返回空串，由本消费方按自身 locale 回退显示「未命名图表」。
function chartLabel(): string {
  const entry = props.catalogEntry;
  if (!entry) return props.modelValue.chart_id;
  const title = entry.title || t('chart_target.untitled');
  return `${entry.sheetName} / ${title}`;
}

// —— 保存校验（R13.5 沿用）：必填槽位缺失清单，供槽位标红 ——
function missingSlots(spec: ChartTargetSpec): string[] {
  const m = spec.mapping;
  const missing: string[] = [];
  if (m.form === 'categorySeries') {
    if (!hasValue(m.category)) missing.push('category');
    if (m.layout === 'wide') {
      if (!m.values || m.values.length === 0) missing.push('values');
    } else {
      // series 不再必填：不写＝只有一条数据线，归一化层自造单系列并让
      // 图表隐藏系列展示（SDK chartnormalize 的 HasSeries/HideSeries，后端槽位规则同步放开）。
      // aggregate==='count' 免填值：**仅为存量兼容**——「聚合方式」下拉已撤除，新配的图表恒无
      // aggregate，值一律必填（要计数就在值表达式里写 COUNT(…)）。存量里配过 count 且省了值槽位的
      // 图表不因改版当场标红，也不需要动后端 extractdoc 的槽位规则（那会是语义收窄）。
      if (m.aggregate !== 'count' && !hasValue(m.value)) missing.push('value');
    }
  } else if (m.form === 'nameValue') {
    if (!hasValue(m.name)) missing.push('name');
    // 同上：count 免填值仅为存量兼容。
    if (m.aggregate !== 'count' && !hasValue(m.value)) missing.push('value');
  } else if (m.form === 'points') {
    if (!hasValue(m.x)) missing.push('x');
    if (!hasValue(m.y)) missing.push('y');
  }
  return missing;
}
function hasValue(v: ValueRef | undefined): boolean {
  if (!v) return false;
  if (v.kind === 'const' && (v.value === '' || v.value === undefined || v.value === null)) return false;
  const text = v.text_source?.text ?? (v.kind === 'raw' ? v.text : undefined);
  if (text !== undefined && text.trim() === '') return false;
  return true;
}
/** 本图表目标槽位是否齐全，供未来 NodeConfigDialog 接入保存前置校验（见文件头说明）。 */
const isAllValid = computed(() => missingSlots(props.modelValue).length === 0);
defineExpose({ isAllValid });
</script>

<template>
  <section class="chart-target-panel">
    <div class="card-head">
      <span class="chart-label">{{ chartLabel() }}</span>
      <NTag v-for="(w, wi) in warningsFor(modelValue)" :key="wi" size="small" :type="w.level === 'error' ? 'error' : 'warning'" class="warn-tag">
        {{ w.text }}
      </NTag>
    </div>

    <!-- categorySeries：长表/宽表切换 + 对应槽位 -->
    <template v-if="modelValue.mapping.form === 'categorySeries'">
      <!-- 系列来源切换（旧称长表/宽表）：名字只有四个字，含义由下面这行副标题承载。 -->
      <div class="layout-switch">
        <NRadioGroup size="small" :disabled="readonly" :value="modelValue.mapping.layout" @update:value="setLayout">
          <NRadioButton value="long">{{ t('chart_target.layout_long') }}</NRadioButton>
          <NRadioButton value="wide">{{ t('chart_target.layout_wide') }}</NRadioButton>
        </NRadioGroup>
        <span class="layout-hint">{{ layoutHint }}</span>
      </div>

      <div class="slot-row" :class="{ invalid: missingSlots(modelValue).includes('category') }">
        <span class="slot-label">{{ t('chart_target.slot_category') }}</span>
        <ExpressionInput
          class="slot-expr"
          :model-value="modelValue.mapping.category ?? null"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :prefer-quick-pick="true"
          :advanced="true"
          :dock-columns="dockColumns"
          :empty-as-unconfigured="true"
          :readonly="readonly"
          :slot-key="`chart-${modelValue.chart_id}-category`"
          :quick-pick-title="t('chart_target.slot_category')"
          @update:model-value="v => setSlot('category', v)"
        />
      </div>

      <template v-if="modelValue.mapping.layout === 'long'">
        <div class="slot-row" :class="{ invalid: missingSlots(modelValue).includes('series') }">
          <span class="slot-label">{{ t('chart_target.slot_series') }}</span>
          <ExpressionInput
            class="slot-expr"
            :model-value="modelValue.mapping.series ?? null"
            :source-tables="sourceTables"
            :form-tables="formTables"
            :prefer-quick-pick="true"
            :advanced="true"
            :dock-columns="dockColumns"
            :empty-as-unconfigured="true"
            :readonly="readonly"
            :slot-key="`chart-${modelValue.chart_id}-series`"
            :placeholder="t('chart_target.series_optional_placeholder')"
            :quick-pick-title="t('chart_target.slot_series')"
            @update:model-value="v => setSlot('series', v)"
          />
        </div>
        <div class="slot-row" :class="{ invalid: missingSlots(modelValue).includes('value') }">
          <span class="slot-label">{{ t('chart_target.slot_value') }}</span>
          <ExpressionInput
            class="slot-expr"
            :model-value="modelValue.mapping.value ?? null"
            :source-tables="sourceTables"
            :form-tables="formTables"
            :prefer-quick-pick="true"
            :advanced="true"
            :dock-columns="dockColumns"
            :empty-as-unconfigured="true"
            :readonly="readonly"
            :slot-key="`chart-${modelValue.chart_id}-value`"
            :quick-pick-title="t('chart_target.slot_value')"
            @update:model-value="v => setSlot('value', v)"
          />
        </div>
      </template>

      <template v-else>
        <div class="values-list" :class="{ invalid: missingSlots(modelValue).includes('values') }">
          <div v-for="(vc, vIdx) in modelValue.mapping.values ?? []" :key="vIdx" class="value-col-row">
            <NInput
              size="small"
              class="name-key-input"
              :value="vc.name_key"
              :readonly="readonly"
              :placeholder="t('chart_target.series_name_placeholder')"
              @update:value="v => setValueColumnNameKey(vIdx, v)"
            />
            <ExpressionInput
              class="slot-expr"
              :model-value="vc.expression"
              :source-tables="sourceTables"
              :form-tables="formTables"
              :prefer-quick-pick="true"
              :advanced="true"
              :dock-columns="dockColumns"
              :empty-as-unconfigured="true"
              :readonly="readonly"
              :slot-key="`chart-${modelValue.chart_id}-value-${vIdx}`"
              :quick-pick-title="t('chart_target.slot_value')"
              @update:model-value="v => setValueColumnExpr(vIdx, v)"
            />
            <NButton size="tiny" quaternary :disabled="readonly" @click="removeValueColumn(vIdx)">{{ t('common.delete') }}</NButton>
          </div>
          <NButton size="tiny" dashed :disabled="readonly" @click="addValueColumn">{{ t('chart_target.add_series') }}</NButton>
        </div>
      </template>
    </template>

    <!-- nameValue：名称 + 值 + 聚合 -->
    <template v-else-if="modelValue.mapping.form === 'nameValue'">
      <div class="slot-row" :class="{ invalid: missingSlots(modelValue).includes('name') }">
        <span class="slot-label">{{ t('chart_target.slot_name') }}</span>
        <ExpressionInput
          class="slot-expr"
          :model-value="modelValue.mapping.name ?? null"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :prefer-quick-pick="true"
          :advanced="true"
          :dock-columns="dockColumns"
          :empty-as-unconfigured="true"
          :readonly="readonly"
          :slot-key="`chart-${modelValue.chart_id}-name`"
          :quick-pick-title="t('chart_target.slot_name')"
          @update:model-value="v => setSlot('name', v)"
        />
      </div>
      <div class="slot-row" :class="{ invalid: missingSlots(modelValue).includes('value') }">
        <span class="slot-label">{{ t('chart_target.slot_value') }}</span>
        <ExpressionInput
          class="slot-expr"
          :model-value="modelValue.mapping.value ?? null"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :prefer-quick-pick="true"
          :advanced="true"
          :dock-columns="dockColumns"
          :empty-as-unconfigured="true"
          :readonly="readonly"
          :slot-key="`chart-${modelValue.chart_id}-value`"
          :quick-pick-title="t('chart_target.slot_value')"
          @update:model-value="v => setSlot('value', v)"
        />
      </div>
    </template>

    <!-- points：x/y + 可选系列 -->
    <template v-else-if="modelValue.mapping.form === 'points'">
      <div class="slot-row" :class="{ invalid: missingSlots(modelValue).includes('x') }">
        <span class="slot-label">{{ t('chart_target.slot_x') }}</span>
        <ExpressionInput
          class="slot-expr"
          :model-value="modelValue.mapping.x ?? null"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :prefer-quick-pick="true"
          :advanced="true"
          :dock-columns="dockColumns"
          :empty-as-unconfigured="true"
          :readonly="readonly"
          :slot-key="`chart-${modelValue.chart_id}-x`"
          :quick-pick-title="t('chart_target.slot_x')"
          @update:model-value="v => setSlot('x', v)"
        />
      </div>
      <div class="slot-row" :class="{ invalid: missingSlots(modelValue).includes('y') }">
        <span class="slot-label">{{ t('chart_target.slot_y') }}</span>
        <ExpressionInput
          class="slot-expr"
          :model-value="modelValue.mapping.y ?? null"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :prefer-quick-pick="true"
          :advanced="true"
          :dock-columns="dockColumns"
          :empty-as-unconfigured="true"
          :readonly="readonly"
          :slot-key="`chart-${modelValue.chart_id}-y`"
          :quick-pick-title="t('chart_target.slot_y')"
          @update:model-value="v => setSlot('y', v)"
        />
      </div>
      <div class="slot-row">
        <span class="slot-label">{{ t('chart_target.slot_series') }}</span>
        <ExpressionInput
          class="slot-expr"
          :model-value="modelValue.mapping.series ?? null"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :prefer-quick-pick="true"
          :advanced="true"
          :dock-columns="dockColumns"
          :empty-as-unconfigured="true"
          :readonly="readonly"
          :slot-key="`chart-${modelValue.chart_id}-series`"
          :quick-pick-title="t('chart_target.slot_series')"
          @update:model-value="v => setSlot('series', v)"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.chart-target-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chart-label {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--base-text-color));
}
.warn-tag {
  flex-shrink: 0;
}
.slot-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slot-label {
  width: 64px;
  flex-shrink: 0;
  color: rgb(var(--text-secondary-color));
  font-size: 12px;
}
.slot-expr {
  flex: 1;
  min-width: 0;
}
/* 必填槽位缺失标红（R13.5 沿用，不阻止保存，仅可视警示）。 */
.slot-row.invalid .slot-label,
.values-list.invalid {
  color: rgb(var(--error-color));
}
.values-list.invalid {
  border: 1px solid rgb(var(--error-color));
  border-radius: 4px;
  padding: 4px;
}
.value-col-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.name-key-input {
  width: 120px;
  flex-shrink: 0;
}
.layout-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.layout-hint {
  font-size: 12px;
  color: rgb(var(--text-secondary-color));
  line-height: 1.5;
}
.values-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
