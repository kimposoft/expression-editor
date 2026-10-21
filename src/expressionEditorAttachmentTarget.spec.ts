import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

/**
 *
 * 挂载手法沿用 expressionEditorStrategyOptions.spec.ts：NSelect 用记录型桩（options/value 声明为 props），
 * 桩键用 naive-ui 组件内部注册名（Select/Button…，不带 N 前缀，原因见该文件注释）。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const TARGET_TABLE_ID = 'dt_target';

function field(fieldId: string, dataType: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: fieldId,
    field_name: fieldId,
    data_type: dataType,
    display_style: 'text',
    sort_no: 0,
    is_searchable: true,
    is_filterable: true,
    is_sortable: true,
    is_list_visible: true
  };
}

const HOST_TABLES: TemplateDataTable[] = [
  {
    data_table_id: TARGET_TABLE_ID,
    table_code: TARGET_TABLE_ID,
    table_name: TARGET_TABLE_ID,
    physical_table_name: TARGET_TABLE_ID,
    table_role: 'extension',
    sort_no: 1,
    field_count: 2,
    version_no: 1
  }
];
const HOST_FIELDS: TemplateField[] = [field('f_text', 'text'), field('f_pics', 'attachment')];

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => (dataTableId === TARGET_TABLE_ID ? HOST_FIELDS : []),
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** 明细目标，手动按行列匹配（auto_row_match=false，文本字段可选 row_match）；两字段都选了「合并」。 */
function modelWithMergeOutputs(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.targets = [
    {
      target_template_id: REPORT_TEMPLATE_ID,
      target_data_table_id: TARGET_TABLE_ID,
      target_table_role: 'detail',
      auto_row_match: false,
      outputs: [
        { target_field_id: 'f_text', expression: { kind: 'const', value: 'x' }, fill_strategy: 'merge', separator: ',' },
        { target_field_id: 'f_pics', expression: { kind: 'const', value: 'x' }, fill_strategy: 'merge' }
      ]
    }
  ];
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
const SelectRecorderStub = defineComponent({
  props: { options: { type: Array, default: () => [] }, value: { default: null } },
  emits: ['update:value'],
  setup() {
    return () => h('div', { class: 'select-recorder-stub' });
  }
});
const componentStubs: Record<string, Component> = {
  Select: SelectRecorderStub,
  Button: ButtonStub,
  Empty: SlotPassthrough,
  Spin: SlotPassthrough,
  Tag: SlotPassthrough,
  Tooltip: SlotPassthrough,
  Popover: SlotPassthrough,
  RadioGroup: SlotPassthrough,
  Radio: SlotPassthrough,
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function mountEditor(initial: ExpressionModel): Promise<{ wrapper: VueWrapper; editor: VueWrapper }> {
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      const current = ref<ExpressionModel>(JSON.parse(JSON.stringify(initial)));
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
  return { wrapper, editor: wrapper.findComponent(ExpressionEditor as any) };
}

function findSelect(editor: VueWrapper, testId: string): VueWrapper | undefined {
  const selects = editor.findAllComponents(SelectRecorderStub as any) as VueWrapper[];
  return selects.find(w => w.attributes('data-testid') === testId);
}

describe('图片 / 附件填充目标的填充方式与分隔符', () => {
  it('A：附件目标可选覆盖 / 合并，不提供按行列匹配；文本目标照旧提供', async () => {
    const { wrapper, editor } = await mountEditor(modelWithMergeOutputs());
    const pics = findSelect(editor, 'target-strategy-select-f_pics');
    const text = findSelect(editor, 'target-strategy-select-f_text');
    expect(pics).toBeTruthy();
    expect(text).toBeTruthy();
    const picsValues = (pics!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(picsValues).toContain('overwrite');
    expect(picsValues).toContain('merge');
    expect(picsValues).not.toContain('row_match');
    const textValues = (text!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(textValues).toContain('row_match');
    wrapper.unmount();
  });

  it('B：附件目标「合并」不显示分隔符下拉；文本目标「合并」显示', async () => {
    const { wrapper, editor } = await mountEditor(modelWithMergeOutputs());
    expect(findSelect(editor, 'target-separator-select-f_text')).toBeTruthy();
    expect(findSelect(editor, 'target-separator-select-f_pics')).toBeUndefined();
    wrapper.unmount();
  });
});
