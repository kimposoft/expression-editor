/**
 *
 * 本文件端起真实的 CodeMirror 视图驱动：派发一次带 userEvent 的输入事务（等价于用户敲字），
 * 等补全异步算完，再派发真实 keydown 走 completionKeymap，断言文档与光标。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { EditorView } from '@codemirror/view';
import ExpressionSqlEditor from './ExpressionSqlEditor.vue';

const FUNCTIONS = [
  { snip: '合计()', label: '求和', detail: '对所选字段求和，忽略空值。' },
  { snip: '连接文本()', label: '字符串拼接', detail: '把多个值拼成一个字符串。' },
  { snip: '分支 当  则  否则  结束', label: '条件分支', detail: 'CASE WHEN 结构。' }
];

let wrapper: VueWrapper | null = null;

/** 引用候选：片段形态与 bracketText 口径一致，这里直接给定。 */
const REFERENCES = [
  { kind: 'source' as const, snip: '[入库流水].[物料编码]', label: '物料编码', detail: '来源 · 入库流水', table: '入库流水' },
  { kind: 'source' as const, snip: '[入库流水].[数量]', label: '数量', detail: '来源 · 入库流水', table: '入库流水' },
  { kind: 'report' as const, snip: '本报表.[采购明细].[数量]', label: '数量', detail: '本报表 · 采购明细', table: '采购明细' },
  { kind: 'var' as const, snip: '系统变量.当前时间', label: '当前时间', detail: '系统变量', table: '' }
];

/** 挂到 document 上：CodeMirror 的补全面板要量位置，脱离文档树时不会开。 */
function mountEditor(initial = '') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  wrapper = mount(ExpressionSqlEditor, {
    props: { modelValue: initial, functions: FUNCTIONS, references: REFERENCES },
    attachTo: host
  }) as unknown as VueWrapper;
  const view = EditorView.findFromDOM(wrapper.element as HTMLElement);
  if (!view) throw new Error('未拿到 EditorView');
  return view;
}

/** 模拟用户敲字：带 userEvent 的输入事务才会触发 activateOnTyping。 */
function typeText(view: EditorView, text: string) {
  const at = view.state.doc.length;
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' });
}

const settle = () => new Promise(r => setTimeout(r, 200));

function pressKey(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

beforeEach(() => { wrapper = null; });
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });

describe('ExpressionSqlEditor 函数补全落选', () => {
  it('🔴 打中文别名前缀 → 回车落选 → 片段插入且光标进括号内', async () => {
    const view = mountEditor();
    typeText(view, '合');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('合计()');
    // back=1：光标停在 `(` 与 `)` 之间，接着就能填参数。
    expect(view.state.selection.main.anchor).toBe('合计('.length);
  });

  it('🔴 打业务展示名前缀（求和）同样能落选，插入的仍是别名片段', async () => {
    const view = mountEditor();
    typeText(view, '求');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('合计()');
  });

  it('不以 "()" 结尾的关键字构造：光标停在片段末尾', async () => {
    const view = mountEditor();
    typeText(view, '分支');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('分支 当  则  否则  结束');
    expect(view.state.selection.main.anchor).toBe('分支 当  则  否则  结束'.length);
  });

  it('字符串字面量内部不弹补全——引号内是数据不是代码', async () => {
    const view = mountEditor();
    typeText(view, "'合");
    await settle();
    pressKey(view, 'Enter');
    // 没有候选可落 ⇒ 文本保持原样（Enter 由默认键位处理成换行，故只断言没被替换成函数片段）
    expect(view.state.doc.toString().startsWith("'合")).toBe(true);
    expect(view.state.doc.toString()).not.toContain('合计()');
  });

  it('无命中前缀不弹补全', async () => {
    const view = mountEditor();
    typeText(view, 'zzz');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).not.toContain('合计()');
  });
});

/** 模拟 closeBrackets 自动配对后的状态：文本 `[…]`、光标在 `[` 之后。 */
function typeOpenBracketAutoClosed(view: EditorView, prefix = '') {
  const at = view.state.doc.length;
  view.dispatch({
    changes: { from: at, insert: `${prefix}[]` },
    selection: { anchor: at + prefix.length + 1 },
    userEvent: 'input.type'
  });
}

describe('ExpressionSqlEditor 引用补全落选', () => {
  it('🔴 closeBrackets 已自动配对 `]` 时落选不留多余右括号', async () => {
    const view = mountEditor();
    typeOpenBracketAutoClosed(view);
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('[入库流水].[物料编码]');
    expect(view.state.selection.main.anchor).toBe('[入库流水].[物料编码]'.length);
  });

  it('🔴 `本报表.[` 自动配对后落选同样干净', async () => {
    const view = mountEditor();
    typeOpenBracketAutoClosed(view, '本报表.');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('本报表.[采购明细].[数量]');
  });

  it('🔴 `[入库流水].[` 自动配对后尾补字段同样干净', async () => {
    const view = mountEditor();
    typeOpenBracketAutoClosed(view, '[入库流水].');
    await settle();
    pressKey(view, 'ArrowDown');
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('[入库流水].[数量]');
  });

  it('🔴 打 `[` → 回车 → 整段插入第一条候选（完整片段，替换掉那个 `[`）', async () => {
    const view = mountEditor();
    typeText(view, '[');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('[入库流水].[物料编码]');
    expect(view.state.selection.main.anchor).toBe('[入库流水].[物料编码]'.length);
  });

  it('打中文字段名前缀（数量）→ 同时列出来源与本报表候选，回车落第一条', async () => {
    const view = mountEditor();
    typeText(view, '数量');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('[入库流水].[数量]');
  });

  it('`[入库流水].[` 尾补字段 → 只补该表字段，接在尾部', async () => {
    const view = mountEditor();
    typeText(view, '[入库流水].[');
    await settle();
    pressKey(view, 'ArrowDown'); // 第二条：数量
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('[入库流水].[数量]');
  });

  it('`本报表.[` → 只列本报表候选，落选后不会出现 本报表.本报表.[…]', async () => {
    const view = mountEditor();
    typeText(view, '本报表.[');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('本报表.[采购明细].[数量]');
  });

  it('系统变量按显示名命中，插入的是语言包点路径', async () => {
    const view = mountEditor();
    typeText(view, '当前');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('系统变量.当前时间');
  });

  it('函数与引用共存：打 `合` 只有函数命中，仍落 合计()', async () => {
    const view = mountEditor();
    typeText(view, '合');
    await settle();
    pressKey(view, 'Enter');
    expect(view.state.doc.toString()).toBe('合计()');
  });
});
