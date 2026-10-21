import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField, type ValueRef } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

/**
 *
 * 本文件钉：A 五种静态形态的 .filled 有无（已配文本 / V4 往返空文本 / 占位 const / 主动填 null / 主动填 ''）；
 * B 真点 ✕ 后本行 .filled 消失且行仍在（填充方式等行内配置不丢）。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const DT_DETAIL = 'dt_detail';
const F_SET = 'f_set';
const F_V4_EMPTY = 'f_v4_empty';
const F_PLACEHOLDER = 'f_placeholder';
const F_NULL = 'f_null';
const F_EMPTY_STR = 'f_empty_str';

function field(fieldId: string): TemplateField {
  return {
    field_id: fieldId, field_code: fieldId, field_name: fieldId, data_type: 'text', display_style: 'text',
    sort_no: 0, is_searchable: true, is_filterable: true, is_sortable: true, is_list_visible: true
  };
}
const HOST_TABLES: TemplateDataTable[] = [
  { data_table_id: DT_DETAIL, table_code: DT_DETAIL, table_name: '采购明细', physical_table_name: DT_DETAIL, table_role: 'extension', sort_no: 0, field_count: 5, version_no: 1 }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [DT_DETAIL]: [F_SET, F_V4_EMPTY, F_PLACEHOLDER, F_NULL, F_EMPTY_STR].map(field)
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** V4 壳里已配表达式的形态：raw 本体 + text_source 原文。 */
function v4Text(text: string): ValueRef {
  return { kind: 'raw', text, text_source: { text, pack_revision: 'v4', digest: 'v4' } };
}

function modelWithOutputs(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: DT_DETAIL,
    target_table_role: 'detail',
    outputs: [
      { target_field_id: F_SET, expression: v4Text('[采购入库的扩展表].[数量]'), fill_strategy: 'overwrite' },
      { target_field_id: F_V4_EMPTY, expression: v4Text(''), fill_strategy: 'overwrite' },
      { target_field_id: F_PLACEHOLDER, expression: { kind: 'const' }, fill_strategy: 'row_match' },
      { target_field_id: F_NULL, expression: { kind: 'const', value: null }, fill_strategy: 'overwrite' },
      { target_field_id: F_EMPTY_STR, expression: { kind: 'const', value: '' }, fill_strategy: 'overwrite' }
    ]
  };
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
/** NButton 桩成原生 button 并透传 attrs：✕ 的 @click.stop 与 data-testid 都落在 button 上，能真点。 */
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
/** ExpressionInput 不桩（B 要真点它的 ✕）；其它重组件照旧透传。 */
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough, NButton: ButtonStub, NEmpty: SlotPassthrough, NSpin: SlotPassthrough, NTag: SlotPassthrough,
  NTooltip: SlotPassthrough, NPopover: SlotPassthrough, NRadioGroup: SlotPassthrough, NRadio: SlotPassthrough,
  SourceTreePicker: SlotPassthrough, JoinSettingsPanel: SlotPassthrough, ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough, ChartTargetSection: SlotPassthrough, StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough, QuickFieldPicker: SlotPassthrough, AdvancedExpressionDialog: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(initial: ExpressionModel): Promise<{ wrapper: VueWrapper; current: { value: ExpressionModel } }> {
  const current = ref<ExpressionModel>(JSON.parse(JSON.stringify(initial)));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
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
  await flushMounted();
  return { wrapper, current };
}

function row(wrapper: VueWrapper, fieldId: string) {
  const r = wrapper.find(`[data-testid="expression-target-row-${fieldId}"]`);
  expect(r.exists(), `target row ${fieldId} should render`).toBe(true);
  return r;
}

describe('目标字段行 .filled 只认「表达式已配置」', () => {
  it('A：已配文本 / 主动填 null / 主动填 \'\' 三行 .filled；V4 往返空文本与占位 const 两行不 .filled', async () => {
    const { wrapper } = await mountEditor(modelWithOutputs());
    expect(row(wrapper, F_SET).classes()).toContain('filled');
    expect(row(wrapper, F_NULL).classes()).toContain('filled');
    expect(row(wrapper, F_EMPTY_STR).classes()).toContain('filled');
    expect(row(wrapper, F_V4_EMPTY).classes()).not.toContain('filled');
    expect(row(wrapper, F_PLACEHOLDER).classes()).not.toContain('filled');
    wrapper.unmount();
  });

  it('B：点已配行的 ✕ → 本行 .filled 消失、行内配置（填充方式）仍在、其它行不受影响', async () => {
    const { wrapper, current } = await mountEditor(modelWithOutputs());
    const setRow = row(wrapper, F_SET);
    const clearBtn = setRow.find('[data-testid="expr-clear"]');
    expect(clearBtn.exists()).toBe(true);
    await clearBtn.trigger('click');
    await flushMounted();
    expect(row(wrapper, F_SET).classes()).not.toContain('filled');
    expect(row(wrapper, F_SET).classes()).not.toContain('row-active');
    // 模型里该行仍在（承载填充方式等），表达式落回「不填充」占位
    const out = current.value.target!.outputs.find(o => o.target_field_id === F_SET)!;
    expect(out).toBeDefined();
    expect(out.expression).toEqual({ kind: 'const' });
    expect(out.fill_strategy).toBe('overwrite');
    expect(row(wrapper, F_NULL).classes()).toContain('filled');
    wrapper.unmount();
  });
});
