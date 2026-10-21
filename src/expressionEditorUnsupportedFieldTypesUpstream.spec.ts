import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import type { DockColumnsBundle } from './dockColumns';

/**
 *
 * 沿用 sourceTreeAttachmentFilter.spec.ts 的夹具/挂载手法（同一套 REPORT/SRC 模板、同一个
 * ConditionEditorDialog 桩用来拿编辑器算好的 dockColumns），只新增"传了 unsupportedFieldTypes"
 * 这一分支，不改动、不删除原文件的既有钉点。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TEMPLATE_ID = 'tpl_material';
const DT_SRC = 'dt_src_material';

function field(fieldId: string, name: string, dataType: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: fieldId,
    field_name: name,
    data_type: dataType,
    display_style: 'text',
    sort_no: 0,
    is_searchable: true,
    is_filterable: true,
    is_sortable: true,
    is_list_visible: true
  };
}

const HOST_TABLES: Record<string, TemplateDataTable[]> = {
  [SRC_TEMPLATE_ID]: [
    {
      data_table_id: DT_SRC,
      table_code: DT_SRC,
      table_name: '物料主数据的主表',
      physical_table_name: DT_SRC,
      table_role: 'main',
      sort_no: 0,
      field_count: 3,
      version_no: 1
    }
  ]
};
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [DT_SRC]: [field('fld_s_text', '编码', 'text'), field('fld_s_attach', '合格证附件', 'attachment'), field('fld_s_image', '实物图', 'image')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => HOST_TABLES[templateId] ?? [],
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

function modelWithSource(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [
    { alias: 't1', source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: DT_SRC, is_context: false }
  ];
  return m;
}

const ConditionEditorDialogStub = defineComponent({
  name: 'ConditionEditorDialog',
  props: ['show', 'mode', 'group', 'whereTextSource', 'sourceTables', 'formTables', 'dockColumns'],
  emits: ['update:show', 'confirm'],
  setup() {
    return () => h('div', { 'data-testid': 'condition-editor-dialog-stub' });
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
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  ConditionEditorDialog: ConditionEditorDialogStub
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 10; i += 1) await nextTick();
}

async function mountEditor(unsupportedFieldTypes?: string[]): Promise<VueWrapper> {
  const current = ref<ExpressionModel>(modelWithSource());
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets'); // V4：不传 unsupportedFieldTypes 时才会命中既有隐藏集过滤。
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              unsupportedFieldTypes,
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

function sourceDockTableByAlias(dockColumns: DockColumnsBundle, alias: string) {
  for (const col of dockColumns.sources) {
    const t = col.tables.find(x => x.alias === alias);
    if (t) return t;
  }
  return undefined;
}

describe('unsupportedFieldTypes：传了该 prop 时上游不再按 V4 隐藏集过滤来源字段树', () => {
  it("传 unsupportedFieldTypes=['attachment']：来源表 t1 的字段树保留全部字段（含未列入名单的 image）", async () => {
    const wrapper = await mountEditor(['attachment']);
    const dialog = wrapper.findComponent(ConditionEditorDialogStub as any);
    const dockColumns = dialog.props('dockColumns') as DockColumnsBundle;
    const t1 = sourceDockTableByAlias(dockColumns, 't1');
    const fieldIds = (t1?.fields ?? []).map(f => f.field_id);
    expect(fieldIds).toContain('fld_s_text');
    expect(fieldIds).toContain('fld_s_attach');
    expect(fieldIds).toContain('fld_s_image'); // 未列入名单也不再被整体隐藏，交由下游置灰
    wrapper.unmount();
  });

  it('不传 unsupportedFieldTypes：V4 不再隐藏 attachment/image，来源字段树保留全部字段', async () => {
    const wrapper = await mountEditor(undefined);
    const dialog = wrapper.findComponent(ConditionEditorDialogStub as any);
    const dockColumns = dialog.props('dockColumns') as DockColumnsBundle;
    const t1 = sourceDockTableByAlias(dockColumns, 't1');
    const fieldIds = (t1?.fields ?? []).map(f => f.field_id);
    expect(fieldIds).toContain('fld_s_text');
    expect(fieldIds).toContain('fld_s_attach');
    expect(fieldIds).toContain('fld_s_image');
    wrapper.unmount();
  });
});
