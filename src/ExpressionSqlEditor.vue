<script setup lang="ts">
/**
 * ExpressionSqlEditor —— 表达式编辑区（CodeMirror 6），替代原生 textarea。
 *
 * 提供三样 textarea 给不了的能力：
 *   ① **按类型着色**：字段引用 / 系统变量 / 函数 / 字符串 / 数字 / 关键字 各一色；
 *   ② **错误波浪线**：服务端诊断的 rune 区间直接画在出错那一段下面，不用再靠"选中即高亮"；
 *   ③ **函数补全**：打字时按函数目录提示，Enter/Tab 落选，光标自动落进括号内。
 *
 * ── 保持与 textarea 完全等价的既有能力（不得降级）────────────────────────────
 *   - v-model 双向绑定、disabled、placeholder；
 *   - `insertAtCursor(snippet, back)`：光标处插入 + 回退（字段树点选、运算符/函数条都靠它）；
 *   - `wrapSelection(left, right)`：用一对符号包裹选区（运算符条 `()` / `''`，无选区时退化成插一对）；
 *   - `focusRange(from, to)`：按 UTF-16 区间选中并滚动到可见（原 focusIssue 的落点）。
 *
 * ── 为什么着色不走 Lezer 语法 ─────────────────────────────────────────────
 * 见 ./kimpoSqlHighlight.ts 文件头：完整文法要在前端复刻一份 KimpoSQL，与服务端长期同步是
 * 漂移源；着色只需要词法，而词法边界规则简单且稳定。类型细分（字段/变量）靠服务端 refs 做
 * 尽力匹配，匹配不上退回通用色——宁可少上色，不猜。
 */
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { autocompletion, closeBrackets, type Completion, type CompletionContext, type CompletionResult, acceptCompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { buildRefKindMap, scanKimpoSql } from './kimpoSqlHighlight';
// 表主题色全局类（.ttc-N 提供 --ttc）：表段装饰按类取色，这里显式引入保证样式随本组件到场。
import './table-theme-colors.css';
import { tokenBoundaryAfter, tokenBoundaryBefore } from './tokenDelete';
import { COMPLETION_IDENT, insideStringLiteral, matchFunctionCandidates } from './kimpoSqlCompletion';
import { matchReferenceCandidates, referenceCompletionContext, type ReferenceCandidate } from './kimpoSqlRefCompletion';

interface FunctionItem {
  /** 插入片段，如 `SUM()`；以 "()" 结尾时光标自动落进括号内。 */
  snip: string;
  /** 展示名（补全列表左侧）。 */
  label: string;
  /** 说明（补全列表右侧，可空）。 */
  detail?: string;
}

/** 显式组件名：测试按名查找（包 exports 不开放深层路径导入，见 cmEditorHelpers.ts）。 */
defineOptions({ name: 'ExpressionSqlEditor' });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    placeholder?: string;
    /** 服务端 tokenize 产出的 refs，用于把 `[…]` 细分成字段/变量两色。 */
    refs?: Array<{ kind?: string; last_label?: string; label?: string }>;
    /** 服务端诊断：rune 区间已由调用方换算成 UTF-16 下标（见 textSource.runeToUtf16Index）。 */
    errorRanges?: Array<{ from: number; to: number; message?: string }>;
    /** 函数目录，用于补全。 */
    functions?: FunctionItem[];
    /** 引用候选（字段 / 本报表 / 系统变量），由调用方按 bracketText 口径产出（见 kimpoSqlRefCompletion.ts）。 */
    references?: ReferenceCandidate[];
    /** 表显示名（文本里 `[表]` 的写法，含同表多实例 (N) 后缀）→ 表主题色类 ttc-N；未命中的表段落中性灰实底。 */
    tableClasses?: Map<string, string>;
  }>(),
  { disabled: false, placeholder: '', refs: () => [], errorRanges: () => [], functions: () => [], references: () => [], tableClasses: () => new Map() }
);
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const hostRef = ref<HTMLDivElement | null>(null);
const viewRef = shallowRef<EditorView | null>(null);
/** 只读态要能动态切换，而 readOnly/editable 是 facet——必须经 Compartment 重配置，不能只派空事务。 */
const editableCompartment = new Compartment();
/**
 * 装饰同理需要 Compartment。
 * 🔴 装饰有**两个**变化来源：文档（用户打字，着色要跟上）与 props（refs/errorRanges 换了新的
 * 服务端结果）。前者由 compute(['doc']) 覆盖；后者不改文档，compute 根本不会重跑——必须
 * reconfigure 一个捕获了新 props 的扩展进去。只派空事务是无效的（曾如此写过，装饰不更新）。
 */
