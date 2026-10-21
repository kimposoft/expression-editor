<script setup lang="ts">
import { computed } from 'vue';
import type { TemplateField, ValueRef, ValueRefKind } from './types';
import { isNullConstRef } from './types';
import { systemVariablesCatalog, type TableFields } from './useExpressionContext';
import { relabelText, labelOfRef } from './rawSerialize';
import { restoreTextFromSource } from './textSource';
import { splitLabeledTextSegments, tokenTableClassFor, type LabeledTextSeg } from './tableThemeColors';
import { useT } from './host';
// token 语义色板（全包唯一定义处；非 scoped，故只需任一消费方引入一次即全局生效）。此前由
// ExpressionInput.vue 引入，随本次抽取一并搬到真正消费 .tok 类的这里。
import './token-colors.css';

/**
 * 表达式胶囊渲染：把一个 ValueRef
 * 拍平为带配色的 token 片段并渲染。原为 ExpressionInput.vue 内联实现（点值区展示），现抽成独立组件，
 * 使值区展示与「单行省略 + 悬浮完整表达式浮层」等新场景（视图列一行一值）可以复用同一份拍平/着色逻辑，
 * 不必另起一套。ExpressionInput.vue 改为挂载本组件，默认（mode='wrap'）渲染输出（DOM 结构与类名）
 * 与抽取前逐字节一致。
 *
 * props 与 ExpressionInput 的值模型同形（modelValue/sourceTables/formTables 三者签名照抄，供两处
 * 共用同一份 flatten 逻辑）。
 */
const props = withDefaults(
  defineProps<{
    modelValue: ValueRef | null;
    sourceTables: { alias: string; dataTableId: string; name: string; fields: TemplateField[] }[];
    formTables: (TableFields & { alias?: string })[];
    /** 'wrap'（默认）：裸片段（无包裹元素），与抽取前 ExpressionInput.vue 内联渲染逐字节一致——
     *  片段是否换行完全由外层容器的 flex-wrap 决定（如 .expr-input 本身）。
     *  'single'：包一层 span.expr-tokens-single（inline-flex + 不换行），供单行值框
     *  （ExpressionInput singleLine）与悬浮浮层等"需要一个可测量/可裁切的根元素"的场景使用。 */
    mode?: 'wrap' | 'single';
  }>(),
  { mode: 'wrap' }
);

const t = useT();

/** ValueRef 的简短显示名（window 排序字段等用）——原样照抄自 ExpressionInput.vue。 */
function refShort(v: ValueRef): string {
  if (v.kind === 'source_field' || v.kind === 'form_field') return labelOfRef(v, props.sourceTables, props.formTables as any);
  if (v.kind === 'system_var') return `@${varLabel(v.var_id)}`;
  // 空值常量与「尚未填值」的默认空串区分展示，否则用户分不清"选了空值"与"还没填任何东西"。
  if (v.kind === 'const') return isNullConstRef(v) ? t('common.nullValue') : String(v.value ?? '');
  if (v.kind === 'window') return `${(v.win_fn ?? 'win').toUpperCase()}()`;
  if (v.kind === 'case') return 'CASE';
  if (v.kind === 'func') return `${v.name}()`;
  return '?';
}

/** 系统变量友好名（取响应式目录 label，未加载/未命中回落 var_id，首帧不显示裸 ID）。 */
function varLabel(varId?: string): string {
  return systemVariablesCatalog.value.find(v => v.var_id === varId)?.label ?? varId ?? '';
}

/** 把 ValueRef 拍平为带配色的文本片段。字段统一 {数据表.字段名}（不暴露别名 t1/t2）。
 *  tableClass（2026-09-02 表主题色草案）：来源表字段附 ttc 色类，token 按所属表着色（朴素 tint），
 *  空串走 token-colors.css 既有语义色。 */
