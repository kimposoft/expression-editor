import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';


const TEMPLATE_ID = 'tpl_report';

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

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: SlotPassthrough,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  NRadioGroup: SlotPassthrough,
  NRadio: SlotPassthrough,
  NSwitch: SlotPassthrough,
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(slotContent?: string): Promise<VueWrapper> {
  const current = ref<ExpressionModel>(emptyExpressionModel(TEMPLATE_ID));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(
              ExpressionEditor,
              {
                modelValue: current.value,
                templateId: TEMPLATE_ID,
                'onUpdate:modelValue': (value: ExpressionModel) => {
                  current.value = value;
                }
              },
              slotContent ? { 'left-top': () => h('div', { innerHTML: slotContent }) } : undefined
            )
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  return wrapper;
}

describe('左栏顶部插槽 left-top', () => {
  it('A：未传插槽 —— 不渲染 .qb-left-top-slot 容器', async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-testid="qb-left-top-slot"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('B：传了插槽 —— 容器渲染在①来源面板（qb-source-panel）之前，插槽内容原样透出', async () => {
    const wrapper = await mountEditor('<span data-testid="lts-content">自定义数据源区</span>');
    const slotEl = wrapper.find('[data-testid="qb-left-top-slot"]');
    expect(slotEl.exists()).toBe(true);
    expect(slotEl.find('[data-testid="lts-content"]').text()).toBe('自定义数据源区');

    // DOM 顺序钉死：left-top 容器须是 .qb-left 的直接子元素，且排在来源面板之前。
    const qbLeft = wrapper.find('[data-testid="qb-left"]').element;
    const children = Array.from(qbLeft.children);
    const slotIndex = children.findIndex(el => el.getAttribute('data-testid') === 'qb-left-top-slot');
    const sourceIndex = children.findIndex(el => el.getAttribute('data-testid') === 'qb-source-panel');
    expect(slotIndex).toBeGreaterThanOrEqual(0);
    expect(sourceIndex).toBeGreaterThan(slotIndex);
    wrapper.unmount();
  });
});
