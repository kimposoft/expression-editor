<script setup lang="ts">
import type { ConditionGroup, CompareOp, ValueRef, TemplateField } from './types';
import { isBetweenOp, isNullCompareOp, isNullConstRef } from './types';
import { useT } from './host';
import { labelOfRef } from './rawSerialize';
import { restoreTextFromSource } from './textSource';
import { systemVariablesCatalog } from './useExpressionContext';
import type { TableFields } from './useExpressionContext';

/**
 * 条件树只读渲染（数据流左右分栏改版，②筛选条件面板 qb-condition-view 内嵌）：按嵌套缩进渲染
 * ConditionGroup 全文，token 着色复用 token-colors.css；纯展示、零编辑交互——编辑走
 * ConditionEditorDialog 内嵌的可编辑 ConditionTree（数据形状与 ConditionTree.vue 保持一致，
 * 只是本组件不产出任何 update 事件）。
 *
 * 递归自引用：与 ConditionTree.vue 同一惯例（<script setup> SFC 可按文件名隐式自引用，见其
 * defineOptions 用法），子组渲染直接复用 `<ConditionReadonlyView>` 标签。
 */
defineOptions({ name: 'ConditionReadonlyView' });

const props = defineProps<{
  group: ConditionGroup;
  sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[] }[];
  formTables: (TableFields & { alias?: string })[];
  depth?: number;
}>();

const t = useT();

/** 比较符的只读展示文案：符号类直接写死（与 ConditionTree.vue opOptions 同一套符号），
 *  文字类（形如/属于/不属于/为空/不为空）复用既有 cond.* key。 */
function opText(op: CompareOp): string {
  switch (op) {
    case 'eq':
      return '=';
    case 'neq':
      return '≠';
    case 'lt':
      return '<';
    case 'lte':
      return '≤';
    case 'gt':
      return '>';
    case 'gte':
      return '≥';
    // E10：区间比较算子对只读文案，与 ConditionTree.vue opOptions 同一对 key。
    case 'between':
      return t('cond.opBetween');
    case 'not_between':
      return t('cond.opNotBetween');
    case 'like':
      return t('cond.opLike');
    case 'in':
      return t('cond.opIn');
    case 'not_in':
      return t('cond.opNotIn');
    case 'is_null':
      return t('cond.opIsNull');
    case 'is_not_null':
      return t('cond.opIsNotNull');
    default:
      return op;
  }
}

/** 值引用的只读展示片段（口径照抄 ExpressionInput.vue 的 flatten，但只取本组件需要的粗粒度展示，
 *  不需要那边的开窗/CASE 细节递归——判断条件里出现这类复合值本就少见，退化成简短占位即可）。 */
function refDisplay(v?: ValueRef): { text: string; kind: string } {
  if (!v) return { text: '', kind: 'const' };
  if (v.text_source) {
    return { text: restoreTextFromSource(v.text_source, props.sourceTables, props.formTables as any, systemVariablesCatalog.value), kind: 'raw' };
  }
  switch (v.kind) {
    case 'source_field':
    case 'form_field':
      return {
        text: labelOfRef(v, props.sourceTables, props.formTables as any) || '?',
        kind: v.kind === 'source_field' && v.alias?.startsWith('bt') ? 'form_field' : v.kind === 'source_field' ? 'source_field' : 'form_field'
      };
    case 'system_var':
      return { text: `@${systemVariablesCatalog.value.find(s => s.var_id === v.var_id)?.label ?? v.var_id ?? ''}`, kind: 'system_var' };
    case 'const':
      // 空值常量（value===null）与默认空串同理区分展示（口径照抄 ExpressionInput.vue 的 flatten）。
      return { text: isNullConstRef(v) ? t('common.nullValue') : String(v.value ?? ''), kind: 'const' };
    case 'raw':
      return { text: v.text ?? '', kind: 'raw' };
    case 'func':
      return { text: `${v.name}(…)`, kind: 'func' };
    case 'window':
      return { text: `${(v.win_fn ?? 'win').toUpperCase()}()`, kind: 'window' };
    case 'case':
      return { text: 'CASE…', kind: 'case' };
    default:
      return { text: '?', kind: 'const' };
  }
}

