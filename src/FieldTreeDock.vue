<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { NCollapse, NCollapseItem, NEmpty, NInput } from 'naive-ui';
import type { TemplateField, ValueRef, DockColumn, DockTable } from './types';
import { systemVariablesCatalog, isFieldTypeUnsupported } from './useExpressionContext';
import { useT, useExpressionEditorScopeOptions } from './host';
import { matchField as matchFieldByKeyword } from './fieldSearch';
import { tableColorClassFor } from './tableThemeColors';
import { isReportContextAlias } from './rawSerialize';
import { useTextFunctionCatalog, type FunctionCatalogItem } from './functionCatalog';

/**
 * 高级表达式面板共享的字段选择卡：本报表/来源模板/变量与函数独立整卡折叠。
 * 普通高度多列并排、低高度侧栏纵排；卡内表节点保持原有独立折叠与字段插入语义。
 * 跨卡搜索复用 fieldSearch，覆盖隐藏内容；命中卡临时展开，清空搜索恢复本次会话状态。
 * 本组件只呈现 SDK/宿主提供的上下文，不持有或读写业务数据。
 */

// DockTable/DockColumn：定义权威已挪到 types.ts（供纯 .ts 的降级构造器 dockColumns.ts 复用，
// 不必反向 import 本 .vue SFC 的类型），这里类型重导出，保持既有 `from './FieldTreeDock.vue'`
// 的对外 import 路径不变（index.ts 等消费方零改动）。
export type { DockColumn, DockTable };

const props = defineProps<{
  /** 列①：当前模板列（header=当前模板名；tables=本报表各表）。 */
  currentColumn: DockColumn;
  /** 列②…N：各数据源列（按模板分组，无模板归属的一个来源一列；见 ExpressionEditor.vue 的分组算法）。 */
  sourceColumns: DockColumn[];
  showFunctions?: boolean;
  /** 由面板的实际内容高度决定：窄侧栏按卡片纵向排列，缺省只展开首个可用来源。 */
  compact?: boolean;
}>();

const emit = defineEmits<{
  pick: [ref: ValueRef];
  'pick-function': [fn: FunctionCatalogItem];
}>();

const t = useT();
const dockRoot = ref<HTMLElement | null>(null);
const bodyIdPrefix = useId();

const scope = useExpressionEditorScopeOptions();
/** 「变量与函数」列实际展示的变量目录：scope.disableSystemVariables 为真时恒空，不改
 *  systemVariablesCatalog 单例本身内容（该单例仍是"宿主 ∪ 追加"的合并结果，供其它只做标签解析
 *  的消费方——如 AdvancedExpressionPanel 的文本序列化——原样使用，不受本子树的禁用开关影响）。 */
const visibleSystemVariables = computed(() => (scope.disableSystemVariables.value ? [] : systemVariablesCatalog.value));
/** 某字段 data_type 是否命中当前子树的置灰名单（照 host.ts 注释：注入端已把裸值/Ref 统一成
 *  ComputedRef，这里只需读 `.value`）。 */
function fieldUnsupported(dataType?: string | null): boolean {
  return isFieldTypeUnsupported(dataType, scope.unsupportedFieldTypes.value);
}

// —— 点选高亮（照抄 FieldTreePanel：点击选中→浅蓝底，直到选中另一项；hover 由纯 CSS 负责）——
const lastPicked = ref('');
function isActive(key: string): boolean {
  return lastPicked.value === key;
}
/** 数据表字段（来源列 / 当前模板列共用同一套 source_field 语义，两者仅 alias 命名空间不同）。
 *  2026-09-12 追加：命中调用方「置灰名单」（fieldUnsupported）的字段直接拦下，
 *  不 emit 也不改 lastPicked 高亮态——与模板里 .ftd-field--unsupported 置灰视觉配套，不留一个
 *  「看起来置灰了但点了还是能选中」的假禁用。 */
