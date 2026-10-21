import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

/**
 *
 * 按 SourceTreePicker 现有测试写法（quickFieldPickerFollowsPointer.spec.ts 的 QuickFieldPickerStub
 * 手法）——不渲染真实树、只捕获 props，断言编辑器传给它的能力面参数，而不深入 SourceTreePicker.vue
 * 内部渲染逻辑。
 */

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

/** 只捕获 props，不渲染任何内容——本文件只关心编辑器传给「添加来源」picker 的能力面参数。 */
const SourceTreePickerStub = defineComponent({
  name: 'SourceTreePickerStub',
  props: [
    'currentTemplateId',
    'tablesOf',
    'single',
    'triggerLabel',
    'disabled',
    'selectableKinds',
    'allowCrossApp',
    'stagingSource',
    'hasStagingSource',
    'disabledTableIds',
    'disabledTableTitle'
  ],
  emits: ['select'],
  setup() {
    return () => null;
  }
});

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
  SourceTreePicker: SourceTreePickerStub,
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

async function mountEditor(sourcePickerOptions?: { selectableKinds?: Array<'table' | 'view' | 'external'>; allowCrossApp?: boolean }): Promise<VueWrapper> {
  const current = ref<ExpressionModel>(emptyExpressionModel(TEMPLATE_ID));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: TEMPLATE_ID,
              sourcePickerOptions,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  return wrapper;
}

describe('①来源面板「＋添加」picker 的 selectableKinds 默认值收紧为仅 table', () => {
  it('不传 sourcePickerOptions：selectableKinds 默认 [\'table\']（不含 view）', async () => {
    const wrapper = await mountEditor(undefined);
    const picker = wrapper.findComponent(SourceTreePickerStub);
    expect(picker.exists()).toBe(true);
    expect(picker.props('selectableKinds')).toEqual(['table']);
    wrapper.unmount();
  });

  it("显式传 sourcePickerOptions.selectableKinds=['table','view']：原样透传，不受本次收紧影响", async () => {
    const wrapper = await mountEditor({ selectableKinds: ['table', 'view'] });
    const picker = wrapper.findComponent(SourceTreePickerStub);
    expect(picker.props('selectableKinds')).toEqual(['table', 'view']);
    wrapper.unmount();
  });
});