const decoCompartment = new Compartment();

// ── 装饰：着色 + 波浪线 ───────────────────────────────────────────────────────
const TOKEN_MARK: Record<string, Decoration> = {
  ref: Decoration.mark({ class: 'cm-kq-ref' }),
  'ref-source': Decoration.mark({ class: 'cm-kq-ref cm-kq-ref-source' }),
  'ref-var': Decoration.mark({ class: 'cm-kq-ref cm-kq-ref-var' }),
  string: Decoration.mark({ class: 'cm-kq-string' }),
  number: Decoration.mark({ class: 'cm-kq-number' }),
  func: Decoration.mark({ class: 'cm-kq-func' }),
  keyword: Decoration.mark({ class: 'cm-kq-keyword' })
};
const ERROR_MARK = Decoration.mark({ class: 'cm-kq-error' });
/** 整条引用的外层装饰（方案 A 淡底胶囊：--ttc 12% 淡底 + 表色文字），按色类缓存 Decoration.mark 实例。 */
const refWrapCache = new Map<string, Decoration>();
function refWrapMark(cls: string): Decoration {
  let deco = refWrapCache.get(cls);
  if (!deco) {
    deco = Decoration.mark({ class: cls ? `cm-kq-refwrap ${cls}` : 'cm-kq-refwrap' });
    refWrapCache.set(cls, deco);
  }
  return deco;
}
/** 引用内部件：表名加粗 / 括号点号前缀压暗。 */
const REF_TABLE_NAME = Decoration.mark({ class: 'cm-kq-refname' });
const REF_PUNC = Decoration.mark({ class: 'cm-kq-refpunc' });
const FIELD_KINDS = new Set(['ref', 'ref-source', 'ref-var', 'ref-report']);

