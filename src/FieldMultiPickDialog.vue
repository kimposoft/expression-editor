<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NCheckbox, NEmpty, NInput } from 'naive-ui';
import { KControlSize, KDialog, KDialogFooter, type KControlSizeTiers } from '@kimposoft/ui-kit';
import { useT } from './host';
import { TABLE_THEME_COLOR_COUNT } from './tableThemeColors';
import { dedupeColumnNames } from './fieldMultiPick';
import FieldTypeIcon from './FieldTypeIcon.vue';

/**
 * 批量添加字段对话框：左侧按来源分组、可搜索的
 * 字段勾选列表，右侧「将添加 N 列」预览（可改列名、可移除），确定后一次性 emit 多列。
 *
 * 外观参照 SourceTreePicker.vue 的选择弹窗（头部标题+关闭、左右双栏、底部取消/确定）；外壳
 * 已迁到 Kimpo 组件库 KDialog（standard 档：尺寸/可拖动/最大化/标题栏不拖出视口），但**不接
 * useExpressionHost 的 loadEditorPrefs/saveEditorPrefs 持久化**（不传 memoryKey）——本组件不依赖 ExpressionHost
 * 注入（groups/fields 均由调用方以 props 直接给出，不需要 host.fetchTree 等取数），保持与
 * ExpressionHost 的低耦合，供视图设计器等无 host 注入的场景独立使用。
 *
 * 严格角色分离：本组件只做"选择 + 列名去重预览"，不关心视图列模型如何落库——confirm 时把
 * {groupKey, fieldId, fieldLabel, columnName} 列表整批 emit 给调用方，由调用方（视图设计器）
 * 决定如何写入自己的列模型。
 */

interface FieldMultiPickField {
  id: string;
  label: string;
  dataType: string;
}
interface FieldMultiPickGroup {
  key: string;
  label: string;
  /** 来源分组徽标（如「常规视图」「组合视图」），数据表分组不传。 */
  badge?: string;
  /** 表主题色序号，同来源行色点（tableThemeColors.tableColorIndex 同一套 % 8 循环口径）；
   *  负数=不占主题色，色点回落中性灰（见 table-theme-colors.css .ttc-dot 默认色）。 */
  colorIndex: number;
  fields: FieldMultiPickField[];
}

const props = defineProps<{
  show: boolean;
  groups: FieldMultiPickGroup[];
  /** 已作为视图列的字段，`${groupKey}::${fieldId}` 格式；命中项置灰 + 「已添加」标签，不可再选。 */
  addedKeys: string[];
  /** 置灰 + 「暂不支持」标签、不可选的字段数据类型名单（复用 drawer.fieldTypeUnsupported 文案）。 */
  unsupportedFieldTypes: string[];
  /** 已有列名（视图当前列），供列名去重预览/最终判重用。 */
  existingNames: string[];
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  confirm: [items: Array<{ groupKey: string; fieldId: string; fieldLabel: string; columnName: string }>];
}>();

const t = useT();

/**
 * 字段勾选行复选框尺寸钉定：原生 checkbox 方块为 13×13，不在 Naive 档位上；
 * 按改前运行态量测（output/i1141/metrics/2c-before 的 expr-field-multi-pick）钉在 small 档，换成 NCheckbox 后方块与原来同大。
 */
const FIELD_CHECKBOX_TIERS: KControlSizeTiers = { small: { boxSize: 13 } };
/** 组头「全选 / 取消全选」文字链接钉定：改前量测 expr-field-multi-pick 24×18、12px、行高 18、无内边距。 */
const GROUP_LINK_TIERS: KControlSizeTiers = { tiny: { height: 18, fontSize: 12, paddingX: 0 } };

// ── 左栏：搜索 + 分组折叠 ─────────────────────────────────────────────────────
const searchText = ref('');
const collapsedGroups = ref<Set<string>>(new Set());

function toggleCollapse(groupKey: string): void {
  const next = new Set(collapsedGroups.value);
  if (next.has(groupKey)) next.delete(groupKey);
  else next.add(groupKey);
  collapsedGroups.value = next;
}

