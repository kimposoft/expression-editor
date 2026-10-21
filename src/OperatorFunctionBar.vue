<script setup lang="ts">
import { computed, inject } from 'vue';
import { NPopover } from 'naive-ui';
import { EXPRESSION_HOST, useT } from './host';
import { TEXT_KEYWORDS, textPackLangOf, useTextFunctionCatalog } from './functionCatalog';
import { isCompareOperatorAvailable } from './useExpressionContext';

/**
 * 运算符/函数快捷插入条，由结构化表达式编辑器的文本输入消费。
 *
 * 两行分组：运算符 / 函数，条目为主色文字链，横向流式排布，点击 emit('insert', text)
 * 由消费方（如 AdvancedExpressionPanel 的 ExpressionSqlEditor）插入到光标处。
 *
 * 条目权威：关键字仍取 functionCatalog.TEXT_KEYWORDS，
 * 本组件只负责挑选与排序，不新造符号。
 * 函数：默认目录抄自 functionCatalog（引导式表达式方言）；**本组件不感知任何具体方言**，消费方仍可按
 * 自己的结构化表达式场景传入 `functionItems` prop 整体替换。
 * 「更多」点击 emit('more')，由消费方决定展开策略；消费方提供 more 插槽时，本组件用不受父容器
 * 裁切的 NPopover 承载完整目录，未提供插槽的调用点保持既有 no-op 行为。
 */
const props = withDefaults(
  defineProps<{
    /** 显隐两个分组，默认全显。（合并前的 showArithmetic/showLogical 已随分组合并退役。） */
    showOperators?: boolean;
    showFunctions?: boolean;
    /** 可选：整体替换默认函数目录（不含「更多」项，「更多」恒追加在末尾）。 */
    functionItems?: { label: string; snip: string }[];
    /** 外部受控的「更多」浮层显隐；仅提供 more 插槽时消费，其他调用点保持原有 no-op 行为。 */
    moreOpen?: boolean;
  }>(),
  { showOperators: true, showFunctions: true, moreOpen: false }
);

const emit = defineEmits<{
  /** 点击运算符/函数条目：待插入文本（运算符含首尾空格，函数为完整片段如 "SUM()"）。 */
  insert: [text: string];
  /** 点击成对包裹条目（`()` / `''`）：左右符号。消费方有选区时包裹选区，无选区时插入一对并把光标落中间。 */
  wrap: [left: string, right: string];
  /** 点击「更多」：现有实现无此清单外函数的挂载点，交由消费方处理（如弹出完整函数目录）。 */
  more: [];
  /** NPopover 点击外部请求收起时，把显隐状态回传给消费方。 */
  'update:moreOpen': [show: boolean];
}>();

const t = useT();
const host = inject(EXPRESSION_HOST, null);
const textLang = computed(() => textPackLangOf(host?.locale?.()));

/** 运算符条目：符号类（直接插入 / 成对包裹）与关键字类（取 TEXT_KEYWORDS 的 symbol+label）两种。 */
type OperatorChip =
  /** 直接插入：` symbol ` 两侧留空格，与旧 insertOperator 拼法一致。 */
  | { kind: 'op'; key: string; symbol: string }
  /** 成对包裹：左右符号，不加空格（`(x + 1)` / `'abc'` 都不该被空格撑开）。 */
  | { kind: 'wrap'; key: string; left: string; right: string }
  /** 关键字：symbol 与展示名都按宿主语言包从 TEXT_KEYWORDS 取；capability 给出时按服务端能力位门控，
   *  省略则恒显示（并且 / 或者 是逻辑连接词，不属于 compare_operators 能力面，沿用合并前逻辑行的恒显示口径）。 */
  | { kind: 'keyword'; key: (typeof TEXT_KEYWORDS)[number]['key']; capability?: string };

/**
 * 合并后的运算符定稿清单：
 *   + - * / () '' < > = <> 包含 开头是 结尾是 为空 不为空 并且 或者
 *  
 * 符号类（+ - * / < > = <> 及两个包裹对）不做能力位门控，与合并前算术行的行为一致；
 * 谓词类关键字沿用合并前逻辑行的 fail-closed 门控——服务端 public_capabilities.compare_operators
 * 未下发对应能力位时整条不显示（like 缺省不下发，包含/开头是/结尾是 三条一并隐藏）；
 * 逻辑连接词 并且 / 或者 无能力位，恒显示。
 */
const OPERATOR_CHIPS: readonly OperatorChip[] = [
  { kind: 'op', key: 'plus', symbol: '+' },
  { kind: 'op', key: 'minus', symbol: '-' },
  { kind: 'op', key: 'times', symbol: '*' },
  { kind: 'op', key: 'divide', symbol: '/' },
  { kind: 'wrap', key: 'paren', left: '(', right: ')' },
  { kind: 'wrap', key: 'quote', left: "'", right: "'" },
  { kind: 'op', key: 'lt', symbol: '<' },
  { kind: 'op', key: 'gt', symbol: '>' },
  { kind: 'op', key: 'eq', symbol: '=' },
  { kind: 'op', key: 'ne', symbol: '<>' },
  { kind: 'keyword', key: 'contains', capability: 'like' },
  { kind: 'keyword', key: 'starts_with', capability: 'like' },
  { kind: 'keyword', key: 'ends_with', capability: 'like' },
  { kind: 'keyword', key: 'is_null', capability: 'is_null' },
  { kind: 'keyword', key: 'is_not_null', capability: 'is_not_null' },
  // 逻辑连接词放末尾：先写完两侧比较再连接，与 `A = 1 并且 B = 2` 的书写顺序一致。
  { kind: 'keyword', key: 'and' },
  { kind: 'keyword', key: 'or' }
];

