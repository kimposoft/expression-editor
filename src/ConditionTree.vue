<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSelect, NTag } from 'naive-ui';
import type { TemplateField } from './types';
import type { CompareOp, ConditionGroup, Predicate, ValueRef } from './types';
import { applyPredicateOp, isBetweenOp, isNullCompareOp, tableRoleOf } from './types';
import ExpressionInput from './ExpressionInput.vue';
import { useT } from './host';
// K9-d 参数类引用被动提示：systemVariablesCatalog 取系统变量显示名；TableFields 补全 formTables 的
// table_role/sort_no 字段（判定「本报表主表」用），与 ExpressionInput.vue 的 formTables 声明保持一致。
import { isCompareOperatorAvailable, systemVariablesCatalog, type TableFields } from './useExpressionContext';

/**
 * 条件布尔树：可嵌套的 ConditionGroup（并且/或者 + 不满足取反），
 * 每项为「谓词」或「子组」。谓词 = 左 ValueRef + 运算符 + 右 ValueRef，复用统一 mention 输入 + 持久抽屉。
 * 递归自引用渲染子组，支持 OR / NOT / 嵌套——与后端 expression.Validate/Compile 同构。
 *
 * K1（is_null/is_not_null）：判空算子语义上无右值——切到这两个算子时隐藏右侧输入并从模型删除 right 字段。
 * K9-d（参数类引用被动提示）：谓词一侧若引用「系统变量」或「本报表主表字段」，这类值在填报态可能未被
 * 赋值（unfilled），据此渲染纯提示性灰字说明本条件在参数未填时的行为——纯信息展示，不是开关。
 *
 * 数据流左右分栏改版：本组件现挂载在 ConditionEditorDialog 内（无外部常驻字段树坞可配合抽屉总线插入），
 * 左右值两处 ExpressionInput 均加 prefer-quick-pick——否则点值区只会注册为总线激活槽、没有任何 UI
 * 能触发插入（"死点击"，见 QuickFieldPicker.vue 头注释背景）。
 *
 * 「条件组」范式改版：组头原「并且/或者」两按钮
 * + 「不满足」按钮，改为组头双下拉「[满足|不满足] 以下 [全部|任一] 条件」——negate/logic 两字段语义
 * 完全不变，只是交互载体从按钮组换成下拉（见 onNegateSelect/onLogicSelect，内部仍分别调用既有
 * toggleNegate/setLogic，零改形）。逐行「并且/或者」只读连接词随之删除（语义已在组头声明一次，不必
 * 逐行重复）；组内「＋条件/＋条件组」两个新增入口挪到组内容尾部（组头只负责声明本组语义）。
 * 取反视觉：原整圈变色边框（.negated 覆盖 .nested 的 border-color）改为左侧 2px 色条——非取反的嵌套组
 * 沿用只读区 ConditionReadonlyView.vue 的 --border-color 灰色系，取反组统一换 --warning-color 橙色系
 * （无论是否嵌套），与只读区左色条视觉口径对齐（该组件只读，不能改，故本组件反过来对齐它）。
 */
defineOptions({ name: 'ConditionTree' });
const t = useT();

const props = defineProps<{
  group: ConditionGroup;
  sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[] }[];
  /** 本报表各表（含隐式 context 别名 bt*，ExpressionEditor.reportAlias 生成）。alias 为空表示调用方
   *  无「本报表」上下文（如 表格编辑器插件 cell-controls 从数据管道恒传 []）。 */
  formTables: (TableFields & { alias?: string })[];
  keyPrefix: string;
  depth?: number;
  /** 透传到谓词输入：是否显示「高级/开窗/CASE」入口（where 顶层开、CASE 内层关）。 */
  advanced?: boolean;
}>();

const emit = defineEmits<{ 'update:group': [g: ConditionGroup]; remove: [] }>();

// 选项数组含翻译 key，改为 computed 以保证响应式翻译。
const opOptions = computed<{ label: string; value: CompareOp }[]>(() => {
  const options: { label: string; value: CompareOp }[] = [
    { label: '=', value: 'eq' },
    { label: '≠', value: 'neq' },
    { label: '<', value: 'lt' },
    { label: '≤', value: 'lte' },
    { label: '>', value: 'gt' },
    { label: '≥', value: 'gte' },
    // E10：区间比较算子对，放在四个大小比较符之后、like 之前——与它们同属"排序相关"能力。
    { label: t('cond.opBetween'), value: 'between' },
    { label: t('cond.opNotBetween'), value: 'not_between' },
    { label: t('cond.opLike'), value: 'like' },
    { label: t('cond.opIn'), value: 'in' },
    { label: t('cond.opNotIn'), value: 'not_in' },
    // K1：为空/不为空——判空算子无右值，追加在既有九项之后，不打乱既有下拉顺序。
    { label: t('cond.opIsNull'), value: 'is_null' },
    { label: t('cond.opIsNotNull'), value: 'is_not_null' }
  ];
  return options.filter(option => isCompareOperatorAvailable(option.value));
});

