<script setup lang="ts">
import { computed, ref } from 'vue';
import { NInput, NTabs, NTabPane, NCollapse, NCollapseItem, NEmpty } from 'naive-ui';
import type { TemplateField, ValueRef } from './types';
import { systemVariablesCatalog, isFieldTypeUnsupported, type TableFields } from './useExpressionContext';
import { instanceSuffix } from './rawSerialize';
import { useT, useExpressionEditorScopeOptions } from './host';
import { matchField as matchFieldByKeyword } from './fieldSearch';

/**
 * 字段树面板（369:19991 表达式编辑器弹窗右侧 / 369:14691 统一字段抽屉 抽出的通用组件）。
 *
 * 数据形状与插入语义**照抄** FieldDrawer.vue（同一份 sourceTables/formTables prop 结构、
 * 同一套 source_field/system_var ValueRef 拼法），只是换了一套按 Figma 369:21567 重塑的视觉
 * （搜索框 + 来源表/本报表/变量 三页签 + 树形列表，表节点蓝色图标+展开箭头+同名(N)序号，
 * 字段行 hover 浅底/点击选中浅蓝底）。
 */
const props = defineProps<{
  /** 来源表 + 字段（与 FieldDrawer 同形状）。viewFieldsUnsupported=视图来源且宿主不支持视图字段目录时
   *  显示提示文案（该分组即便零字段也保留，不被"零字段过滤"静默吃掉）。
   *  stagingUnsupported（Phase B，动作暂存区）=暂存来源但当前拿不到「上一步暂存区」列，同一降级范式。
   *  externalFieldsUnsupported（S2b，外部数据表来源）=外部表来源但当前宿主不支持读取外部表字段，同一降级范式。 */
  sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[]; viewFieldsUnsupported?: boolean; stagingUnsupported?: boolean; externalFieldsUnsupported?: boolean }[];
  /** 本报表各表（含隐式 context 别名 alias），点选产 source_field（本报表=物化临时表来源）。 */
  formTables: (TableFields & { alias: string })[];
}>();

const emit = defineEmits<{ pick: [ref: ValueRef] }>();

const t = useT();

// B4 修复：本组件此前完全没有接线 unsupportedFieldTypes 置灰
// 名单——FieldTreeDock.vue（①②③外层字段坞）已经接了（见其头注释「2026-09-12 追加」），但本组件
// 是③视图列 fx 弹窗（AdvancedExpressionDialog → AdvancedExpressionPanel）内部的独立字段抽屉，
// 走的是另一棵组件子树，不会自动继承 FieldTreeDock 那份实现，需要单独接。scope 未挂在
// ExpressionEditor 子树内（如本组件自身单测直接挂载）时按缺省值（空置灰名单），与改造前行为一致，
// 不影响其余不设置 unsupportedFieldTypes 的既有调用方（动作设计器等）。
const scope = useExpressionEditorScopeOptions();
function fieldUnsupported(dataType?: string | null): boolean {
  return isFieldTypeUnsupported(dataType, scope.unsupportedFieldTypes.value);
}

// —— 搜索 ——
const keyword = ref('');
const lower = computed(() => keyword.value.trim().toLowerCase());
function matchField(f: TemplateField): boolean {
  return matchFieldByKeyword(f, lower.value);
}
const filteredSource = computed(() =>
  props.sourceTables
    .map(s => ({ ...s, fields: s.fields.filter(matchField) }))
    .filter(s => s.fields.length > 0 || s.viewFieldsUnsupported || s.stagingUnsupported || s.externalFieldsUnsupported)
);
const filteredForm = computed(() =>
  props.formTables
    .map(s => ({ table: s.table, alias: s.alias, fields: s.fields.filter(matchField) }))
    .filter(s => s.fields.length > 0)
);
const filteredVars = computed(() =>
  systemVariablesCatalog.value.filter(v => !lower.value || v.label.toLowerCase().includes(lower.value) || v.var_id.includes(lower.value))
);

// —— 点选高亮（点击选中→浅蓝底，直到选中另一项；hover 由纯 CSS 负责）——
const lastPicked = ref('');
function isActive(key: string): boolean {
  return lastPicked.value === key;
}

