import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 *
 * 挂载与 NSelect 记录型桩的写法沿用 expressionEditorStrategyOptions.spec.ts（桩键名须是 naive 组件内部名
 * `Select`，不是 `NSelect`）。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const DT_DETAIL = 'dt_detail';
const DT_MAIN = 'dt_main';

function field(fieldId: string): TemplateField {
  return {
    field_id: fieldId, field_code: fieldId, field_name: fieldId, data_type: 'text', display_style: 'text',
    sort_no: 0, is_searchable: true, is_filterable: true, is_sortable: true, is_list_visible: true
  };
}
function table(dataTableId: string, role: 'main' | 'extension', sortNo: number): TemplateDataTable {
  return {
    data_table_id: dataTableId, table_code: dataTableId, table_name: dataTableId, physical_table_name: dataTableId,
    table_role: role, sort_no: sortNo, field_count: 2, version_no: 1
  };
}
const HOST_TABLES: TemplateDataTable[] = [table(DT_MAIN, 'main', 0), table(DT_DETAIL, 'extension', 1)];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [DT_MAIN]: [field('m_plain')],
  [DT_DETAIL]: [field('f_plain'), field('f_matched')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_variables: [] } as any),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** 一个目标：f_plain 无输出行（缺省 overwrite），f_matched 存量 row_match（模拟抽键产出 / 历史手动配置）。 */
function modelWith(tableId: string, role: 'main' | 'detail', autoRowMatch?: boolean): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.targets = [
    {
      target_template_id: REPORT_TEMPLATE_ID,
      target_data_table_id: tableId,
      target_table_role: role,
      auto_row_match: autoRowMatch,
      outputs: role === 'detail'
        ? [{ target_field_id: 'f_matched', expression: { kind: 'raw', text: '[x]', text_source: { text: '[x]', pack_revision: 'v4', digest: 'v4' } }, fill_strategy: 'row_match' }]
        : []
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
  Select: SelectRecorderStub, Button: ButtonStub, Empty: SlotPassthrough, Spin: SlotPassthrough, Tag: SlotPassthrough,
  Tooltip: SlotPassthrough, Popover: SlotPassthrough, RadioGroup: SlotPassthrough, Radio: SlotPassthrough,
  SourceTreePicker: SlotPassthrough, JoinSettingsPanel: SlotPassthrough, ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough, ExpressionInput: SlotPassthrough, ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough, FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(syntax: RefSyntax, initial: ExpressionModel): Promise<{ wrapper: VueWrapper; editor: VueWrapper }> {
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax(syntax);
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
  await flushMounted();
  return { wrapper, editor: wrapper.findComponent(ExpressionEditor as any) };
}

function strategyValues(editor: VueWrapper, fieldId: string): string[] {
  const selects = editor.findAllComponents(SelectRecorderStub as any) as VueWrapper[];
  const select = selects.find(w => w.attributes('data-testid') === `target-strategy-select-${fieldId}`);
  expect(select, `strategy select for ${fieldId} should render`).toBeTruthy();
  return (select!.props('options') as Array<{ value: string }>).map(o => o.value);
}

describe('「自动按行列匹配」开着时填充方式不提供手动「按行列匹配」', () => {
  it('V4（brackets）缺省开关即开：普通行不出现 row_match；存量 row_match 行保留当前值可见', async () => {
    const { wrapper, editor } = await mountEditor('brackets', modelWith(DT_DETAIL, 'detail', undefined));
    expect(strategyValues(editor, 'f_plain')).not.toContain('row_match');
    expect(strategyValues(editor, 'f_matched')).toContain('row_match');
    wrapper.unmount();
  });

  it('V4 开关显式 true：同缺省——普通行不出现', async () => {
    const { wrapper, editor } = await mountEditor('brackets', modelWith(DT_DETAIL, 'detail', true));
    expect(strategyValues(editor, 'f_plain')).not.toContain('row_match');
    wrapper.unmount();
  });

  it('V4 开关关闭（false）：普通行出现 row_match，可手动选', async () => {
    const { wrapper, editor } = await mountEditor('brackets', modelWith(DT_DETAIL, 'detail', false));
    expect(strategyValues(editor, 'f_plain')).toContain('row_match');
    expect(strategyValues(editor, 'f_matched')).toContain('row_match');
    wrapper.unmount();
  });

  it('主表目标：无论开关，恒不出现', async () => {
    const { wrapper, editor } = await mountEditor('brackets', modelWith(DT_MAIN, 'main', false));
    expect(strategyValues(editor, 'm_plain')).not.toContain('row_match');
    wrapper.unmount();
  });

  it('3.4（braces）口径不变：缺省关 ⇒ 出现；开 ⇒ 普通行不出现', async () => {
    const off = await mountEditor('braces', modelWith(DT_DETAIL, 'detail', undefined));
    expect(strategyValues(off.editor, 'f_plain')).toContain('row_match');
    off.wrapper.unmount();
    const on = await mountEditor('braces', modelWith(DT_DETAIL, 'detail', true));
    expect(strategyValues(on.editor, 'f_plain')).not.toContain('row_match');
    on.wrapper.unmount();
  });
});
