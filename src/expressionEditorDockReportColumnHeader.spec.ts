import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, type Component, type PropType } from 'vue';
import { mount } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import type { DockColumnsBundle } from './dockColumns';

/**
 * 树坞列头：来源表恰为本模板时，不再出现两个「收取发票（本模板）」（2026-10-19 用户反馈）。
 *
 * 列①是本报表（当前单据自身取值，引用前缀 本报表.），列②是显式来源（本模板全部记录）。此前两列都走
 * templateLabel() 挂「（本模板）」后缀而同名；改为列①挂「（本报表）」，列②保持「（本模板）」。
 */

const TPL = 'tpl_invoice';
const MAIN = 'dt_invoice_main';

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
const MAIN_TABLE: TemplateDataTable = {
  data_table_id: MAIN,
  table_code: MAIN,
  table_name: '收取发票的主表',
  physical_table_name: MAIN,
  table_role: 'main',
  sort_no: 0,
  field_count: 1,
  version_no: 1
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [{ template_id: TPL, template_name: '收取发票' } as any],
    listTables: async templateId => (templateId === TPL ? [MAIN_TABLE] : []),
    listFields: async () => [field('f_no', '登记编号')],
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
/** 捕获 dockColumns 透传值的桩（ExpressionInput / ConditionEditorDialog 共用）。 */
const captured: DockColumnsBundle[] = [];
const DockCapture = defineComponent({
  inheritAttrs: false,
  props: { dockColumns: { type: Object as PropType<DockColumnsBundle>, default: undefined } },
  setup(props) {
    return () => {
      if (props.dockColumns) captured.push(props.dockColumns);
      return h('div');
    };
  }
});
const stubs: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  JoinDesignerDialog: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  ExpressionInput: DockCapture,
  ConditionEditorDialog: DockCapture
};

async function mountWith(templateId: string): Promise<DockColumnsBundle> {
  captured.length = 0;
  const model: ExpressionModel = emptyExpressionModel();
  // 显式来源 = 本模板主表（取本模板全部记录）
  model.source.tables = [
    { alias: 't1', source_type: 'template', template_id: TPL, data_table_id: MAIN, is_context: false, role: 'main' }
  ];
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () => h(NMessageProvider, null, { default: () => h(ExpressionEditor, { modelValue: model, templateId }) });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs } });
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
  const last = captured.at(-1);
  wrapper.unmount();
  expect(last).toBeDefined();
  return last!;
}

describe('ExpressionEditor 树坞列头：本报表列与本模板来源列不同名', () => {
  it('来源表为本模板：列①「收取发票（本报表）」，列②「收取发票（来源模板）」', async () => {
    const dock = await mountWith(TPL);
    expect(dock.current.header).toBe('收取发票（本报表）');
    expect(dock.sources.map(c => c.header)).toEqual(['收取发票（来源模板）']);
  });

  it('无模板归属的调用域：列①直接叫「本报表」，不挂空模板名', async () => {
    const dock = await mountWith('');
    expect(dock.current.header).toBe('本报表');
  });
});