/** 来源表字段：source_field（alias 即来源段稳定别名），与 FieldDrawer.pickSource 语义一致。
 *  B4 修复：命中置灰名单的字段直接拦下，不 emit 也不改 lastPicked 高亮态，与模板里
 *  .ft-field--unsupported 置灰视觉配套（同 FieldTreeDock.pickField 口径）。 */
function pickSource(alias: string, field: TemplateField) {
  if (fieldUnsupported(field.data_type)) return;
  lastPicked.value = `sf:${alias}:${field.field_id}`;
  emit('pick', { kind: 'source_field', alias, field_id: field.field_id });
}
/** 本报表字段：同样产 source_field（alias=本报表隐式 context 别名 bt*），与 FieldDrawer.pickForm 语义一致。 */
function pickForm(alias: string, field: TemplateField) {
  if (fieldUnsupported(field.data_type)) return;
  lastPicked.value = `sf:${alias}:${field.field_id}`;
  emit('pick', { kind: 'source_field', alias, field_id: field.field_id });
}
function pickVar(varId: string) {
  lastPicked.value = `var:${varId}`;
  emit('pick', { kind: 'system_var', var_id: varId });
}
</script>

<template>
  <div class="field-tree-panel">
    <!-- 搜索框：占位符沿用 FieldDrawer 既有 drawer.searchPlaceholder key。 -->
    <NInput v-model:value="keyword" size="small" clearable class="ft-search" :placeholder="t('drawer.searchPlaceholder')">
      <template #prefix>
        <!-- 搜索（放大镜）图标：包内自持内联 SVG，风格对齐 SourceTreePicker.vue 现有 folderIcon/templateIcon
             （currentColor 描边、不依赖宿主图标体系）。项目内未找到可复用的现成放大镜 glyph，遂新绘（见任务汇报）。 -->
        <svg class="ft-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </template>
    </NInput>

    <NTabs type="line" size="small" class="ft-tabs">
      <!-- 来源表 tab：表节点带蓝色表格图标+展开箭头（NCollapse 内置 arrow-placement=left），
           同名来源表按出现次序带 (1)(2)(3)（复用 rawSerialize.instanceSuffix，不重算）。 -->
      <NTabPane name="source" :tab="t('drawer.tabSource')">
        <NEmpty v-if="filteredSource.length === 0" size="small" :description="t('drawer.noSourceFields')" />
        <NCollapse v-else arrow-placement="left" :default-expanded-names="filteredSource.map(s => s.alias)">
          <NCollapseItem v-for="s in filteredSource" :key="s.alias" :name="s.alias">
            <template #header>
              <span class="ft-tbl-chip">
                <!-- 表图标：与 SourceTreePicker.vue 的 templateIcon() 同一路径，包内约定的「数据表」glyph。 -->
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                  <path d="M14 2v6h6" />
                </svg>
              </span>
              <span class="ft-tbl-name">{{ s.name }}{{ instanceSuffix(s.alias, s.dataTableId, sourceTables) }}</span>
            </template>
            <div
              v-for="f in s.fields"
              :key="f.field_id"
              class="ft-field"
              :class="{ active: isActive(`sf:${s.alias}:${f.field_id}`), 'ft-field--unsupported': fieldUnsupported(f.data_type) }"
              :title="fieldUnsupported(f.data_type) ? t('drawer.fieldTypeUnsupported') : undefined"
              :aria-disabled="fieldUnsupported(f.data_type) || undefined"
              @click="pickSource(s.alias, f)"
            >
              {{ f.field_name }}
            </div>
            <!-- 视图来源字段目录不可用（旧宿主桥无 getViewSchema）：与 FieldDrawer 同一降级提示。 -->
            <div v-if="s.fields.length === 0 && s.viewFieldsUnsupported" class="ft-hint">{{ t('drawer.viewFieldsUnsupported') }}</div>
            <!-- Phase B（动作暂存区）：暂存来源但当前画布拓扑取不到「上一步暂存区」列（如前驱节点被删），
                 同一降级范式——分组保留可见，显示提示而非静默消失。 -->
            <div v-if="s.fields.length === 0 && s.stagingUnsupported" class="ft-hint">{{ t('drawer.stagingUnsupported') }}</div>
            <!-- S2b（外部数据表来源）：外部表字段目录不可用（旧宿主桥无 getExternalSchema），同一降级范式。 -->
            <div v-if="s.fields.length === 0 && s.externalFieldsUnsupported" class="ft-hint">{{ t('drawer.externalFieldsUnsupported') }}</div>
          </NCollapseItem>
        </NCollapse>
      </NTabPane>

      <!-- 本报表 tab：本模板各表，无需 (N) 序号（同一报表内表天然不重复）。 -->
      <NTabPane name="form" :tab="t('drawer.tabForm')">
        <NEmpty v-if="filteredForm.length === 0" size="small" :description="t('drawer.noFields')" />
        <NCollapse v-else arrow-placement="left" :default-expanded-names="filteredForm.map(s => s.table.data_table_id)">
          <NCollapseItem v-for="s in filteredForm" :key="s.table.data_table_id" :name="s.table.data_table_id">
            <template #header>
              <span class="ft-tbl-chip">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                  <path d="M14 2v6h6" />
                </svg>
              </span>
              <span class="ft-tbl-name">{{ s.table.table_name }}</span>
            </template>
            <div
              v-for="f in s.fields"
              :key="f.field_id"
              class="ft-field"
              :class="{ active: isActive(`sf:${s.alias}:${f.field_id}`), 'ft-field--unsupported': fieldUnsupported(f.data_type) }"
              :title="fieldUnsupported(f.data_type) ? t('drawer.fieldTypeUnsupported') : undefined"
              :aria-disabled="fieldUnsupported(f.data_type) || undefined"
              @click="pickForm(s.alias, f)"
            >
              {{ f.field_name }}
            </div>
          </NCollapseItem>
        </NCollapse>
      </NTabPane>

      <!-- 变量 tab：扁平列表，无树/图标。 -->
      <NTabPane name="vars" :tab="t('drawer.tabVars')">
        <div
          v-for="v in filteredVars"
          :key="v.var_id"
          class="ft-field ft-var"
          :class="{ active: isActive(`var:${v.var_id}`) }"
          @click="pickVar(v.var_id)"
        >
          {{ v.label }}
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.field-tree-panel {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 搜索框：边框用「描边/极深色」（Figma #cdd0d6），与常规输入框边框（--border-color）区分。 */
.ft-search :deep(.n-input__border),
.ft-search :deep(.n-input__state-border) {
  border-color: rgb(var(--border-deep-color));
}
.ft-ico {
  color: rgb(var(--text-hint-color));
}
.ft-tabs {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ft-tabs :deep(.n-tabs-nav) {
  flex-shrink: 0;
}
.ft-tabs :deep(.n-tab-pane) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
}
/* 表节点头：图标 chip + 表名，NCollapse 自带展开箭头（arrow-placement=left）。 */
.ft-tbl-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  margin-right: 8px;
  /* 与 Figma rgba(230,246,255,0.5) 逐像素等值（primary-50 半透明）。 */
  background: rgb(var(--primary-50-color) / 0.5);
  color: rgb(var(--primary-color));
  flex-shrink: 0;
}
.ft-tbl-name {
  font-size: 14px;
  color: rgb(var(--base-text-color));
}
/* 字段行：缩进对齐表图标列宽，hover 浅色底、选中浅蓝底。 */
.ft-field {
  padding: 6px 7px 6px 47px;
  font-size: 14px;
  border-radius: 4px;
  cursor: pointer;
  color: rgb(var(--base-text-color));
}
.ft-field:hover {
  background: rgb(var(--fill-light-color));
}
.ft-field.active {
  background: rgb(var(--primary-50-color) / 0.5);
}
/* 置灰不可选：命中调用方 unsupportedFieldTypes 的字段——弱化文字色 + 不可点
 * 光标，hover 不再变色，提示文案经 title 属性呈现（同 FieldTreeDock.vue .ftd-field--unsupported）。 */
.ft-field--unsupported {
  color: rgb(var(--text-hint-color));
  cursor: not-allowed;
}
.ft-field--unsupported:hover {
  background: none;
}
/* 变量 tab 扁平列表：无需表图标缩进。 */
.ft-var {
  padding-left: 7px;
}
.ft-hint {
  padding: 6px 7px 6px 47px;
  font-size: 12px;
  color: rgb(var(--text-hint-color));
  cursor: default;
}
</style>