function emitGroup(mut: (g: ConditionGroup) => void) {
  const next: ConditionGroup = JSON.parse(JSON.stringify(props.group));
  mut(next);
  emit('update:group', next);
}

function emptyRef(): ValueRef {
  return { kind: 'const', value: '' };
}
function newPredicate(): Predicate {
  return { left: emptyRef(), op: 'eq', right: emptyRef() };
}
function newGroup(): ConditionGroup {
  return { logic: 'and', items: [{ predicate: newPredicate() }] };
}

function setLogic(logic: 'and' | 'or') {
  emitGroup(g => {
    g.logic = logic;
  });
}
function toggleNegate() {
  emitGroup(g => {
    g.negate = !g.negate;
  });
}
function addPredicate() {
  emitGroup(g => {
    g.items.push({ predicate: newPredicate() });
  });
}
function addSubGroup() {
  emitGroup(g => {
    g.items.push({ group: newGroup() });
  });
}
function removeItem(idx: number) {
  emitGroup(g => {
    g.items.splice(idx, 1);
  });
}
function setPredicateSide(idx: number, side: 'left' | 'right' | 'right2', v: ValueRef | null) {
  emitGroup(g => {
    const p = g.items[idx].predicate;
    if (p) p[side] = v ?? emptyRef();
  });
}
function setPredicateOp(idx: number, op: CompareOp) {
  emitGroup(g => {
    const p = g.items[idx].predicate;
    if (!p) return;
    // K1：右值落地规则（判空算子删 right / 其它算子缺失则补空 const）抽成纯函数 applyPredicateOp（见
    // types.ts），组件层只负责替换该项，便于单测且与组件解耦。
    g.items[idx].predicate = applyPredicateOp(p, op);
  });
}
function setSubGroup(idx: number, sub: ConditionGroup) {
  emitGroup(g => {
    g.items[idx].group = sub;
  });
}

// ── 组头双下拉（条件组范式）：选项与 change 处理 ──────────────────────────────
// 「满足/不满足」下拉：value 用字符串字面量（NSelect 的 SelectOption.value 类型是 string | number，
// 不接受 boolean，故不能直接拿 negate 布尔值当选项 value），下方 onNegateSelect 再换算回 negate 布尔。
type NegateChoice = 'satisfy' | 'notSatisfy';
const negateOptions = computed<{ label: string; value: NegateChoice }[]>(() => [
  { label: t('cond.groupSatisfy'), value: 'satisfy' },
  { label: t('cond.groupNotSatisfy'), value: 'notSatisfy' }
]);
/** 当前 negate 状态对应的下拉选中值。 */
const negateChoice = computed<NegateChoice>(() => (props.group.negate ? 'notSatisfy' : 'satisfy'));
// 「全部/任一」下拉：value=logic（'and'=全部/'or'=任一），与谓词行 opOptions 同一 computed 风格。
const logicOptions = computed<{ label: string; value: 'and' | 'or' }[]>(() => [
  { label: t('cond.groupAll'), value: 'and' },
  { label: t('cond.groupAny'), value: 'or' }
]);

/** 「满足/不满足」下拉 change：仅当选中值与当前 negate 状态确有差异才触发，内部仍调用既有
 *  toggleNegate（翻转布尔，false 时落地为字面 false 而非删字段——与旧「不满足」按钮逐字节一致），
 *  只是触发源从 click 换成下拉 change，不改 negate 字段的写入形态（红线 6）。 */
function onNegateSelect(v: NegateChoice) {
  if (v !== negateChoice.value) toggleNegate();
}
/** 「全部/任一」下拉 change：同上，仅值确有变化才调用既有 setLogic，避免重选同一项时空转 emit。 */
function onLogicSelect(v: 'and' | 'or') {
  if (v !== props.group.logic) setLogic(v);
}