/** 按字段名搜索过滤（大小写不敏感、trim）；命中 0 个字段的分组整组隐藏。 */
const filteredGroups = computed<FieldMultiPickGroup[]>(() => {
  const q = searchText.value.trim().toLowerCase();
  if (!q) return props.groups;
  return props.groups
    .map(g => ({ ...g, fields: g.fields.filter(f => f.label.toLowerCase().includes(q)) }))
    .filter(g => g.fields.length > 0);
});

// ── 已添加 / 不支持判定 ──────────────────────────────────────────────────────
const addedKeySet = computed(() => new Set(props.addedKeys));
const unsupportedTypeSet = computed(() => new Set(props.unsupportedFieldTypes));

function isAdded(groupKey: string, fieldId: string): boolean {
  return addedKeySet.value.has(`${groupKey}::${fieldId}`);
}
function isUnsupported(dataType: string): boolean {
  return unsupportedTypeSet.value.has(dataType);
}
function isDisabled(groupKey: string, field: FieldMultiPickField): boolean {
  return isAdded(groupKey, field.id) || isUnsupported(field.dataType);
}

// ── 已选（右栏）：勾选顺序即右栏顺序 ─────────────────────────────────────────
interface PickedItem {
  groupKey: string;
  fieldId: string;
  fieldLabel: string;
  /** 列名，默认取字段名去重预览；用户可在右栏直接改（改动即时生效，不会被后续勾选重新覆盖）。 */
  columnName: string;
}
const picked = ref<PickedItem[]>([]);
const pickedKeySet = computed(() => new Set(picked.value.map(p => `${p.groupKey}::${p.fieldId}`)));

function isPicked(groupKey: string, fieldId: string): boolean {
  return pickedKeySet.value.has(`${groupKey}::${fieldId}`);
}

/** 勾选/取消勾选一个字段。已添加/不支持的字段本就不会被调用方点出这条路径（模板层已禁用），
 *  这里仍做一次防御性判断，避免程序化调用绕过禁用态。 */
function toggleField(groupKey: string, field: FieldMultiPickField): void {
  if (isDisabled(groupKey, field)) return;
  const idx = picked.value.findIndex(p => p.groupKey === groupKey && p.fieldId === field.id);
  if (idx >= 0) {
    picked.value = picked.value.filter((_, i) => i !== idx);
    return;
  }
  // 新增行的默认列名：与 existingNames + 当前已选列名一起过一遍去重，让用户勾选过程中看到的
  // 预览就接近最终会落库的列名（真正兜底判重仍在 confirm() 里对整批再做一次，见该函数注释）。
  const [previewName] = dedupeColumnNames([...props.existingNames, ...picked.value.map(p => p.columnName)], [field.label]);
  picked.value = [...picked.value, { groupKey, fieldId: field.id, fieldLabel: field.label, columnName: previewName }];
}

function removePicked(index: number): void {
  picked.value = picked.value.filter((_, i) => i !== index);
}

/** 该组当前可选（未置灰）的字段——组头「全选/取消全选」只作用于这个子集。 */
function selectableFieldsOf(group: FieldMultiPickGroup): FieldMultiPickField[] {
  return group.fields.filter(f => !isDisabled(group.key, f));
}
function isGroupAllSelected(group: FieldMultiPickGroup): boolean {
  const selectable = selectableFieldsOf(group);
  return selectable.length > 0 && selectable.every(f => isPicked(group.key, f.id));
}
function toggleGroupAll(group: FieldMultiPickGroup): void {
  const selectable = selectableFieldsOf(group);
  if (selectable.length === 0) return;
  if (isGroupAllSelected(group)) {
    const removeIds = new Set(selectable.map(f => f.id));
    picked.value = picked.value.filter(p => !(p.groupKey === group.key && removeIds.has(p.fieldId)));
  } else {
    for (const f of selectable) {
      if (!isPicked(group.key, f.id)) toggleField(group.key, f);
    }
  }
}