/** 渲染条目：三种 chip 归一成同一形状（模板只认 key/label/kind 三个字段 + 点击载荷）。
 *  显式声明返回类型——union 数组过 flatMap 时 TS 推不出交集形状，模板里会退化成 unknown。 */
interface RenderedChip {
  kind: 'op' | 'wrap' | 'keyword';
  key: string;
  /** 展示文本：符号类即符号本身，包裹类为左右符号相连（`()` / `''`），关键字类取语言包展示名。 */
  label: string;
  /** 直接插入类的插入符号（包裹类为 undefined）。 */
  symbol?: string;
  left?: string;
  right?: string;
}
const operatorItems = computed<RenderedChip[]>(() =>
  OPERATOR_CHIPS.flatMap<RenderedChip>(chip => {
    if (chip.kind === 'keyword') {
      // 能力位 fail-closed：服务端没下发这一档比较运算符时整条不显示；无能力位的连接词（并且/或者）不门控。
      if (chip.capability && !isCompareOperatorAvailable(chip.capability)) return [];
      const kw = TEXT_KEYWORDS.find(k => k.key === chip.key);
      if (!kw) return [];
      return [{ kind: 'keyword', key: chip.key, label: t(kw.labelKey), symbol: kw.symbol[textLang.value] }];
    }
    if (chip.kind === 'wrap') {
      return [{ kind: 'wrap', key: chip.key, label: `${chip.left}${chip.right}`, left: chip.left, right: chip.right }];
    }
    return [{ kind: 'op', key: chip.key, label: chip.symbol, symbol: chip.symbol }];
  })
);

const textCatalog = useTextFunctionCatalog();
const defaultFunctions = computed(() => textCatalog.value.map(fn => ({ label: t(fn.labelKey), snip: fn.snip })));
/** 实际渲染目录：`functionItems` 传入则整体替换默认目录，否则回落 defaultFunctions（行为不变）。 */
const functions = computed(() => props.functionItems ?? defaultFunctions.value);

/** 点击运算符条目：符号/关键字类插入 ` symbol `（两侧留空格，与旧 insertOperator 拼法一致），
 *  成对包裹类改发 wrap，让消费方按当前选区决定是包裹还是插入一对。 */
function onOperatorChip(chip: RenderedChip) {
  if (chip.kind === 'wrap') emit('wrap', chip.left ?? '', chip.right ?? '');
  else emit('insert', ` ${chip.symbol} `);
}
function insertFunc(snip: string) {
  emit('insert', snip);
}
</script>

<template>
  <div class="op-fn-bar">
    <div v-if="props.showOperators" class="op-row">
      <span class="op-label">{{ t('operatorBar.operatorLabel') }}</span>
      <div class="op-items">
        <span
          v-for="chip in operatorItems"
          :key="chip.key"
          class="op-chip"
          :data-keyword="chip.key"
          @click="onOperatorChip(chip)"
          >{{ chip.label }}</span
        >
      </div>
    </div>
    <div v-if="props.showFunctions" class="op-row">
      <span class="op-label">{{ t('adv.functions') }}</span>
      <div class="op-items">
        <span v-for="fn in functions" :key="fn.snip" class="op-chip" @click="insertFunc(fn.snip)">{{ fn.label }}</span>
        <!-- 有 more 插槽时用 NPopover 承载完整目录（弹窗内会被 naive 传送进弹窗 body，不受编辑区 overflow
             裁切；外壳须 overflow:visible，见 ExpressionDialogShell）；未提供插槽的既有调用点仍只
             emit('more')，行为不变。向上展开：默认布局树坞占大头、函数条偏下，向下展开会伸出弹窗底边；
             上方空间不够时 NPopover 自行翻转到下方。 -->
        <NPopover
          v-if="$slots.more"
          :show="props.moreOpen"
          trigger="manual"
          placement="top-end"
          :show-arrow="false"
          raw
          @clickoutside="emit('update:moreOpen', false)"
        >
          <template #trigger>
            <span
              class="op-chip op-more"
              :aria-expanded="props.moreOpen"
              aria-haspopup="menu"
              @click="emit('more')"
            >
              {{ t('operatorBar.more') }}<span class="op-more-ico">ƒ</span>
            </span>
          </template>
          <slot name="more" />
        </NPopover>
        <span v-else class="op-chip op-more" @click="emit('more')">
          {{ t('operatorBar.more') }}<span class="op-more-ico">ƒ</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.op-fn-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.op-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
/* 分组小标签：次要文字色，固定列宽对齐三行（对齐 Figma 369:18577 三组标签同列）。 */
.op-label {
  flex: 0 0 auto;
  min-width: 70px;
  font-size: 14px;
  line-height: 22px;
  color: rgb(var(--text-secondary-color));
  white-space: nowrap;
}
.op-items {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1 1 auto;
}
/* 条目：主色文字链 + 浅主色底（与 Figma rgba(230,246,255,0.5) 逐像素等值，见 app-tree-menu.vue 同源用法）。 */
.op-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 20px;
  color: rgb(var(--primary-color));
  background: rgb(var(--primary-50-color) / 0.5);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: background-color 0.15s;
}
.op-chip:hover {
  background: rgb(var(--primary-50-color) / 0.85);
}
.op-more-ico {
  font-style: italic;
  font-weight: 600;
}
</style>