// ── K9-d：参数类引用被动提示（纯信息灰字，不是开关）──────────────────────────
// 「参数类引用」= 系统变量，或本报表**主表**字段引用（is_context 主表；扩展表/明细不算——明细字段是
// 同批次数据本身，不是外部参数）。本编辑器把「本报表」字段建模成 source_field + bt* 别名而非 form_field
// kind（见 matchKeyExtract.ts 顶部说明：ExpressionEditor.reportAlias 生成 bt0=主表/bt1..=扩展），
// 故下面 isParamRef 同时兼容 source_field(bt*) 与 form_field 两种表示——后者本编辑器自身不产出，
// 但类型层面仍存在（如未来其它调用方直接喂入该 kind 的谓词），一并判定不遗漏。

function isMainReportAlias(alias?: string): boolean {
  if (!alias) return false;
  const ft = props.formTables.find(f => f.alias === alias);
  if (!ft) return false;
  return tableRoleOf(ft.table, props.formTables.map(f => f.table)) === 'main';
}

/** 是否为「参数类引用」（判定口径见上）。 */
function isParamRef(v: ValueRef | undefined): boolean {
  if (!v) return false;
  if (v.kind === 'system_var') return true;
  if (v.kind === 'source_field') return isMainReportAlias(v.alias);
  if (v.kind === 'form_field') {
    const ft = props.formTables.find(f => f.table.data_table_id === v.table_id);
    return !!ft && tableRoleOf(ft.table, props.formTables.map(f => f.table)) === 'main';
  }
  return false;
}

/** 参数类引用的显示名（字段名 / 系统变量名），供提示文案插值 {name}。 */
function paramRefName(v: ValueRef): string {
  if (v.kind === 'system_var') {
    return systemVariablesCatalog.value.find(sv => sv.var_id === v.var_id)?.label ?? v.var_id ?? '';
  }
  const ft = v.kind === 'source_field' ? props.formTables.find(f => f.alias === v.alias) : props.formTables.find(f => f.table.data_table_id === v.table_id);
  return ft?.fields.find(fl => fl.field_id === v.field_id)?.field_name ?? v.field_id ?? '';
}

/** 用参数显示名替换文案里的 {name} 占位。当前各宿主 ExpressionHost.t 实现均未接入真插值（args 透传后
 *  原样返回模板串，见 host.ts useT 的 zhCN 兜底分支），故这里在组件内自行替换兜底；未来宿主若接入
 *  vue-i18n 等做了真插值，占位已被替换，此 replace 是安全的空操作。 */
function withName(template: string, name: string): string {
  return template.replace('{name}', name);
}

/** 谓词的被动提示文案：某侧为参数类引用 + 非判空算子时给出；否则 null（不渲染）。
 *  左右两侧都命中时取左侧——业务上足够定位，无需并列提示。 */
function paramHint(p: Predicate | undefined): string | null {
  if (!p || isNullCompareOp(p.op)) return null; // 判空算子本身就是在处理"未填"，无需再提示
  const ref = isParamRef(p.left) ? p.left : isParamRef(p.right) ? p.right : null;
  if (!ref) return null;
  const name = paramRefName(ref);
  const key = p.op === 'eq' ? 'cond.paramHintAlwaysFalse' : 'cond.paramHintNoEffect';
  return withName(t(key, { name }), name);
}
</script>

