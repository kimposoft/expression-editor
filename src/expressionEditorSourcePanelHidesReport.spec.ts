/**
 * ② 来源表面板不展示「本报表」各表：
 * 面板只列用户添加的显式来源；纯展示层改动——引用本报表字段时模型照旧登记 report 上下文来源
 *，只是这些来源不在面板里渲染。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TEMPLATE_ID = 'tpl_material';
const DT_PO_MAIN = 'dt_po_main';
const DT_PO_DETAIL = 'dt_po_detail';
const DT_MATERIAL = 'dt_material';

function field(fieldId: string, name: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: fieldId,
    field_name: name,
    data_type: 'text',
    display_style: 'text',
    sort_no: 0,
    is_searchable: true,
    is_filterable: true,
    is_sortable: true,
    is_list_visible: true
  };
}

const HOST_TABLES: TemplateDataTable[] = [
  { data_table_id: DT_PO_MAIN, table_code: DT_PO_MAIN, table_name: '采购入库', physical_table_name: DT_PO_MAIN, table_role: 'main', sort_no: 0, field_count: 1, version_no: 1 },
  { data_table_id: DT_PO_DETAIL, table_code: DT_PO_DETAIL, table_name: '采购入库的扩展表', physical_table_name: DT_PO_DETAIL, table_role: 'extension', sort_no: 1, field_count: 1, version_no: 1 }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [DT_PO_MAIN]: [field('f_no', '单号')],
  [DT_PO_DETAIL]: [field('f_material', '物料编码')],
  [DT_MATERIAL]: [field('f_name', '物料名称')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({ purpose: req.purpose, text_source: { text: req.text, pack_revision: 'test', digest: 'd' }, diagnostics: [] })
  } as unknown as ExpressionHost;
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

async function mountEditor(initial: ExpressionModel, extraProps: Record<string, unknown> = {}): Promise<VueWrapper> {
  const current = ref<ExpressionModel>(initial);
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
              },
              ...extraProps
            })
        });
    }
  });
  const wrapper = mount(Harness, { global: { stubs: componentStubs } });
  await flushMounted();
  return wrapper;
}

function sourceRows(wrapper: VueWrapper) {
  return wrapper.findAll('[data-testid="qb-source-panel"] .qb-src-row');
}

describe('② 来源表面板：不展示本报表各表', () => {
  it('无显式来源：面板不列本报表任何表，只保留空态提示', async () => {
    const wrapper = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID));
    expect(sourceRows(wrapper)).toHaveLength(0);
    expect(wrapper.find('[data-source-kind="report"]').exists()).toBe(false);
    expect(wrapper.find('.qb-src-empty-hint').text()).toBe('点右上「添加来源」选择其它数据表');
  });

  it('有显式来源：面板只列显式来源（保留删除按钮），空态提示消失', async () => {
    const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
    m.source.tables = [{ alias: 't1', source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: DT_MATERIAL, is_context: false }];
    const wrapper = await mountEditor(m);
    const rows = sourceRows(wrapper);
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes('data-source-alias')).toBe('t1');
    expect(rows[0].find('.qb-src-remove').exists()).toBe(true);
    expect(wrapper.find('.qb-src-empty-hint').exists()).toBe(false);
  });

  it('模型里的本报表上下文来源（is_context 的 bt* 别名）也不在面板渲染', async () => {
    const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
    m.source.tables = [
      { alias: 'bt0', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: DT_PO_MAIN, is_context: true },
      { alias: 't1', source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: DT_MATERIAL, is_context: false }
    ];
    const wrapper = await mountEditor(m);
    const rows = sourceRows(wrapper);
    expect(rows.map(r => r.attributes('data-source-alias'))).toEqual(['t1']);
    expect(wrapper.find('[data-source-alias="bt0"]').exists()).toBe(false);
  });
});