/**
 *
 *  注：qb.conditionGroupAll/Any 由此不再被本组件引用，但保留不删——四语言 key 集合测试敏感
 *  （expression-i18n.test.ts），且未来若要恢复"不含 negate 的一体化短句"仍可复用，标记 deprecated。 */
function groupLabel(g: ConditionGroup): string {
  const satisfyWord = g.negate ? t('cond.groupNotSatisfy') : t('cond.groupSatisfy');
  const logicWord = g.logic === 'and' ? t('cond.groupAll') : t('cond.groupAny');
  return `${satisfyWord}${t('cond.groupPrefix')}${logicWord}${t('cond.groupSuffix')}：`;
}
</script>

<template>
  <div class="qcr-group" :class="{ nested: (depth ?? 0) > 0, negated: group.negate }">
    <div class="qcr-group-head">
      <span class="qcr-group-label">{{ groupLabel(group) }}</span>
    </div>
    <div v-if="group.items.length === 0" class="qcr-empty">{{ t('cond.emptyGroup') }}</div>
    <div v-for="(it, idx) in group.items" :key="idx" class="qcr-item">
      <span v-if="idx > 0" class="qcr-logic-word">{{ group.logic === 'or' ? t('cond.or') : t('cond.and') }}</span>
      <template v-if="it.predicate">
        <span class="tok" :class="`tok-${refDisplay(it.predicate.left).kind}`">{{ refDisplay(it.predicate.left).text }}</span>
        <span class="qcr-op">{{ opText(it.predicate.op) }}</span>
        <span
          v-if="!isNullCompareOp(it.predicate.op)"
          class="tok"
          :class="`tok-${refDisplay(it.predicate.right).kind}`"
        >{{ refDisplay(it.predicate.right).text }}</span>
        <!-- E10：between/not_between 额外展示"和 + 第二右值"（「介于 a 和 b」/「不介于 a 和 b」），
             与可编辑态 ConditionTree.vue 的 between-and-word 视觉口径一致。 -->
        <template v-if="isBetweenOp(it.predicate.op)">
          <span class="qcr-op">{{ t('cond.betweenAnd') }}</span>
          <span class="tok" :class="`tok-${refDisplay(it.predicate.right2).kind}`">{{ refDisplay(it.predicate.right2).text }}</span>
        </template>
      </template>
      <ConditionReadonlyView
        v-else-if="it.group"
        :group="it.group"
        :source-tables="sourceTables"
        :form-tables="formTables"
        :depth="(depth ?? 0) + 1"
      />
    </div>
  </div>
</template>

<style scoped>
.qcr-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* 嵌套子组：缩进 + 左侧竖线，呼应可编辑态 ConditionTree.vue 的虚线描边分组视觉。 */
.qcr-group.nested {
  padding: 6px 0 6px 12px;
  border-left: 2px dashed rgb(var(--border-color));
}
/* 取反组：左侧橙色 2px 色条，替代原「外挂徽标」——negate 语义已并入组头一体化文案（见 groupLabel），
 * 色条是唯一剩余的视觉标记；声明须晚于 .nested 以在「既嵌套又取反」时覆盖其灰色边框，与可编辑态
 * ConditionTree.vue 的 .cond-group.negated 同一视觉口径（该组件注释里提到的"与只读区对齐"，此处补齐
 * 只读区这一半，二者互为镜像）。 */
.qcr-group.negated {
  padding-left: 12px;
  border-left: 2px solid rgb(var(--warning-color));
}
.qcr-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qcr-group-label {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--text-secondary-color));
}
.qcr-empty {
  padding-left: 4px;
  font-size: 12px;
  color: rgb(var(--text-hint-color));
}
.qcr-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-left: 4px;
}
.qcr-logic-word {
  font-size: 12px;
  color: rgb(var(--text-hint-color));
}
.qcr-op {
  font-size: 12.5px;
  font-weight: 600;
  color: rgb(var(--text-secondary-color));
}
</style>