<template>
  <div class="cond-group" :class="{ nested: (depth ?? 0) > 0, negated: group.negate }">
    <div v-if="(depth ?? 0) === 0" class="native-text-hint" data-testid="condition-native-text-hint">
      {{ t('editor.nativeTextEqualityHint') }}
    </div>
    <!-- 组头（条件组范式）：双下拉声明本组语义——「[满足|不满足] 以下 [全部|任一] 条件」，与只读区
         ConditionReadonlyView.vue 的 groupLabel 同一语序，只是编辑态多一层可交互下拉；negate/logic
         字段写入形态与旧按钮组完全一致（见 onNegateSelect/onLogicSelect）。右端 depth>0 时挂组删除。 -->
    <div class="group-head">
      <NSelect
        size="medium"
        class="group-head-sel group-head-sel-negate"
        :options="negateOptions"
        :value="negateChoice"
        @update:value="onNegateSelect"
      />
      <span v-if="t('cond.groupPrefix')" class="group-head-word">{{ t('cond.groupPrefix') }}</span>
      <NSelect
        size="medium"
        class="group-head-sel group-head-sel-logic"
        :options="logicOptions"
        :value="group.logic"
        @update:value="onLogicSelect"
      />
      <span class="group-head-word">{{ t('cond.groupSuffix') }}</span>
      <!-- 组删除：与条件行删除同款 24px 报错色垃圾桶。 -->
      <button
        v-if="(depth ?? 0) > 0"
        type="button"
        class="cond-remove group-head-remove"
        :title="t('cond.deleteGroup')"
        @click="emit('remove')"
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 6h16" />
          <path d="M9.5 6V4.5h5V6" />
          <path d="M6.5 6l.8 13a1 1 0 0 0 1 .95h7.4a1 1 0 0 0 1-.95L17.5 6" />
          <path d="M10 10v6M14 10v6" />
        </svg>
      </button>
    </div>

    <div v-for="(it, idx) in group.items" :key="idx" class="cond-item-wrap">
      <div class="cond-item">
        <template v-if="it.predicate">
          <div class="cond-item-fields">
            <ExpressionInput
              :model-value="it.predicate.left"
              :source-tables="sourceTables"
              :form-tables="formTables"
              :advanced="advanced"
              :prefer-quick-pick="true"
              :allow-null-const="true"
              :slot-key="`${keyPrefix}-${idx}-L`"
              :placeholder="t('cond.leftValue')"
              @update:model-value="v => setPredicateSide(idx, 'left', v)"
            />
            <NSelect
              size="medium"
              class="op-sel"
              :options="opOptions"
              :value="it.predicate.op"
              @update:value="v => setPredicateOp(idx, v)"
            />
            <!-- K1：is_null/is_not_null 无右值，隐藏右侧输入（模型层已在 setPredicateOp 里删除 right）。
                 allow-null-const：新增「空值」快捷选项（⊞ 快捷选择列表最前一项）——与判空算子并存的
                 另一种判空写法「字段 = 空值」，右值产出真正的 const null（见 QuickFieldPicker.vue）。 -->
            <ExpressionInput
              v-if="!isNullCompareOp(it.predicate.op)"
              :model-value="it.predicate.right ?? null"
              :source-tables="sourceTables"
              :form-tables="formTables"
              :advanced="advanced"
              :prefer-quick-pick="true"
              :allow-null-const="true"
              :slot-key="`${keyPrefix}-${idx}-R`"
              :placeholder="t('cond.rightValue')"
              @update:model-value="v => setPredicateSide(idx, 'right', v)"
            />
            <!-- E10：between/not_between 额外渲染"和 + 第二右值"，与只读区 ConditionReadonlyView.vue 的
                 「介于 a 和 b」视觉口径一致；right2 落地规则（切算子时的补/删）见 types.ts applyPredicateOp。 -->
            <template v-if="isBetweenOp(it.predicate.op)">
              <span class="between-and-word">{{ t('cond.betweenAnd') }}</span>
              <ExpressionInput
                :model-value="it.predicate.right2 ?? null"
                :source-tables="sourceTables"
                :form-tables="formTables"
                :advanced="advanced"
                :prefer-quick-pick="true"
                :allow-null-const="true"
                :slot-key="`${keyPrefix}-${idx}-R2`"
                :placeholder="t('cond.rightValue')"
                @update:model-value="v => setPredicateSide(idx, 'right2', v)"
              />
            </template>
          </div>
          <button type="button" class="cond-remove" :title="t('cond.remove')" @click="removeItem(idx)">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16" />
              <path d="M9.5 6V4.5h5V6" />
              <path d="M6.5 6l.8 13a1 1 0 0 0 1 .95h7.4a1 1 0 0 0 1-.95L17.5 6" />
              <path d="M10 10v6M14 10v6" />
            </svg>
          </button>
        </template>
        <!-- 子组（递归） -->
        <ConditionTree
          v-else-if="it.group"
          :group="it.group"
          :source-tables="sourceTables"
          :form-tables="formTables"
          :advanced="advanced"
          :key-prefix="`${keyPrefix}-g${idx}`"
          :depth="(depth ?? 0) + 1"
          @update:group="g => setSubGroup(idx, g)"
          @remove="removeItem(idx)"
        />
      </div>
      <!-- K9-d：参数类引用被动提示——纯信息灰字，不是开关；仅比较条件适用（子组无此提示）。 -->
      <div v-if="paramHint(it.predicate)" class="param-hint">{{ paramHint(it.predicate) }}</div>
      <!-- E11：like 通配模式提示——纯信息灰字，告知默认前后通配、可手动删一侧改前缀/后缀匹配。
           复用 .param-hint 视觉（同属"纯信息灰字提示"，不新增样式类）。 -->
      <div v-if="it.predicate && it.predicate.op === 'like'" class="param-hint" data-testid="cond-like-pattern-hint">{{ t('cond.likePatternHint') }}</div>
    </div>

    <!-- 空组占位：.cond-group 是 flex column，默认 stretch 会把标签拉成整行灰条，
         故显式收成内容宽度靠左。 -->
    <NTag v-if="group.items.length === 0" size="small" :bordered="false" class="cond-empty-tag">{{ t('cond.emptyGroup') }}</NTag>

    <!-- 组尾：新增条件 / 新增条件组，从组头挪到组内容之后（组头收窄为纯语义声明）。 -->
    <div class="group-foot">
      <NButton size="tiny" dashed @click="addPredicate">{{ t('cond.addCondition') }}</NButton>
      <NButton size="tiny" dashed @click="addSubGroup">{{ t('cond.addGroup') }}</NButton>
    </div>
  </div>