/** 装饰扩展：闭包捕获当前 props，文档变化时按 compute 重算；props 变化由调用方 reconfigure。 */
function decorationPlugin(): Extension {
  return EditorView.decorations.compute(['doc'], state => {
    const text = state.doc.toString();
    const kinds = buildRefKindMap(props.refs);
    const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
    const toks = scanKimpoSql(text, kinds);
    for (let i = 0; i < toks.length; i += 1) {
      const tok = toks[i];
      if (tok.kind === 'ref-table') {
        // 整条引用 `[表].[字段]`（含 `本报表.` 前缀）一层淡底装饰：本报表 → 独立蓝 .ttc-report；显式来源 → 按表显示名
        // 查主题色类；查不到 → 无色类（中性灰淡底）。内层：表名加粗，前缀 / 括号 / 点号压暗；字段段跟整条同色，不再另上类型色。
        // 暂存表（tok.staging）同款独立蓝——不能按 tok.table（此时是列名）去 tableClasses 查，那张表是
        // 按「来源显示名」建索引的，列名撞不上、也不该撞上（见 kimpoSqlHighlight.HighlightToken.staging 注释）。
        const field = toks[i + 1];
        const hasField = !!field && field.from >= tok.to && FIELD_KINDS.has(field.kind);
        const end = hasField ? field.to : tok.to;
        const cls = tok.report || tok.staging ? 'ttc-report' : (props.tableClasses.get((tok.table ?? '').trim()) ?? '');
        ranges.push({ from: tok.from, to: end, deco: refWrapMark(cls) });
        const seg = text.slice(tok.from, tok.to);
        const lb = seg.indexOf('[');
        if (lb > 0) ranges.push({ from: tok.from, to: tok.from + lb, deco: REF_PUNC });
        ranges.push({ from: tok.from + lb, to: tok.from + lb + 1, deco: REF_PUNC });
        if (tok.to - 1 > tok.from + lb + 1) ranges.push({ from: tok.from + lb + 1, to: tok.to - 1, deco: REF_TABLE_NAME });
        ranges.push({ from: tok.to - 1, to: tok.to, deco: REF_PUNC });
        if (hasField) {
          if (field.from > tok.to) ranges.push({ from: tok.to, to: field.from, deco: REF_PUNC });
          ranges.push({ from: field.from, to: field.from + 1, deco: REF_PUNC });
          ranges.push({ from: field.to - 1, to: field.to, deco: REF_PUNC });
          i += 1;
        }
        continue;
      }
      const deco = TOKEN_MARK[tok.kind];
      if (deco) ranges.push({ from: tok.from, to: tok.to, deco });
    }
    for (const err of props.errorRanges) {
      const from = Math.max(0, Math.min(err.from, text.length));
      const to = Math.max(from, Math.min(err.to, text.length));
      if (to > from) ranges.push({ from, to, deco: ERROR_MARK });
    }
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(ranges.map(r => r.deco.range(r.from, r.to)), true);
  });
}

// ── 补全：函数 + 引用（字段 / 本报表 / 系统变量）────────────────────────────────
/**
 * 一个 override 源同时产两路候选：
 *   函数：只在「正在打一个标识符」时提示（取词字符集、别名/展示名双向匹配见 ./kimpoSqlCompletion.ts）；
 *   引用：`[xx` / 标识符前缀 / `[表].[xx` / `本报表.[表].[xx` 四种形态（判定与筛选见 ./kimpoSqlRefCompletion.ts）。
 * 两路都不在字符串字面量里提示——引号内是数据不是代码。
 *
 * 🔴 `filter: false` 不可省：候选可能靠**别名 / 表名 / 子串**命中，而 CodeMirror 默认会再拿 label 前缀滤
 * 一遍——留着默认过滤等于把这些项重新滤掉。
 * 🔴 两路候选的替换起点可能不同（函数从标识符起点、引用从 `[` 或 `本报表` 起点），故每个 option 自带
 * from，apply 里不用 CodeMirror 传入的 from；结果的 from 只取最小值供面板定位。
 * 落选后函数片段以 "()" 结尾时光标回退 1 落进括号内，与 insertAtCursor 的既有体验一致。
 */
function kimpoCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.state.doc.sliceString(0, context.pos);
  const options: Completion[] = [];
  let resultFrom = context.pos;

  const word = context.matchBefore(COMPLETION_IDENT);
  if (word && (word.from < word.to || context.explicit) && !insideStringLiteral(before.slice(0, word.from))) {
    const typed = context.state.doc.sliceString(word.from, word.to);
    for (const c of matchFunctionCandidates(typed, props.functions)) {
      resultFrom = Math.min(resultFrom, word.from);
      options.push({
        label: c.label,
        detail: c.detail,
        info: c.info,
        type: 'function',
        apply: (view: EditorView, _c: unknown, _from: number, to: number) => {
          view.dispatch({
            changes: { from: word.from, to, insert: c.snip },
            selection: { anchor: word.from + c.snip.length - c.back }
          });
        }
      });
    }
  }

  const refCtx = referenceCompletionContext(before, context.explicit);
  if (refCtx) {
    for (const o of matchReferenceCandidates(refCtx, props.references)) {
      resultFrom = Math.min(resultFrom, o.from);
      options.push({
        label: o.candidate.label,
        detail: o.candidate.detail,
        type: o.candidate.kind === 'var' ? 'variable' : 'property',
        apply: (view: EditorView, _c: unknown, _from: number, to: number) => {
          const end = o.insert.endsWith(']') && view.state.doc.sliceString(to, to + 1) === ']' ? to + 1 : to;
          view.dispatch({
            changes: { from: o.from, to: end, insert: o.insert },
            selection: { anchor: o.from + o.insert.length }
          });
        }
      });
    }
  }

  if (!options.length) return null;
  return { from: resultFrom, filter: false, options };
}

