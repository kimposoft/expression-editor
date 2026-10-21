import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import AdvancedExpressionPanel from './AdvancedExpressionPanel.vue';
import ConditionEditorDialog from './ConditionEditorDialog.vue';
import AdvancedExpressionDialog from './AdvancedExpressionDialog.vue';
import FieldTreeDock from './FieldTreeDock.vue';
import { provideExpressionHost, provideRefSyntax, type EditorPrefs, type ExpressionHost } from './host';
import zhCN from './locales/zh-CN';
import type { ConditionGroup, TemplateField } from './types';

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async () => [],
    listFields: async () => [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** 透传桩：保留 default/trigger 插槽，去掉 CodeMirror/函数横条等与本文件无关的重依赖。 */
const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
/** ExpressionSqlEditor 桩：面板打开后 nextTick 会调 taRef.focus()，桩要把这几个实例方法暴露出来。 */
const SqlEditorStub = defineComponent({
  props: ['modelValue'],
  inheritAttrs: false,
  setup(_props, { expose }) {
    expose({ focus() {}, focusRange() {}, insertAtCursor() {} });
    return () => h('div', { 'data-testid': 'sql-editor-stub' });
  }
});
const stubs: Record<string, Component> = {
  ExpressionSqlEditor: SqlEditorStub,
  OperatorFunctionBar: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 6; i += 1) await nextTick();
}

/** 让面板进入「输入中」态：经 ExpressionSqlEditor 桩回抛 v-model，面板的 text watch 把 syntaxState 置为 typing。 */
function typeInto(wrapper: VueWrapper, text: string): void {
  const editor = wrapper.findComponent(stubs.ExpressionSqlEditor as any);
  expect(editor.exists()).toBe(true);
  editor.vm.$emit('update:modelValue', text);
}

function mountPanel(
  placement?: 'inline' | 'external',
  opts: { shellHeight?: number; hidePersistentHints?: boolean; host?: ExpressionHost } = {}
): VueWrapper {
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(opts.host ?? makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(AdvancedExpressionPanel, {
              show: true,
              purpose: 'where',
              modelValue: null,
              sourceTables: [],
              formTables: [],
              shellHeight: opts.shellHeight ?? 660,
              hidePersistentHints: opts.hidePersistentHints,
              syntaxStatusPlacement: placement
            })
        });
    }
  });
  return mount(Harness, { attachTo: document.body, global: { stubs } });
}

/** 树坞当前渲染高度（.adv-dock 的 inline height）。 */
function dockPx(): number {
  const el = document.body.querySelector('.adv-dock') as HTMLElement | null;
  expect(el).not.toBeNull();
  return Number.parseFloat(el!.style.height);
}

// 宿主壳的窗口尺寸记忆走 localStorage，逐用例清空，避免用例间串味。
beforeEach(() => {
  localStorage.clear();
});

const EMPTY_GROUP: ConditionGroup = { logic: 'and', items: [] };

function mountDialog(): VueWrapper {
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ConditionEditorDialog, {
              show: true,
              mode: 'expr',
              group: EMPTY_GROUP,
              whereTextSource: null,
              sourceTables: [],
              formTables: []
            })
        });
    }
  });
  return mount(Harness, { attachTo: document.body, global: { stubs: { ...stubs, ConditionTree: SlotPassthrough } } });
}

describe('A. AdvancedExpressionPanel 语法状态条落位（syntaxStatusPlacement）', () => {
  it('缺省 inline：输入后状态条在面板内渲染（独立高级表达式弹窗零变化）', async () => {
    const wrapper = mountPanel();
    await flush();
    expect(wrapper.find('[data-testid="adv-syntax-status"]').exists()).toBe(false);
    typeInto(wrapper, '[序号] = 1');
    await flush();
    const status = wrapper.find('[data-testid="adv-syntax-status"]');
    expect(status.exists()).toBe(true);
    expect(status.classes()).toContain('adv-status--typing');
    expect(status.text()).toContain(zhCN['dialog.syntaxTyping']);
    wrapper.unmount();
  });

  it('external：面板自己不渲染状态条，三态/文案/定位经 expose 交给宿主壳', async () => {
    const wrapper = mountPanel('external');
    await flush();
    typeInto(wrapper, '[序号] = 1');
    await flush();
    expect(wrapper.find('[data-testid="adv-syntax-status"]').exists()).toBe(false);
    const panel = wrapper.findComponent(AdvancedExpressionPanel);
    const exposed = panel.vm as unknown as { syntaxState: string; syntaxLabel: string; syntaxDetail: string; focusIssue: () => void };
    expect(exposed.syntaxState).toBe('typing');
    expect(exposed.syntaxLabel).toBe(zhCN['dialog.syntaxTyping']);
    expect(typeof exposed.focusIssue).toBe('function');
    // 外置落位时编辑区补底边距的落位类。
    expect(wrapper.find('.adv-editor').classes()).toContain('adv-editor--status-external');
    wrapper.unmount();
  });
});

