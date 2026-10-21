import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';
import type { DockColumnsBundle } from './dockColumns';

/**
 *
 * 本文件驱动一个显式来源表（另一模板，字段含 text/attachment/image 三档）+ 一个取数目标表（本模板，
 * 字段含 text/attachment 两档），钉三件事：
 * A. V4（brackets）模式：ConditionEditorDialog 收到的 dockColumns.sources 里，来源表 t1 的 text /
 *    attachment / image 三档字段都在；
 * B. 目标列表照旧：目标表的附件字段渲染出填充行（data-testid="expression-target-row-<field_id>"），
 *    且字段名旁带附件提示（data-testid="target-attachment-hint-<field_id>"）；
 * C. braces（3.4）语法下同一来源表，dockColumns.sources 里 attachment/image 字段原样保留（一直如此）。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TEMPLATE_ID = 'tpl_material';
const DT_TARGET = 'dt_target_detail';
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
  [REPORT_TEMPLATE_ID]: [
    {
      data_table_id: DT_TARGET,
      table_code: DT_TARGET,
      table_name: '出库明细',
      physical_table_name: DT_TARGET,
      table_role: 'extension',
      sort_no: 1,
      field_count: 2,
      version_no: 1
    }
  ],
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
  // 目标表：一个普通文本字段 + 一个附件字段（合并折叠等填充策略仍可选附件为目标，不应被过滤）。
  [DT_TARGET]: [field('fld_t_text', '备注', 'text'), field('fld_t_attach', '验收单附件', 'attachment')],
  // 来源表：文本 + 附件 + 图片（后两档来源目录不承接，应被来源字段树隐藏）。
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

/** 一张显式来源表（t1，另一模板） + 一个取数目标（本模板 DT_TARGET，明细角色）。 */
function modelWithSourceAndTarget(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [
    { alias: 't1', source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: DT_SRC, is_context: false }
  ];
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: DT_TARGET,
    target_table_role: 'detail',
    outputs: []
  };
  return m;
}

/** ConditionEditorDialog 桩：只为拿到编辑器算好的 dockColumns（来源字段树的唯一渲染数据源，
 *  见 ExpressionEditor.vue 顶部「树坞列透传」注释），不驱动它的交互。 */
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

async function mountEditor(syntax: RefSyntax): Promise<VueWrapper> {
  const current = ref<ExpressionModel>(modelWithSourceAndTarget());
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax(syntax);
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
  return wrapper;
}

/** 从 ConditionEditorDialog 桩收到的 dockColumns 里拍平所有来源表（不含"本报表"列），按 alias 找一张。 */
function sourceDockTableByAlias(dockColumns: DockColumnsBundle, alias: string) {
  for (const col of dockColumns.sources) {
    const t = col.tables.find(x => x.alias === alias);
    if (t) return t;
  }
  return undefined;
}

describe('来源字段树不再隐藏附件/图片字段', () => {
  it('A：V4（brackets）模式 —— 来源表 t1 的字段树含文本、附件、图片三档', async () => {
    const wrapper = await mountEditor('brackets');
    const dialog = wrapper.findComponent(ConditionEditorDialogStub as any);
    expect(dialog.exists()).toBe(true);
    const dockColumns = dialog.props('dockColumns') as DockColumnsBundle;
    const t1 = sourceDockTableByAlias(dockColumns, 't1');
    expect(t1).toBeTruthy();
    const fieldIds = (t1?.fields ?? []).map(f => f.field_id);
    expect(fieldIds).toContain('fld_s_text');
    expect(fieldIds).toContain('fld_s_attach');
    expect(fieldIds).toContain('fld_s_image');
    wrapper.unmount();
  });

  it('B：目标表的附件字段渲染出填充行，并带图片 / 附件类型提示（文本字段没有）', async () => {
    const wrapper = await mountEditor('brackets');
    expect(wrapper.find('[data-testid="expression-target-row-fld_t_text"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="expression-target-row-fld_t_attach"]').exists()).toBe(true);
    const hint = wrapper.find('[data-testid="target-attachment-hint-fld_t_attach"]');
    expect(hint.exists()).toBe(true);
    expect(hint.attributes('title')).toBeTruthy();
    expect(wrapper.find('[data-testid="target-attachment-hint-fld_t_text"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('C 反证：braces（3.4）语法下来源字段树不过滤，附件/图片原样保留', async () => {
    const wrapper = await mountEditor('braces');
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