// ── 右栏辅助：来源胶囊展示（表主题色，与来源行色点同一序号口径） ────────────────
function groupOf(groupKey: string): FieldMultiPickGroup | undefined {
  return props.groups.find(g => g.key === groupKey);
}
function groupLabelOf(groupKey: string): string {
  return groupOf(groupKey)?.label ?? groupKey;
}
/** 色点/胶囊共用同一序号口径：负数（无主题色）时色点回落 table-theme-colors.css 的中性灰默认色，
 *  胶囊回落无主题色（空串，按既有语义色渲染，不强行套色）。 */
function dotClassFor(colorIndex: number): string {
  return colorIndex >= 0 ? `ttc-${colorIndex % TABLE_THEME_COLOR_COUNT}` : '';
}
function chipClassFor(groupKey: string): string {
  const idx = groupOf(groupKey)?.colorIndex ?? -1;
  return idx >= 0 ? `ttc-themed ttc-${idx % TABLE_THEME_COLOR_COUNT}` : '';
}

// ── 弹窗几何由 KDialog 承担（默认 760×560、最小 640×420；不传 memoryKey＝不持久化尺寸，每次打开用默认尺寸）。 ──

/** 弹窗每次打开都重置为一次全新的批量添加会话：清空已选、搜索词、折叠态，几何复位。 */
watch(
  () => props.show,
  open => {
    if (!open) return;
    searchText.value = '';
    picked.value = [];
    collapsedGroups.value = new Set();
  },
  { immediate: true }
);

function close(): void {
  emit('update:show', false);
}

/** 确定：整批 emit，列名统一再跑一遍 dedupeColumnNames 兜底判重（覆盖用户手改列名后仍与
 *  existingNames 或彼此重名的情况——这是唯一权威的最终列名来源，右栏实时预览不保证绝对不重）。 */
function confirm(): void {
  if (picked.value.length === 0) return;
  const finalNames = dedupeColumnNames(props.existingNames, picked.value.map(p => p.columnName));
  emit(
    'confirm',
    picked.value.map((p, i) => ({ groupKey: p.groupKey, fieldId: p.fieldId, fieldLabel: p.fieldLabel, columnName: finalNames[i] }))
  );
  emit('update:show', false);
}

</script>