describe('B. ConditionEditorDialog：语法状态条并入页脚、与确定/取消同一行靠左', () => {
  it('输入后状态条出现在 .exd-footer 左槽，编辑区内没有', async () => {
    const wrapper = mountDialog();
    await flush();
    typeInto(wrapper, '[序号] = 1');
    await flush();
    // NModal 传送到 body：从 document 上找。
    // 页脚迁到 KDialogFooter：根上保留 .exd-footer 类，状态条在 extra 槽（.kdlf-extra），按钮在 .kdlf-actions。
    const footer = document.body.querySelector('.exd-footer');
    expect(footer).not.toBeNull();
    const inFooter = footer!.querySelector('.kdlf-extra .exd-footer-status [data-testid="adv-syntax-status"]');
    expect(inFooter).not.toBeNull();
    expect(inFooter!.className).toContain('adv-status--typing');
    expect(document.body.querySelector('.adv-editor [data-testid="adv-syntax-status"]')).toBeNull();
    // 按钮组仍在页脚右侧槽位。
    expect(footer!.querySelectorAll('.kdlf-actions [data-kdlf]').length).toBe(2);
    wrapper.unmount();
  });
});

describe('C. FieldTreeDock 本报表标识', () => {
  const fields: TemplateField[] = [{ field_id: 'f1', field_name: '序号', data_type: 'number' } as TemplateField];
  it('本报表上下文表（bt* / rpt-*）图标底片带 report 类与「本报表」title；显式来源表不带', () => {
    const wrapper = mount(FieldTreeDock, {
      props: {
        currentColumn: {
          header: '采购入库',
          tables: [
            { alias: 'bt0', label: '采购入库', fields },
            { alias: 'rpt-tbl_ext-abc123', label: '采购入库的扩展表', fields }
          ]
        },
        sourceColumns: [{ header: '采购入库', tables: [{ alias: 't1', label: '采购入库的扩展表', fields }] }]
      }
    });
    const chips = wrapper.findAll('.ftd-tbl-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].classes()).toContain('ftd-tbl-chip--report');
    expect(chips[0].attributes('title')).toBe(zhCN['drawer.tabForm']);
    expect(chips[1].classes()).toContain('ftd-tbl-chip--report');
    expect(chips[2].classes()).not.toContain('ftd-tbl-chip--report');
    expect(chips[2].attributes('title')).toBeUndefined();
    wrapper.unmount();
  });
});

describe('D/E. 紧凑布局分栏默认值 + 分隔条起拖不跳变', () => {
  it('D：默认 660 高、紧凑布局 → 可用 544，编辑区 210，树坞 334', async () => {
    const wrapper = mountPanel('external', { hidePersistentHints: true });
    await flush();
    expect(dockPx()).toBe(334);
    wrapper.unmount();
  });

  it('E：宿主壳 900 高时起拖第一帧树坞不变，随后逐帧跟手', async () => {
    const wrapper = mountPanel('external', { hidePersistentHints: true, shellHeight: 900 });
    await flush();
    // 可用 900−116=784（KDialog 页脚 53 + 标题栏 53 + 分隔条 10），紧凑默认编辑区 210 → 树坞 574。
    const before = dockPx();
    expect(before).toBe(574);
    const split = wrapper.find('.adv-split');
    await split.trigger('pointerdown', { clientY: 300 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 300 }));
    await flush();
    expect(dockPx()).toBe(before);
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 260 }));
    await flush();
    expect(dockPx()).toBe(before - 40);
    window.dispatchEvent(new MouseEvent('pointerup'));
    await flush();
    expect(dockPx()).toBe(before - 40);
    wrapper.unmount();
  });

  it('E2：分栏不做记忆——存量 advanced.splitRatio 不影响初值，拖拽结束也不落盘', async () => {
    // 旧版本落盘过的比例（类型字段已退役，故经 unknown 断言模拟 localStorage 里的存量值）。
    const stale = { advanced: { width: 830, height: 660, splitRatio: 0.3 } } as unknown as EditorPrefs;
    const saveEditorPrefs = vi.fn();
    const host: ExpressionHost = { ...makeHost(), loadEditorPrefs: () => stale, saveEditorPrefs };
    const wrapper = mountPanel('external', { hidePersistentHints: true, host });
    await flush();
    // 与用例 D 同：660 高 → 可用 544，编辑区最小 210，树坞 334；0.3 若仍生效会得到 163。
    expect(dockPx()).toBe(334);
    const split = wrapper.find('.adv-split');
    await split.trigger('pointerdown', { clientY: 300 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 260 }));
    await flush();
    window.dispatchEvent(new MouseEvent('pointerup'));
    await flush();
    expect(dockPx()).toBe(294);
    expect(saveEditorPrefs).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('F. AdvancedExpressionDialog 与筛选条件弹窗共用一套壳', () => {
  it('根 testid 仍为 advanced-expression-dialog；面板按紧凑外观挂载；状态条落在页脚左槽；页脚按钮改用 data-kdlf', async () => {
    const Harness = defineComponent({
      setup() {
        provideExpressionHost(makeHost());
        provideRefSyntax('brackets');
        return () =>
          h(NMessageProvider, null, {
            default: () => h(AdvancedExpressionDialog, { show: true, modelValue: null, sourceTables: [], formTables: [] })
          });
      }
    });
    const wrapper = mount(Harness, { attachTo: document.body, global: { stubs } });
    await flush();
    const shell = document.body.querySelector('[data-testid="advanced-expression-dialog"]');
    expect(shell).not.toBeNull();
    expect(shell!.classList.contains('exd-shell')).toBe(true);
    expect(document.body.querySelector('[data-testid="condition-editor-dialog"]')).toBeNull();
    const panel = wrapper.findComponent(AdvancedExpressionPanel);
    expect(panel.props('purpose')).toBe('value');
    expect(panel.props('hidePersistentHints')).toBe(true);
    expect(panel.props('compactFunctionBar')).toBe(true);
    expect(panel.props('syntaxStatusPlacement')).toBe('external');
    typeInto(wrapper, '1 + 2');
    await flush();
    expect(shell!.querySelector('.exd-footer-status [data-testid="adv-syntax-status"]')).not.toBeNull();
    expect(shell!.querySelector('.adv-editor [data-testid="adv-syntax-status"]')).toBeNull();
    // 页脚按钮 / 最大化按钮 testid 随 KDialog / KDialogFooter 迁移退役，改认 data-kdlf 与 KDialog 窗控。
    expect(shell!.querySelector('[data-kdlf="cancel"]')).not.toBeNull();
    expect(shell!.querySelector('[data-kdlf="confirm"]')).not.toBeNull();
    expect(shell!.querySelector('.kdlg-controls .kdlg-btn:not(.kdlg-btn--close)')).not.toBeNull();
    wrapper.unmount();
  });
});

describe('低高度表达式布局', () => {
  it('实际内容高度优先于旧shellHeight，左右/上下切换保留文本与dirty', async () => {
    let height = 320;
    let width = 720;
    const callbacks: Array<() => void> = [];
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return this.classList.contains('adv-panel') ? height : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return this.classList.contains('adv-panel') ? width : 0; });
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe() {} disconnect() {} unobserve() {}
    });
    const wrapper = mountPanel('external', { shellHeight: 1200, hidePersistentHints: true });
    try {
      await flush();
      const panel = wrapper.findComponent(AdvancedExpressionPanel);
      const editor = wrapper.findComponent(stubs.ExpressionSqlEditor as any);
      const uid = editor.vm.$.uid;
      expect(wrapper.find('.adv-panel').attributes('data-layout')).toBe('side');
      expect(wrapper.find('.adv-split').attributes('aria-orientation')).toBe('vertical');
      typeInto(wrapper, '12 + 34');
      await flush();
      expect((panel.vm as any).dirty).toBe(true);
      const oldWidth = wrapper.find('.adv-dock').attributes('style');
      await wrapper.find('.adv-split').trigger('pointerdown', { clientX: 250, clientY: 10 });
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 290, clientY: 10 }));
      window.dispatchEvent(new PointerEvent('pointerup'));
      await nextTick();
      expect(wrapper.find('.adv-dock').attributes('style')).not.toBe(oldWidth);
      height = 700; width = 960; callbacks.forEach(callback => callback());
      await nextTick();
      expect(wrapper.find('.adv-panel').attributes('data-layout')).toBe('stacked');
      expect(wrapper.find('.adv-split').attributes('aria-orientation')).toBe('horizontal');
      expect(editor.vm.$.uid).toBe(uid);
      expect((panel.vm as any).dirty).toBe(true);
      expect(editor.props('modelValue')).toBe('12 + 34');
    } finally { wrapper.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
});