</template>

<style scoped>
.cond-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 顶层非嵌套非取反组不设边框（零缩进，与改版前视觉一致）；.nested/.negated 按需各自声明完整
     border-left（含宽度/线型），见下两条规则。 */
}
.native-text-hint {
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--base-text-color) / 0.62);
}
.cond-group.nested {
  padding: 4px 12px;
  border-left: 2px solid rgb(var(--primary-color));
}
/* 取反组：左色条统一换橙色（--warning-color），无论是否嵌套——替代原整圈变色边框，声明须晚于
   .nested 以在「既嵌套又取反」时用完整 border-left 覆盖其灰色边框（取反视觉优先级更高）。顶层
   取反组（非 nested）单独补一份缩进，否则色条会紧贴内容无呼吸感。 */
.cond-group.negated {
  padding-left: 12px;
  border-left: 2px solid rgb(var(--warning-color));
}
/* 组头：双下拉（满足/不满足 + 全部/任一）+ 首尾两个说明文字 + 右端组删除。 */
.group-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.group-head-word {
  font-size: 14px;
  line-height: 22px;
  color: rgb(var(--text-secondary-color, 102 102 102));
}
.group-head-sel-negate {
  width: 80px;
}
.group-head-sel-logic {
  width: 80px;
}
.group-head-remove {
  margin-left: auto;
}
.cond-empty-tag {
  align-self: flex-start;
}
.group-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.group-foot :deep(.n-button) {
  width: 86px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  font-size: 12px;
  color: rgb(var(--text-secondary-color, 102 102 102));
}
.group-foot :deep(.n-button__border),
.group-foot :deep(.n-button__state-border) {
  border: 1px dashed rgb(var(--base-text-color, 31 31 31) / 0.2);
  border-radius: 4px;
}
/* 每条 items 的外层包裹：条件行 + 其下方的参数类引用提示（若有），纵向紧凑排列。 */
.cond-item-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* 条件行：三件套一组（内 gap 8）与右端删除图标之间 gap 12。 */
.cond-item {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.cond-item-fields {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  flex-wrap: wrap;
  min-width: 0;
}
/* 嵌套的子组（递归渲染的 ConditionTree 根元素）落在 .cond-item 这个 flex 行里，默认按内容收缩，
   会把组内条件行的值框挤成一小截。显式让它吃满整行剩余宽度。 */
.cond-item > .cond-group {
  flex: 1 1 auto;
  min-width: 0;
}
/* 左右值框在行内平分剩余宽度。 */
.cond-item-fields :deep(.expr-input) {
  flex: 1 1 0;
  min-width: 0;
}
/* 删除条件：24px 报错色图标按钮。 */
.cond-remove {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgb(var(--error-color, 232 79 79));
  cursor: pointer;
}
.cond-remove:hover {
  background: rgb(var(--error-color, 232 79 79) / 0.1);
}
/* K9-d：参数类引用被动提示——小号灰字，跟随主题。 */
.param-hint {
  font-size: 12px;
  color: rgb(var(--text-hint-color, 153 153 153));
  line-height: 1.5;
  padding-left: 2px;
}
.op-sel {
  width: 80px;
  flex-shrink: 0;
}
/* E10：between/not_between 两个右值输入框中间的连接词（"和"），小号次要文字，视觉权重同 .group-head-word，
   不抢主体输入框的焦点。 */
.between-and-word {
  font-size: 14px;
  color: rgb(var(--text-secondary-color, 102 102 102));
  flex-shrink: 0;
}
</style>