/** 退格/删除整段字段标记（边界判定见 ./tokenDelete.ts）。 */
const tokenDeleteKeymap = keymap.of([
  {
    key: 'Backspace',
    run: view => {
      const sel = view.state.selection.main;
      if (!sel.empty) return false;
      const from = tokenBoundaryBefore(view.state.doc.toString(), sel.from);
      if (from === null) return false;
      view.dispatch({ changes: { from, to: sel.from, insert: '' }, selection: { anchor: from } });
      return true;
    }
  },
  {
    key: 'Delete',
    run: view => {
      const sel = view.state.selection.main;
      if (!sel.empty) return false;
      const to = tokenBoundaryAfter(view.state.doc.toString(), sel.from);
      if (to === null) return false;
      view.dispatch({ changes: { from: sel.from, to, insert: '' }, selection: { anchor: sel.from } });
      return true;
    }
  }
]);

// ── 主题 ─────────────────────────────────────────────────────────────────────
const theme = EditorView.theme({
  '&': { fontSize: '13px', border: '1px solid var(--kq-border, #d9d9d9)', borderRadius: '3px', flex: '1 1 auto', minHeight: '0' },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--kq-border-focus, #4098fc)' },
  '.cm-content': { fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace", padding: '8px 10px', minHeight: '96px' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.6' },
  '.cm-kq-ref': { color: '#0958d9' },
  '.cm-kq-ref-source': { color: '#0958d9' },
  '.cm-kq-ref-var': { color: '#7719aa' },
  // 整条引用（方案 A 淡底胶囊）：--ttc 12% 淡底 + 表色文字（来自全局 .ttc-N / .ttc-report；未命中中性灰淡底、文字随正文）。
  '.cm-kq-refwrap': {
    backgroundColor: 'rgb(var(--ttc, 148 163 184) / 12%)',
    color: 'var(--ttc-text, inherit)',
    borderRadius: '4px',
    padding: '1px 4px'
  },
  '.cm-kq-refname': { fontWeight: '600' },
  '.cm-kq-refpunc': { opacity: '0.45' },
  '.cm-kq-string': { color: '#0b7285' },
  '.cm-kq-number': { color: '#b5761f' },
  '.cm-kq-func': { color: '#8f3f00', fontWeight: '600' },
  '.cm-kq-keyword': { color: '#5b21b6', fontWeight: '600' },
  // 波浪线：不改前景色，只在下方画一条红色波浪，避免和类型着色抢颜色语义。
  '.cm-kq-error': {
    textDecoration: 'underline wavy #d03050',
    textUnderlineOffset: '3px'
  }
});

onMounted(() => {
  if (!hostRef.value) return;
  const view = new EditorView({
    parent: hostRef.value,
    state: EditorState.create({
      doc: props.modelValue ?? '',
      extensions: [
        history(),
        tokenDeleteKeymap,
        // Tab 落选当前高亮候选（2026-09-07 用户回看）；补全面板没开时 acceptCompletion 返回 false，Tab 照旧交给默认键位。
        keymap.of([{ key: 'Tab', run: acceptCompletion }]),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        closeBrackets(),
        autocompletion({ override: [kimpoCompletions], activateOnTyping: true }),
        decoCompartment.of(decorationPlugin()),
        EditorView.lineWrapping,
        cmPlaceholder(props.placeholder ?? ''),
        editableCompartment.of([EditorState.readOnly.of(!!props.disabled), EditorView.editable.of(!props.disabled)]),
        theme,
        EditorView.updateListener.of(u => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
        })
      ]
    })
  });
  viewRef.value = view;
});