function pickField(alias: string, field: TemplateField): void {
  if (fieldUnsupported(field.data_type)) return;
  lastPicked.value = `sf:${alias}:${field.field_id}`;
  emit('pick', { kind: 'source_field', alias, field_id: field.field_id });
}
function pickVar(varId: string): void {
  lastPicked.value = `var:${varId}`;
  emit('pick', { kind: 'system_var', var_id: varId });
}

/** 一列本身有没有字段可展示（与搜索无关——判的是"该列配置里有东西"，不是"当前关键字命中了东西"）：
 *  除真字段外，两个降级提示标记（viewFieldsUnsupported/stagingUnsupported）也算"有内容"，因为它们
 *  各自要渲染一条提示文案。原先内联在 displayTableColumns 里，2026-09-14 起本报表列的整列隐藏判据
 *  也要用同一份口径，故抽成函数，避免两处各写一遍再漂移。 */
function columnHasAnyField(col: DockColumn): boolean {
  return col.tables.some(tb => tb.fields.length > 0 || tb.viewFieldsUnsupported || tb.stagingUnsupported);
}

/** 「本报表」列（当前模板列）是否渲染。
 *  与数据源列的差别是来路：数据源列由用户显式「添加来源」而来，空着也要留在面板里让用户看得见自己
 *  加了什么；当前模板列是编辑器按 templateId/formTables 自动垫上的，本报表压根没有可引用字段时
 *  （如视图设计器这类无本报表上下文的调用域，见截图里顶着「无字段」的空卡片）它只是占一格宽度的噪音。
 *  判据只看列本身有无内容（columnHasAnyField），**不掺搜索态**：本报表有字段但当前关键字没命中时仍
 *  渲染该列并走「无匹配」占位，否则边打字边整列消失、列宽来回跳。 */
const showCurrentColumn = computed(() => columnHasAnyField(props.currentColumn));

/** 数据表列（①当前模板 + ②…N 数据源），供模板统一 v-for；「变量与函数」列结构不同（无可折叠表节点），
 *  模板里单独渲染、恒排在最右。当前模板列按 showCurrentColumn 整列摘除（摘掉后数据源列即首列）。 */
// 使用来源别名而非过滤后的索引作为身份；本报表隐藏/来源重排不会把展开状态串给别的卡片。
const tableColumns = computed(() => [
  ...(showCurrentColumn.value ? [{ ...props.currentColumn, key: 'current' }] : []),
  ...props.sourceColumns.map(col => ({ ...col, key: `source:${col.tables.map(tb => tb.alias).join('|') || col.header}` }))
]);

const keyword = ref('');
const lowerKeyword = computed(() => keyword.value.trim().toLowerCase());
const searching = computed(() => lowerKeyword.value.length > 0);
function clearSearch(): void {
  keyword.value = '';
}
defineExpose({ clearSearch, searching });

/** 一张数据表节点的搜索后展示态：fields 为过滤后的字段（未搜索时=原样全部）；matchedCount/totalCount
 *  供节点标题追加 `(命中/总数)` 后缀（仅搜索时展示）。 */
interface DisplayTable {
  alias: string;
  label: string;
  fields: TemplateField[];
  totalCount: number;
  matchedCount: number;
  viewFieldsUnsupported?: boolean;
  stagingUnsupported?: boolean;
}
function toDisplayTable(tb: DockTable): DisplayTable | null {
  const total = tb.fields.length;
  if (!searching.value) {
    return { alias: tb.alias, label: tb.label, fields: tb.fields, totalCount: total, matchedCount: total, viewFieldsUnsupported: tb.viewFieldsUnsupported, stagingUnsupported: tb.stagingUnsupported };
  }
  const matched = tb.fields.filter(f => matchFieldByKeyword(f, lowerKeyword.value));
  if (matched.length === 0 && !tb.viewFieldsUnsupported && !tb.stagingUnsupported) return null;
  return { alias: tb.alias, label: tb.label, fields: matched, totalCount: total, matchedCount: matched.length, viewFieldsUnsupported: tb.viewFieldsUnsupported, stagingUnsupported: tb.stagingUnsupported };
}
/** 一列（数据表列）的搜索后展示态：hasAnyField 与是否搜索无关（该列本身有没有配置字段——沿用原
 *  columnIsEmpty 的判据），tables 是过滤后的节点清单。 */