<template>
  <!-- 外壳迁到 KDialog：standard 档、可最大化 / 缩放；点遮罩无动作；
       Esc 由弹层栈仲裁（还原最大化 → 关闭）。原 data-kimpo-dialog-layer="nested" 标记退役：本层自己登记进 KLayerStack，
       FormRuntimeDialog / ActionDesignerDialog 的「更上层可见浮层」判定仍靠 .n-modal-container 命中，兼容。 -->
  <KDialog
    size-preset="M"
    :show="show"
    :title="t('fieldMultiPick.title')"
    class="fmp-card"
    data-testid="field-multi-pick-dialog"
    :default-size="{ width: 760, height: 560 }"
    flush
    @update:show="v => emit('update:show', v)"
  >
    <!-- 中部：左（搜索+分组勾选列表）/ 右（将添加 N 列预览），等宽分栏、中缝描边分隔。 -->
    <div class="fmp-body">
      <div class="fmp-left-pane fmp-col-divided">
        <NInput
          v-model:value="searchText"
          size="small"
          class="fmp-search"
          data-testid="fmp-search"
          clearable
          :placeholder="t('fieldMultiPick.searchPlaceholder')"
        />
        <NEmpty v-if="filteredGroups.length === 0" size="small" :description="t('editor.dockNoMatch')" />
        <KControlSize v-else :tiers="FIELD_CHECKBOX_TIERS">
          <div class="fmp-group-list">
            <div v-for="group in filteredGroups" :key="group.key" class="fmp-group" :data-group-key="group.key">
              <div class="fmp-group-header">
                <button
                  type="button"
                  class="fmp-collapse-btn"
                  :class="{ 'fmp-collapse-btn--collapsed': collapsedGroups.has(group.key) }"
                  :aria-label="group.label"
                  @click="toggleCollapse(group.key)"
                >
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 2.5l4 3.5-4 3.5" />
                  </svg>
                </button>
                <span class="ttc-dot" :class="dotClassFor(group.colorIndex)" aria-hidden="true"></span>
                <span class="fmp-group-label">{{ group.label }}</span>
                <span v-if="group.badge" class="fmp-group-badge">{{ group.badge }}</span>
                <span class="fmp-group-spacer" />
                <KControlSize v-if="selectableFieldsOf(group).length > 0" include-button :tiers="GROUP_LINK_TIERS">
                  <NButton
                    text
                    type="primary"
                    size="tiny"
                    class="fmp-group-toggle-all"
                    data-testid="fmp-group-toggle-all"
                    :data-group-key="group.key"
                    @click="toggleGroupAll(group)"
                  >{{ isGroupAllSelected(group) ? t('fieldMultiPick.deselectAll') : t('fieldMultiPick.selectAll') }}</NButton>
                </KControlSize>
              </div>
              <div v-if="!collapsedGroups.has(group.key)" class="fmp-field-list">
                <div
                  v-for="field in group.fields"
                  :key="field.id"
                  class="fmp-field-row"
                  :class="{ 'fmp-field-row--disabled': isDisabled(group.key, field) }"
                  data-testid="fmp-field-row"
                  :data-group-key="group.key"
                  :data-field-id="field.id"
                  @click="toggleField(group.key, field)"
                >
                  <!-- 复选框纯展示（:checked 反映 isPicked），不单独挂 @update:checked——
                       NCheckbox 内部不 stopPropagation，点击会一路冒泡到本行的 @click，
                       两处都挂会导致单次点击触发两次 toggle（选中又立即取消）。 -->
                  <NCheckbox
                    size="small"
                    class="fmp-checkbox"
                    :checked="isPicked(group.key, field.id)"
                    :disabled="isDisabled(group.key, field)"
                    :focusable="false"
                    aria-hidden="true"
                  />
                  <FieldTypeIcon :data-type="field.dataType" />
                  <span class="fmp-field-label">{{ field.label }}</span>
                  <span v-if="isAdded(group.key, field.id)" class="fmp-badge" data-testid="fmp-badge-added">{{ t('fieldMultiPick.added') }}</span>
                  <span v-else-if="isUnsupported(field.dataType)" class="fmp-badge" data-testid="fmp-badge-unsupported">{{ t('drawer.fieldTypeUnsupported') }}</span>
                </div>
              </div>
            </div>
          </div>
        </KControlSize>
      </div>

      <div class="fmp-right-pane">
        <div class="fmp-right-head">
          <span class="fmp-right-title">{{ t('fieldMultiPick.willAddPrefix') }}{{ picked.length }}{{ t('fieldMultiPick.willAddUnit') }}</span>
        </div>
        <div class="fmp-right-hint">{{ t('fieldMultiPick.columnNameHint') }}</div>
        <NEmpty v-if="picked.length === 0" size="small" :description="t('picker.selectHint')" />
        <div v-else class="fmp-right-list">
          <div
            v-for="(item, i) in picked"
            :key="`${item.groupKey}::${item.fieldId}`"
            class="fmp-right-row"
            data-testid="fmp-picked-row"
            :data-group-key="item.groupKey"
            :data-field-id="item.fieldId"
          >
            <NInput
              size="small"
              class="fmp-col-name-input"
              data-testid="fmp-col-name-input"
              :value="item.columnName"
              @update:value="v => (picked[i].columnName = v)"
            />
            <span class="fmp-arrow" aria-hidden="true">←</span>
            <span class="tok fmp-source-chip" :class="chipClassFor(item.groupKey)">
              <span class="fmp-chip-group">{{ groupLabelOf(item.groupKey) }}</span>.<span class="fmp-chip-field">{{ item.fieldLabel }}</span>
            </span>
            <button type="button" class="fmp-remove-btn" :aria-label="t('common.delete')" data-testid="fmp-remove-picked" @click="removePicked(i)">✕</button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <!-- 底部：取消 / 确定（N=0 禁用），KDialogFooter 小档；
           原按钮 testid（fmp-cancel / fmp-confirm）随 KDialogFooter 退役，改用 data-kdlf。 -->
      <KDialogFooter
        :confirm-text="`${t('fieldMultiPick.confirmPrefix')}${picked.length}${t('fieldMultiPick.confirmUnit')}`"
        :confirm-disabled="picked.length === 0"
        @cancel="close"
        @confirm="confirm"
      />
    </template>
  </KDialog>