onBeforeUnmount(() => {
  viewRef.value?.destroy();
  viewRef.value = null;
});

// 外部改 modelValue（如打开时装载、清空按钮）时同步进编辑器——只在真的不同才派发，
// 否则会和 updateListener 形成回环。
watch(
  () => props.modelValue,
  next => {
    const view = viewRef.value;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (next === cur) return;
    view.dispatch({ changes: { from: 0, to: cur.length, insert: next ?? '' } });
  }
);

// refs / errorRanges 变了要重画装饰：reconfigure 一个捕获了新 props 的扩展（见 decoCompartment 注释）。
watch(
  () => [props.refs, props.errorRanges, props.tableClasses] as const,
  () => {
    const view = viewRef.value;
    if (view) view.dispatch({ effects: decoCompartment.reconfigure(decorationPlugin()) });
  },
  { deep: true }
);

watch(
  () => props.disabled,
  next => {
    const view = viewRef.value;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure([EditorState.readOnly.of(!!next), EditorView.editable.of(!next)])
    });
  }
);

defineExpose({
  /** 光标处插入片段；back>0 时光标从片段末尾回退该字符数（如 `SUM()` 回退 1 落进括号）。 */
  insertAtCursor(snippet: string, back = 0) {
    const view = viewRef.value;
    if (!view) return;
    const sel = view.state.selection.main;
    const pos = sel.from + snippet.length - back;
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: snippet }, selection: { anchor: pos } });
    view.focus();
  },
  /**
   * 用一对符号包裹当前选区（运算符条的 `()` / `''` 快捷插入专用）。
   * 有选区：`左符号 + 选中内容 + 右符号`，插入后选中内容仍保持选中（整体右移一个左符号的长度），
   *         用户可以连着再点一次套第二层，这是「快速添加」的关键体验。
   * 无选区：等价于插入 `左右符号` 并把光标落到两者中间（与 insertAtCursor("()", 1) 同效）。
   */
  wrapSelection(left: string, right: string) {
    const view = viewRef.value;
    if (!view) return;
    const sel = view.state.selection.main;
    const inner = view.state.sliceDoc(sel.from, sel.to);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${left}${inner}${right}` },
      selection: inner
        ? { anchor: sel.from + left.length, head: sel.from + left.length + inner.length }
        : { anchor: sel.from + left.length }
    });
    view.focus();
  },
  /** 选中一段并滚动到可见（原 textarea focusIssue 的落点）。 */
  focusRange(from: number, to: number) {
    const view = viewRef.value;
    if (!view) return;
    const len = view.state.doc.length;
    const a = Math.max(0, Math.min(from, len));
    const b = Math.max(a, Math.min(to, len));
    view.focus();
    view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
  },
  focus() {
    viewRef.value?.focus();
  },
  /** 当前选区（UTF-16 下标）。供「定位出错片段」这类行为被断言——原 textarea 版靠
   *  selectionStart/End 读，换成 CodeMirror 后选区不在 DOM 属性上，需要这个查询口。 */
  getSelection(): { from: number; to: number } {
    const sel = viewRef.value?.state.selection.main;
    return { from: sel?.from ?? 0, to: sel?.to ?? 0 };
  }
});
</script>

<template>
  <div ref="hostRef" class="kq-editor" data-testid="adv-expression-textarea" />
</template>

<style scoped>
/* 宿主：作为编辑区（AdvancedExpressionPanel .adv-editor 纵向 flex 列）的弹性项吃掉剩余高度，
   自身再作纵向 flex 列把高度传给 CodeMirror 的 .cm-editor（见 theme '&' 的 flex:1 1 auto）。 */
.kq-editor {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  min-height: 0;
}
</style>