interface DisplayColumn {
  key: string;
  header: string;
  tables: DisplayTable[];
  hasAnyField: boolean;
}
// 注意 filter 谓词形参命名为 dt（不用惯用的 t）：避免遮蔽 setup 顶层的翻译函数 t（同 ExpressionEditor.vue
// sourceTablesForInput 里 st 命名惯例的理由一致）。
const displayTableColumns = computed<DisplayColumn[]>(() =>
  tableColumns.value.map(col => ({
    key: col.key,
    header: col.header,
    tables: col.tables.map(toDisplayTable).filter((dt): dt is DisplayTable => dt !== null),
    hasAnyField: columnHasAnyField(col)
  }))
);
/** 某列在当前搜索下是否应显示「无匹配」占位：
 *  列本身确有字段配置（否则走既有「无字段」文案，与搜索无关），但搜索后一个数据表节点都不剩。 */
function columnNoMatch(col: DisplayColumn): boolean {
  return searching.value && col.hasAnyField && col.tables.length === 0;
}

// 「变量与函数」列的搜索过滤：系统变量目录条目形状（{var_id,label}）与 TemplateField 不同，不能直接复用
// fieldSearch.matchField，就地写等价判据——同一份 lowerKeyword、同一套"大小写不敏感包含"语义（与
// FieldTreePanel 现有 vars tab 过滤逻辑一致），只是换了字段名，不是另一套匹配算法。
// 2026-09-12 追加：底数据源从 systemVariablesCatalog 改为 visibleSystemVariables——
// 后者已叠加本子树的 disableSystemVariables 开关（见上方定义），为真时恒空数组，变量分组不出现。
const filteredVars = computed(() => {
  if (!searching.value) return visibleSystemVariables.value;
  return visibleSystemVariables.value.filter(
    v => v.label.toLowerCase().includes(lowerKeyword.value) || v.var_id.toLowerCase().includes(lowerKeyword.value)
  );
});

/** 函数分节的搜索过滤：按展示名与 snip 双路匹配——用户既可能搜中文
 *  「求和」，也可能直接搜 SUM。展示名要经 t() 翻译后再比，否则搜的是 i18n 键而不是用户看到的字。 */
const textCatalog = useTextFunctionCatalog();
const filteredFunctions = computed(() => {
  if (!props.showFunctions) return [];
  if (!searching.value) return textCatalog.value;
  return textCatalog.value.filter(
    fn =>
      t(fn.labelKey).toLowerCase().includes(lowerKeyword.value) || fn.snip.toLowerCase().includes(lowerKeyword.value)
  );
});

// 整卡空态同时考虑变量和函数，不能在函数命中时仍展示“无匹配”。
const varsNoMatch = computed(() => searching.value && filteredVars.value.length === 0 && filteredFunctions.value.length === 0);