interface Seg {
  text: string;
  kind: ValueRefKind | 'punc' | LabeledTextSeg['kind'];
  tableClass?: string;
  /** brackets 整条引用的部件（表名加粗 / 标点压暗），见 tableThemeColors.LabeledTextSegPart。 */
  parts?: LabeledTextSeg['parts'];
}
function flatten(r: ValueRef): Seg[] {
  if (r.text_source) {
    const txt = restoreTextFromSource(r.text_source, props.sourceTables, props.formTables as any, systemVariablesCatalog.value).trim();
    return txt ? splitLabeledTextSegments(txt, props.sourceTables, props.formTables as any, systemVariablesCatalog.value) : [];
  }
  switch (r.kind) {
    case 'source_field': {
      const label = labelOfRef(r, props.sourceTables, props.formTables as any);
      return [
        {
          text: `{${label}}`,
          kind: r.alias?.startsWith('bt') ? 'form_field' : 'source_field',
          tableClass: tokenTableClassFor(r.alias, props.sourceTables)
        }
      ];
    }
    case 'form_field':
      return [{ text: `{${labelOfRef(r, props.sourceTables, props.formTables as any)}}`, kind: 'form_field' }];
    case 'system_var':
      return [{ text: `@${varLabel(r.var_id)}`, kind: 'system_var' }];
    case 'const':
      // 空值常量（value===null）与默认空串同理区分展示（见 refShort 同一处说明）。
      return [{ text: isNullConstRef(r) ? t('common.nullValue') : `${r.value ?? ''}`, kind: 'const' }];
    case 'func': {
      const segs: Seg[] = [{ text: `${r.name}(`, kind: 'func' }];
      (r.args ?? []).forEach((a, i) => {
        if (i > 0) segs.push({ text: ', ', kind: 'punc' });
        segs.push(...flatten(a));
      });
      segs.push({ text: ')', kind: 'func' });
      return segs;
    }
    case 'raw': {
      // 自由表达式：{…} 标记按当前字段名实时重标（rename 同步）；表主题色草案起按标记切段逐 token
      // 着色（同 text_source 分支口径）。空文本→无 token（显占位）。
      const txt = relabelText(r.text ?? '', r.refs ?? [], props.sourceTables, props.formTables as any).trim();
      return txt ? splitLabeledTextSegments(txt, props.sourceTables, props.formTables as any, systemVariablesCatalog.value) : [];
    }
    case 'window': {
      const ob = (r.win_order_by ?? []).map(o => refShort(o.value)).join(', ');
      return [{ text: `${(r.win_fn ?? 'win').toUpperCase()}()${ob ? ` /${ob}` : ''}`, kind: 'window' }];
    }
    case 'case':
      return [{ text: `CASE…(${(r.cases ?? []).length}分支)`, kind: 'case' }];
    default:
      return [{ text: '?', kind: 'punc' }];
  }
}
const segments = computed<Seg[]>(() => (props.modelValue ? flatten(props.modelValue) : []));
</script>

<template>
  <!-- mode='single'：包一层可测量/可裁切的 span 根元素（inline-flex、不换行，样式见下）；
       mode='wrap'（默认）：与抽取前逐字节一致的裸片段，不产生任何包裹元素——两分支各自独立
       重复同一段 token 渲染标记（而非用一个共享的动态包裹元素），因为 Vue 的
       `<component :is="Fragment">` 在这里不会渲染任何内容（已验证），保留裸片段分支是唯一能
       保证「默认渲染输出零变化」的写法。 -->
  <span v-if="mode === 'single'" class="expr-tokens-single">
    <template v-if="segments.length">
      <span v-for="(s, i) in segments" :key="i" class="tok" :class="[`tok-${s.kind}`, s.tableClass || null]">
        <template v-if="s.parts">
          <span v-for="(part, j) in s.parts" :key="j" :class="`tok-part-${part.role}`">{{ part.text }}</span>
        </template>
        <template v-else>{{ s.text }}</template>
      </span>
    </template>
    <span v-else class="expr-empty-dash" aria-hidden="true"></span>
  </span>
  <template v-else>
    <template v-if="segments.length">
      <span v-for="(s, i) in segments" :key="i" class="tok" :class="[`tok-${s.kind}`, s.tableClass || null]">
        <template v-if="s.parts">
          <span v-for="(part, j) in s.parts" :key="j" :class="`tok-part-${part.role}`">{{ part.text }}</span>
        </template>
        <template v-else>{{ s.text }}</template>
      </span>
    </template>
    <span v-else class="expr-empty-dash" aria-hidden="true"></span>
  </template>
</template>

<style scoped>
/* mode='single' 专用根：inline-flex + 不换行，供 ExpressionInput singleLine 值框裁切测量、
   悬浮浮层等场景包一层可控根元素；gap 4 与 .expr-input 原有 flex gap 对齐，视觉不因多包一层而变化。 */
.expr-tokens-single {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.expr-empty-dash {
  width: 12px;
  height: 2px;
  flex-shrink: 0;
  margin-left: 4px;
  background: rgb(var(--border-deep-color, 205 208 214));
}
</style>
