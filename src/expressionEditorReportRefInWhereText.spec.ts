import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField, type TextSource } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import type { ConditionConfirmPayload } from './ConditionEditorDialog.vue';
import { expressionModelToV4Doc, type V4ModelAdapterContext } from './v4/expressionModelAdapter';
import { emptyExtractNodeDocument } from './v4/emptyNodeDocument';

/**
 *
 * 病灶（ExpressionEditor.vue collectUsedAliases）：V4 语法下 WHERE 的真实文本落在
 * model.where_text_source.text（v4ExpressionHostAdapter.lowerTextViaV4 对 purpose='where' 恒返回
 * EMPTY_CONDITION_GROUP——V4 没有引导式条件，真实内容全在 sidecar 原文），而 collectUsedAliases
 * 原先只扫 walkGroup(m.where)（因此恒空）与 walk(m.where_expr)（confirm 时已被 setWhereLowered
 * delete 掉），从未扫过 where_text_source.text——本报表引用因此永远判不到「已引用」，其上下文表
 * 进不了 source.tables，V4 文档里就没有对应的 report 来源。
 */

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

// 本报表两张表：主表「采购订单的主表」(dt_po_main) + 明细「采购明细」(dt_po_detail)。
// ctx.tableFields 按此顺序编号 bt*：bt0=dt_po_main（主表），bt1=dt_po_detail（明细）。
const HOST_TABLES: TemplateDataTable[] = [
  {
    data_table_id: DT_PO_MAIN,
    table_code: DT_PO_MAIN,
    table_name: '采购订单的主表',
    physical_table_name: DT_PO_MAIN,
    table_role: 'main',
    sort_no: 0,
    field_count: 1,
    version_no: 1
  },
  {
    data_table_id: DT_PO_DETAIL,
    table_code: DT_PO_DETAIL,
    table_name: '采购明细',
    physical_table_name: DT_PO_DETAIL,
    table_role: 'extension',
    sort_no: 1,
    field_count: 1,
    version_no: 1
  }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [DT_PO_MAIN]: [field('f_summary', '摘要')],
  [DT_PO_DETAIL]: [field('f_material', '物料编码')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({ purpose: req.purpose, text_source: { text: req.text, pack_revision: 'test', digest: 'd' }, diagnostics: [] })
  };
}

/** 一张显式来源表：「物料主数据的主表」，别名 t1，字段「编码」。 */
function modelWithExplicitSource(targetDataTableId: string, targetRole: 'main' | 'detail', autoRowMatch = false): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [
    { alias: 't1', source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: DT_MATERIAL, is_context: false }
  ];
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: targetDataTableId,
    target_table_role: targetRole,
    auto_row_match: autoRowMatch,
    outputs: []
  };
  return m;
}

/** ConditionEditorDialog 桩：只保留本文件需要的一件事——能程序化 emit 'confirm'，
 *  载荷形状与真实 v4ExpressionHostAdapter.lowerTextViaV4 对 purpose='where' 的返回一致
 *  （group 恒空组、真实文本落 whereTextSource.text），模拟用户在条件编辑器里字段树点选出
 *  本报表引用、点「确定」后 AdvancedExpressionPanel→ConditionEditorDialog 的真实回抛载荷。 */