const cardOverrides = ref<Record<string, boolean>>({});
const searchOverrides = ref<Record<string, boolean>>({});
watch(lowerKeyword, () => { searchOverrides.value = {}; }, { flush: 'sync' });
const firstUsefulCard = computed(() => tableColumns.value.find(columnHasAnyField)?.key ?? 'vars');
function defaultExpanded(key: string): boolean {
  return cardOverrides.value[key] ?? (!props.compact || key === firstUsefulCard.value);
}
function cardMatches(key: string): boolean {
  if (key === 'vars') return filteredVars.value.length > 0 || filteredFunctions.value.length > 0;
  return displayTableColumns.value.find(col => col.key === key)?.tables.some(tb => tb.matchedCount > 0) ?? false;
}
function cardExpanded(key: string): boolean {
  if (!searching.value) return defaultExpanded(key);
  return searchOverrides.value[key] ?? (cardMatches(key) || defaultExpanded(key));
}
function bodyId(key: string): string {
  return `${bodyIdPrefix}-card-${encodeURIComponent(key)}`;
}
function focusHeader(key: string): void {
  const headers = dockRoot.value?.querySelectorAll<HTMLButtonElement>('.ftd-col-header');
  Array.from(headers ?? []).find(header => header.dataset.cardKey === key)?.focus();
}
function toggleCard(key: string): void {
  const overrides = searching.value ? searchOverrides : cardOverrides;
  overrides.value = { ...overrides.value, [key]: !cardExpanded(key) };
}
const expandedKeys = computed(() => [...tableColumns.value.map(col => col.key), 'vars'].filter(cardExpanded));
// clearSearch/容器切换也可能收起原先命中的卡，先把卡内焦点交回标题，避免焦点留在隐藏内容。
watch(expandedKeys, keys => {
  const active = dockRoot.value?.ownerDocument.activeElement as HTMLElement | null;
  const body = active?.closest<HTMLElement>('.ftd-col-body');
  const key = body?.dataset.cardKey;
  if (body && key && dockRoot.value?.contains(body) && !keys.includes(key)) focusHeader(key);
}, { flush: 'pre' });
function cardLabel(key: string, header: string): string {
  return `${t(cardExpanded(key) ? 'editor.dockCollapseCard' : 'editor.dockExpandCard')} ${header}`;
}

/** 本报表标识：当前模板列与数据源列可能顶着同一个模板名（本报表自己又被选作
 *  历史数据来源），仅凭列头分不清；本报表上下文表（bt* / rpt-* 别名，同 tableThemeColors 口径）的表图标
 *  底片换成既有「本报表」绿色语义并挂 title，与来源表的主色/主题色底片区分开。 */
function isReportTable(alias: string): boolean {
  return isReportContextAlias(alias);
}

/** 点选函数：只把目录项抛给调用方（由它决定插入片段与展示说明），本组件不碰编辑框。 */
function pickFunction(fn: FunctionCatalogItem): void {
  lastPicked.value = `fn:${fn.key}`;
  emit('pick-function', fn);
}
</script>

