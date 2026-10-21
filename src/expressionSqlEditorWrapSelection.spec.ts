/**
 * ExpressionSqlEditor.wrapSelection：运算符条 `()` / `''` 的落点判据。
 *
 * 「点了以后光标/选区在哪」是这个交互的一半——有选区却把选中内容顶掉，等于快捷插入变成了误删，
 * 所以这里端起真实 CodeMirror 视图断言文档 + 选区，而不是只测事件有没有发出去。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { EditorView } from '@codemirror/view';
import ExpressionSqlEditor from './ExpressionSqlEditor.vue';

let wrapper: VueWrapper | null = null;

/** 挂到 document 上：与补全用例同口径（CodeMirror 脱离文档树时行为不完整）。 */
function mountEditor(initial: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  wrapper = mount(ExpressionSqlEditor, { props: { modelValue: initial }, attachTo: host }) as unknown as VueWrapper;
  const view = EditorView.findFromDOM(wrapper.element as HTMLElement);
  if (!view) throw new Error('未拿到 EditorView');
  return { view, vm: wrapper.vm as unknown as { wrapSelection(l: string, r: string): void } };
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('ExpressionSqlEditor.wrapSelection', () => {
  it('有选区：左右各插一个符号，选中内容仍保持选中', () => {
    const { view, vm } = mountEditor('单价 * 数量');
    view.dispatch({ selection: { anchor: 0, head: 7 } }); // 选中「单价 * 数量」全段
    vm.wrapSelection('(', ')');
    expect(view.state.doc.toString()).toBe('(单价 * 数量)');
    // 选区仍圈着原内容（整体右移一个左括号），这正是「再点一次套第二层」的前提。
    const sel = view.state.selection.main;
    expect([sel.from, sel.to]).toEqual([1, 8]);
  });

  /* 连点套第二层单独起一个视图断言：happy-dom 会在 dispatch 改完 DOM 的同步阶段补发
     selectionchange，同一个视图上紧挨着连发两次事务会撞 CodeMirror 的「更新进行中」断言
     （环境时序问题，真实浏览器里两次点击天然跨帧）。这里直接从上一用例的产物状态起手。 */
  it('从已包一层的选区状态再点一次，套上第二层', () => {
    const { view, vm } = mountEditor('(单价 * 数量)');
    view.dispatch({ selection: { anchor: 1, head: 8 } });
    vm.wrapSelection('(', ')');
    expect(view.state.doc.toString()).toBe('((单价 * 数量))');
    expect(view.state.selection.main.from).toBe(2);
  });

  it('有选区：单引号同样包在两侧，不是把选中内容替换掉', () => {
    const { view, vm } = mountEditor('待入库');
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    vm.wrapSelection("'", "'");
    expect(view.state.doc.toString()).toBe("'待入库'");
  });

  it('无选区：插入一对符号并把光标落到中间', () => {
    const { view, vm } = mountEditor('状态 = ');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    vm.wrapSelection("'", "'");
    expect(view.state.doc.toString()).toBe("状态 = ''");
    expect(view.state.selection.main.head).toBe(view.state.doc.length - 1);
  });
});