const ConditionEditorDialogStub = defineComponent({
  name: 'ConditionEditorDialog',
  props: ['show', 'mode', 'group', 'whereTextSource', 'sourceTables', 'formTables', 'dockColumns'],
  emits: ['update:show', 'confirm'],
  setup(_props, { emit }) {
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
  for (let i = 0; i < 8; i += 1) await nextTick();
}

/** 挂 ExpressionEditor（brackets 语法，与真实 V4 设计器 ActionConfigSurface.vue provideRefSyntax('brackets') 一致）。 */
async function mountEditor(initial: ExpressionModel): Promise<{ wrapper: VueWrapper; editor: VueWrapper; current: { value: ExpressionModel } }> {
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
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  return { wrapper, editor: wrapper.findComponent(ExpressionEditor as any), current };
}

/** 模拟「用户在条件编辑器里用字段树点选出本报表引用、点确定」：ConditionEditorDialog 回抛
 *  mode='expr' + 空结构化组 + 真实文本 sidecar（与 lowerTextViaV4 的返回形状一致）。 */
async function confirmWhereText(wrapper: VueWrapper, text: string): Promise<void> {
  const dialog = wrapper.findComponent(ConditionEditorDialogStub as any);
  expect(dialog.exists()).toBe(true);
  const whereTextSource: TextSource = { text, pack_revision: 'alice-v4', digest: '', refs: [] };
  const payload: ConditionConfirmPayload = { mode: 'expr', group: { logic: 'and', items: [] }, whereTextSource };
  dialog.vm.$emit('confirm', payload);
  await flushMounted();
}

const CTX: V4ModelAdapterContext = {
  templateId: REPORT_TEMPLATE_ID,
  tableLabelOf: src => ({ [DT_PO_MAIN]: '采购订单的主表', [DT_PO_DETAIL]: '采购明细', [DT_MATERIAL]: '物料主数据的主表' })[src.data_table_id]
};

describe('V4（brackets）WHERE 文本里的本报表引用须登记为 report 来源', () => {
  it('A 主表场景：本报表.[采购订单的主表].[摘要] = [物料主数据的主表].[编码] —— bt0 落 source.tables，V4 文档 query.sources 出现 kind=report', async () => {
    const { wrapper, current } = await mountEditor(modelWithExplicitSource(DT_PO_MAIN, 'main'));
    await confirmWhereText(wrapper, '本报表.[采购订单的主表].[摘要] = [物料主数据的主表].[编码]');

    // ① reconcile 落定：is_context 的本报表上下文表必须出现在 source.tables 里（此前的病灶是它永远不出现）。
    const bt0 = current.value.source.tables.find(t => t.is_context && t.data_table_id === DT_PO_MAIN);
    expect(bt0).toBeTruthy();
    expect(bt0?.role).toBe('main');
    expect(current.value.where_text_source?.text).toBe('本报表.[采购订单的主表].[摘要] = [物料主数据的主表].[编码]');

    // ② 全链终点：expressionModelToV4Doc 产出的 V4 文档 query.sources 必须含对应 report 来源。
    const doc = expressionModelToV4Doc(current.value, emptyExtractNodeDocument(), CTX);
    const reportSrc = doc.query.sources.find(s => s.kind === 'report' && s.table_id === DT_PO_MAIN);
    expect(reportSrc).toMatchObject({ kind: 'report', alias: '采购订单的主表', table_role: 'main' });
    wrapper.unmount();
  });

  it('B 明细 + 自动匹配场景：本报表.[采购明细].[物料编码] = [物料主数据的主表].[编码] —— bt1 落 source.tables，V4 文档 query.sources 出现 kind=report', async () => {
    const { wrapper, current } = await mountEditor(modelWithExplicitSource(DT_PO_DETAIL, 'detail', true));
    await confirmWhereText(wrapper, '本报表.[采购明细].[物料编码] = [物料主数据的主表].[编码]');

    const bt1 = current.value.source.tables.find(t => t.is_context && t.data_table_id === DT_PO_DETAIL);
    expect(bt1).toBeTruthy();
    expect(bt1?.role).toBe('detail');

    const doc = expressionModelToV4Doc(current.value, emptyExtractNodeDocument(), CTX);
    const reportSrc = doc.query.sources.find(s => s.kind === 'report' && s.table_id === DT_PO_DETAIL);
    expect(reportSrc).toMatchObject({ kind: 'report', alias: '采购明细', table_role: 'detail' });
    wrapper.unmount();
  });

  it('反证：braces（3.4）语法下同一条件不触发本报表文本扫描（既有行为不受影响——braces 从不产出 where_text_source 报表文本引用）', async () => {
    const current = ref<ExpressionModel>(modelWithExplicitSource(DT_PO_MAIN, 'main'));
    const Harness = defineComponent({
      setup() {
        provideExpressionHost(makeHost());
        provideRefSyntax('braces');
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
    // braces 语法下手工塞一份带「本报表.[采购订单的主表].[摘要]」字样的 where_text_source
    // （braces 真实链路里 lowerText 不会产出这种文本，这里只是构造反证输入，确认 walk() 内部按
    // refSyntax==='brackets' 才扫描 reportTableNamesInText，braces 下即便文本长这样也不会误判）。
    const dialog = wrapper.findComponent(ConditionEditorDialogStub as any);
    const whereTextSource: TextSource = { text: '本报表.[采购订单的主表].[摘要] = 1', pack_revision: 'test', digest: '', refs: [] };
    const payload: ConditionConfirmPayload = { mode: 'expr', group: { logic: 'and', items: [] }, whereTextSource };
    dialog.vm.$emit('confirm', payload);
    await flushMounted();
    const bt0 = current.value.source.tables.find(t => t.is_context && t.data_table_id === DT_PO_MAIN);
    expect(bt0).toBeUndefined();
    wrapper.unmount();
  });
});