<template>
  <div ref="dockRoot" class="field-tree-dock" :class="{ 'field-tree-dock--compact': compact }">
    <div class="ftd-search-bar">
      <NInput v-model:value="keyword" size="small" clearable class="ftd-search" :placeholder="t('drawer.searchPlaceholder')" @keydown.esc="clearSearch">
        <template #prefix>
          <!-- 搜索（放大镜）图标：同 FieldTreePanel.vue 既有的内联 SVG，风格一致（currentColor 描边）。 -->
          <svg class="ftd-search-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </template>
      </NInput>
    </div>

    <div class="ftd-cols">
      <div v-for="col in displayTableColumns" :key="col.key" class="ftd-col" :class="{ 'ftd-col--collapsed': !cardExpanded(col.key) }">
        <button type="button" class="ftd-col-header" :data-card-key="col.key" :title="cardLabel(col.key, col.header)"
          :aria-label="cardLabel(col.key, col.header)" :aria-expanded="cardExpanded(col.key)" :aria-controls="bodyId(col.key)" @click="toggleCard(col.key)">
          <svg class="ftd-card-chevron" :class="{ 'ftd-card-chevron--expanded': cardExpanded(col.key) }" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
          <span class="ftd-card-title">{{ col.header }}</span>
        </button>
        <div v-show="cardExpanded(col.key)" :id="bodyId(col.key)" class="ftd-col-body" :data-card-key="col.key">
          <NEmpty v-if="!col.hasAnyField" size="small" :description="t('drawer.noFields')" />
          <NEmpty v-else-if="columnNoMatch(col)" size="small" :description="t('editor.dockNoMatch')" />
          <NCollapse v-else arrow-placement="left" :default-expanded-names="col.tables.map(tb => tb.alias)">
            <NCollapseItem v-for="tb in col.tables" :key="tb.alias" :name="tb.alias">
              <template #header>
                <!-- ttc-N（2026-09-02 表主题色草案）：来源表节点图标底片按表色 tint，与①来源行圆点/
                     快捷选择器/表达式 token 同色同源；本报表上下文表（bt* / rpt-*）无主题色，改挂
                     ftd-tbl-chip--report 绿色底片作「本报表」标识（2026-09-07，见 isReportTable）。 -->
                <span
                  class="ftd-tbl-chip"
                  :class="[tableColorClassFor(tb.alias, col.tables), { 'ftd-tbl-chip--report': isReportTable(tb.alias) }]"
                  :title="isReportTable(tb.alias) ? t('drawer.tabForm') : undefined"
                >
                  <!-- 表图标：与 FieldTreePanel.vue / SourceTreePicker.vue 同一路径，包内约定的「数据表」glyph。 -->
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </span>
                <!-- 搜索中：表名追加 (命中数/总数)，如「订单(1/4)」。 -->
                <span class="ftd-tbl-name">{{ tb.label }}<span v-if="searching" class="ftd-match-count">({{ tb.matchedCount }}/{{ tb.totalCount }})</span></span>
              </template>
              <!-- 2026-09-12 追加：命中调用方 unsupportedFieldTypes 置灰名单的字段——保留
                   展示，置灰 + title 提示「暂不支持」，pickField
                   内部已拦截点选，这里仅负责视觉与 aria-disabled 语义。 -->
              <button
                type="button"
                v-for="f in tb.fields"
                :key="f.field_id"
                class="ftd-field"
                :class="{ active: isActive(`sf:${tb.alias}:${f.field_id}`), 'ftd-field--unsupported': fieldUnsupported(f.data_type) }"
                :title="fieldUnsupported(f.data_type) ? t('drawer.fieldTypeUnsupported') : undefined"
                :aria-disabled="fieldUnsupported(f.data_type) || undefined"
                :disabled="fieldUnsupported(f.data_type)"
                @click="pickField(tb.alias, f)"
              >
                {{ f.field_name }}
              </button>
              <div v-if="tb.fields.length === 0 && tb.viewFieldsUnsupported" class="ftd-hint">{{ t('drawer.viewFieldsUnsupported') }}</div>
              <div v-if="tb.fields.length === 0 && tb.stagingUnsupported" class="ftd-hint">{{ t('drawer.stagingUnsupported') }}</div>
            </NCollapseItem>
          </NCollapse>
        </div>
      </div>

      <!-- 「变量与函数」列恒在最右：数据同 FieldTreePanel 的 vars tab（系统变量目录），
           扁平列表、无可折叠数据表节点——变量没有"所属数据表"这层结构；同样受顶部搜索过滤。 -->
      <div class="ftd-col ftd-col-vars" :class="{ 'ftd-col--collapsed': !cardExpanded('vars') }">
        <button type="button" class="ftd-col-header" data-card-key="vars" :title="cardLabel('vars', t('editor.dockVarsColumn'))"
          :aria-label="cardLabel('vars', t('editor.dockVarsColumn'))" :aria-expanded="cardExpanded('vars')" :aria-controls="bodyId('vars')" @click="toggleCard('vars')">
          <svg class="ftd-card-chevron" :class="{ 'ftd-card-chevron--expanded': cardExpanded('vars') }" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
          <span class="ftd-card-title">{{ t('editor.dockVarsColumn') }}</span>
        </button>
        <div v-show="cardExpanded('vars')" :id="bodyId('vars')" class="ftd-col-body" data-card-key="vars">
          <NEmpty v-if="varsNoMatch" size="small" :description="t('editor.dockNoMatch')" />
          <button
            type="button"
            v-for="v in filteredVars"
            :key="v.var_id"
            class="ftd-field ftd-var"
            :class="{ active: isActive(`var:${v.var_id}`) }"
            @click="pickVar(v.var_id)"
          >
            {{ v.label }}
          </button>

          <!-- 函数分节：此前本列名为「变量与函数」却只有变量，
               函数全在横条 OperatorFunctionBar 上——列名与内容对不上。函数插入的是 SUM() 这类
               **自由文本片段**，只在单表达式弹窗的 textarea 里成立；外层四段式编辑器是 token 化
               输入，插进去没有意义，故由调用方按场景开关，不默认开启。 -->
          <template v-if="props.showFunctions">
            <div v-if="filteredFunctions.length > 0" class="ftd-subhead">{{ t('adv.functions') }}</div>
            <button
              type="button"
              v-for="fn in filteredFunctions"
              :key="fn.key"
              class="ftd-field ftd-fn"
              :class="{ active: isActive(`fn:${fn.key}`) }"
              @click="pickFunction(fn)"
            >
              {{ t(fn.labelKey) }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 树坞外层：纵向排列——搜索栏在上，多列并排的树区在下。 */
.field-tree-dock {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  min-height: 0;
}
/* 搜索栏：固定高度，不参与下方树区的纵向滚动。 */
.ftd-search-bar {
  flex-shrink: 0;
}
.ftd-search :deep(.n-input__border),
.ftd-search :deep(.n-input__state-border) {
  border-color: rgb(var(--border-deep-color));
}
.ftd-search-ico {
  color: rgb(var(--text-hint-color));
}
/* 树区：多列并排，整体横向滚动（容器宽度不够时），每列各自纵向滚动。 */
.ftd-cols {
  display: flex;
  align-items: stretch;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.ftd-col {
  display: flex;
  flex-direction: column;
  flex: 0 0 164px;
  min-height: 0;
  border: 1px solid rgb(var(--border-color));
  border-radius: 8px;
  overflow: hidden;
  background: rgb(var(--container-bg-color, 255 255 255));
}
/* 变量与函数列：与数据表列同宽。 */
.ftd-col-vars {
  flex: 0 0 164px;
}
.ftd-col-header {
  width: 100%;
  border: 0;
  cursor: pointer;
  gap: 4px;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 2px 4px;
  font-size: 12px;
  font-weight: 400;
  line-height: 22px;
  color: rgb(var(--text-secondary-color));
  background: rgb(var(--fill-color));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ftd-col--collapsed { align-self: flex-start; }
.ftd-card-chevron { flex: none; transition: transform 120ms; }
.ftd-card-chevron--expanded { transform: rotate(90deg); }
.ftd-card-title { overflow: hidden; text-overflow: ellipsis; }
.ftd-col-header:focus-visible, .ftd-field:focus-visible {
  outline: 2px solid rgb(var(--primary-color));
  outline-offset: -2px;
}
/* 实测低高度时，卡片纵向滚动；长列表在卡内滚动，后续卡片标题仍易于到达。 */
.field-tree-dock--compact .ftd-cols { display: block; overflow: hidden auto; }
.field-tree-dock--compact .ftd-col { width: auto; margin-bottom: 8px; }
.field-tree-dock--compact .ftd-col-body { min-height: 120px; max-height: 240px; flex: none; }
.ftd-col-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}
/* 以下节点视觉照抄 FieldTreePanel.vue 的 .ft-tbl-chip/.ft-tbl-name/.ft-field/.ft-var/.ft-hint —— */
.ftd-tbl-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  margin-right: 2px;
  background: rgb(var(--primary-50-color) / 0.5);
  color: rgb(var(--primary-color));
  flex-shrink: 0;
}
/* 表主题色 tint（草案）：带 ttc-N 色类（全局 table-theme-colors.css 只发 --ttc 变量）的来源表
 * 节点，底片与 glyph 换成该表主题色；无色类（本报表/变量列）保持上面的默认主色。 */
.ftd-tbl-chip[class*='ttc-'] {
  background: rgb(var(--ttc) / 12%);
  color: rgb(var(--ttc));
}
/* 本报表标识（2026-09-07）：本报表上下文表的图标底片用既有「本报表」绿色语义（同 form_field token /
   已关联徽标的 success 色），与来源表的主色/主题色底片区分。 */
.ftd-tbl-chip--report {
  background: rgb(var(--success-color) / 0.14);
  color: rgb(var(--success-color));
}
.ftd-tbl-name {
  font-size: 12px;
  line-height: 22px;
  color: rgb(var(--base-text-color));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 搜索命中数/总数后缀：比表名弱化一级，与主色态区分辅助信息。 */
.ftd-match-count {
  margin-left: 2px;
  color: rgb(var(--text-hint-color));
}
/* 🔴 2026-08-28 修「字段间隔建议调小 + 首项上方多一个空位」（用户测试反馈 #40）：
   本组件从未覆写过 naive NCollapse 的默认间距，于是
     ① .n-collapse-item__content-inner 的默认上内边距 ⇒ 表节点与其下第一个字段之间空出
        整整一行（截图里被框出来的那个"空占位"，其实不是多渲染了一行，是这段内边距）；
     ② .n-collapse-item 的默认上外边距 + 分隔线 ⇒ 多张表之间也偏松。
   这里把这三处收紧；字段行本身的垂直内边距同时由 6px 收到 3px（行高 22 不变 ⇒ 单行
   34px → 28px），一屏能多放约 1/5 的字段。
   🔴 2026-08-29 补：① 当时写成 `:deep(.n-collapse .n-collapse-item__content-inner)`，
   特异性只有 (0,3,0)（1 个 data-v 属性 + 2 个类），而 naive 运行时注入的规则是四级嵌套
   `.n-collapse .n-collapse-item .n-collapse-item__content-wrapper .n-collapse-item__content-inner`
   (0,4,0) —— 我们输了，padding-top: 16px 一直生效，那个"空占位"其实从未被消掉。
   改为把 naive 的选择器链写全（+ data-v ⇒ (0,5,0)）才真正压过去。② 那两条（item margin-top /
   分隔线 border-top）特异性本就赢，不动。 */
:deep(.n-collapse .n-collapse-item .n-collapse-item__content-wrapper .n-collapse-item__content-inner) {
  padding-top: 0;
}
:deep(.n-collapse .n-collapse-item) {
  margin-top: 0;
}
:deep(.n-collapse .n-collapse-item .n-collapse-item__header) {
  padding-top: 0;
}
:deep(.n-collapse .n-collapse-item:not(:first-child)) {
  border-top: none;
}

.ftd-field {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  font-family: inherit;
  padding: 3px 7px 3px 36px;
  font-size: 12px;
  line-height: 22px;
  border-radius: 4px;
  cursor: pointer;
  color: rgb(var(--base-text-color));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ftd-field:hover {
  background: rgb(var(--fill-light-color));
}
.ftd-field.active {
  background: rgb(var(--primary-50-color) / 0.5);
}
/* 置灰不可选：命中调用方 unsupportedFieldTypes 的字段——弱化文字色 + 不可点
 * 光标，hover 不再变色（不给"仍可交互"的错误暗示），提示文案经 title 属性呈现（见模板）。 */
.ftd-field--unsupported {
  color: rgb(var(--text-hint-color));
  cursor: not-allowed;
}
.ftd-field--unsupported:hover {
  background: none;
}
/* 变量列扁平列表：无需表图标缩进。 */
.ftd-var {
  padding-left: 7px;
}
.ftd-fn {
  padding-left: 7px;
}
.ftd-subhead {
  padding: 8px 7px 4px;
  border-top: 1px solid rgb(var(--border-lightest-color));
  margin-top: 6px;
  font-size: 12px;
  color: rgb(var(--text-secondary-color));
}
.ftd-hint {
  padding: 6px 7px 6px 36px;
  font-size: 12px;
  color: rgb(var(--text-hint-color));
  cursor: default;
}
</style>