</template>

<style scoped>
/* 窗口外壳 / 标题栏 / 页脚 / 缩放手柄由 KDialog + KDialogFooter 提供，这里只留内容区业务样式。 */

.fmp-body {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: 1fr 1fr;
}
.fmp-col-divided {
  border-right: 1px solid rgb(var(--border-lighter-color, 235 238 245));
}
.fmp-left-pane {
  display: flex;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 16px 24px;
  overflow: hidden;
}
.fmp-search {
  flex-shrink: 0;
}
.fmp-group-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.fmp-group {
  margin-bottom: 4px;
}
.fmp-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.fmp-collapse-btn {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(var(--text-secondary-color, 102 102 102));
  cursor: pointer;
  transition: transform 0.15s;
}
/* 折叠态箭头收平（未折叠时指向右下方，折叠后转正指向右方——与常见树形折叠箭头惯例一致）。 */
.fmp-collapse-btn--collapsed svg {
  transform: rotate(0deg);
}
.fmp-collapse-btn:not(.fmp-collapse-btn--collapsed) svg {
  transform: rotate(90deg);
}
.fmp-group-label {
  color: rgb(var(--base-text-color));
  font-size: 13px;
  font-weight: 500;
}
.fmp-group-badge {
  color: rgb(var(--text-hint-color));
  font-size: 12px;
}
.fmp-group-spacer {
  flex: 1 1 auto;
}
/* 「全选 / 取消全选」文字链接：高 / 字号 / 内边距由 GROUP_LINK_TIERS 钉定，这里只保留不被 flex 压缩 */
.fmp-group-toggle-all {
  flex-shrink: 0;
}
.fmp-field-list {
  display: flex;
  flex-direction: column;
}
.fmp-field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 22px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: rgb(var(--base-text-color));
}
.fmp-field-row:hover {
  background: rgb(var(--fill-light-color));
}
/* 置灰不可选（已添加/暂不支持共用一套视觉，标签文案区分两种原因）。 */
.fmp-field-row--disabled {
  color: rgb(var(--text-hint-color));
  cursor: not-allowed;
}
.fmp-field-row--disabled:hover {
  background: none;
}
.fmp-checkbox {
  flex-shrink: 0;
}
.fmp-field-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fmp-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(var(--fill-light-color, 245 247 250));
  color: rgb(var(--text-hint-color));
  font-size: 11px;
  line-height: 18px;
}

.fmp-right-pane {
  display: flex;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  padding: 16px 24px;
  overflow: hidden;
}
.fmp-right-head {
  flex-shrink: 0;
}
.fmp-right-title {
  color: rgb(var(--base-text-color));
  font-size: 14px;
  font-weight: 500;
}
.fmp-right-hint {
  flex-shrink: 0;
  margin-top: 2px;
  margin-bottom: 8px;
  color: rgb(var(--text-hint-color));
  font-size: 12px;
}
.fmp-right-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.fmp-right-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fmp-col-name-input {
  flex: 1 1 96px;
  min-width: 0;
}
.fmp-arrow {
  flex-shrink: 0;
  color: rgb(var(--text-hint-color));
  font-size: 12px;
}
/* 来源胶囊：与表达式 token 的表主题色 tint 同一视觉（.tok + ttc-themed，见 table-theme-colors.css），
   未占主题色（colorIndex<0）时 chipClassFor 回落空串，按 .tok 既有中性语义色渲染。 */
.fmp-source-chip {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fmp-remove-btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(var(--text-secondary-color, 102 102 102));
  cursor: pointer;
  font-size: 12px;
}
.fmp-remove-btn:hover {
  color: rgb(var(--error-color));
}

</style>
