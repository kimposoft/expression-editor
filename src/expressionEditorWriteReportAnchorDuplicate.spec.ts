import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import type { ExpressionModel, TemplateDataTable, TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import { reportInstanceId, type V4ModelAdapterContext } from './v4/expressionModelAdapter';
import { v4WriteDocToExpressionModel, expressionModelToV4WriteDoc } from './v4/writeModelAdapter';
import type { V4WriteNodeDocument } from './v4/writeNodeDocument';

/**
 *
 * 根因（ExpressionEditor.vue reconcile()「本报表扩展（明细）锚点」段，见该函数同段注释）：判"本报表
 * 主表 context 是否已在 source.tables"按别名字符串精确比对（`t.alias === reportAlias(mainIdx)`，
 * 即 `bt<index>`）。但一份**已保存过、被重新打开编辑**的写节点，其 report 来源在往返 V4 一圈之后，
 * 别名会被 v4/expressionModelAdapter.sourceBindingToTable 改写成权威的 `rpt-<table_id>-<hash>`
 * 形态，不再是 `bt<index>`——于是这个字符串比对恒不命中，"已经在场、只是换了个别名"的主表被误判成
 * "没有"，reconcile 在 onMounted 的迁移 pass 里就会重新插入一条同 data_table_id、别名却是 `bt0` 的
 * 重复条目。两条目翻到 V4 时都经 reportInstanceId（纯按 data_table_id 派生，与别名无关）算出同一个
 * instance_id，写进 query.sources 就撞出「与前面某条 source 重复」——不需要用户在编辑器里再做任何
 * 操作，仅仅「重开这个节点」
 * 就会触发。
 *
 * 本文件挂载真实 ExpressionEditor（写模式 writeOperation='insert'，brackets 语法即 V4 配置面的真实
 * 运行形态），modelValue 喂 v4WriteDocToExpressionModel 的产物（模拟"服务端已保存的写节点被重新打开"
 * 这一步），断言 onMounted 里的迁移 reconcile 不会引入重复的本报表主表 context 条目，且收口回 V4
 * 写文档后 query.sources 恰两条、instance_id 唯一。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const DT_MAIN = 'dt_po_main';
const DT_DETAIL = 'dt_po_detail';
const TARGET_TEMPLATE_ID = 'tpl_inventory';
const TARGET_TABLE_ID = 'tbl_inventory_flow';

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
  { data_table_id: DT_MAIN, table_code: DT_MAIN, table_name: '出库单的主表', physical_table_name: DT_MAIN, table_role: 'main', sort_no: 0, field_count: 1, version_no: 1 },
  { data_table_id: DT_DETAIL, table_code: DT_DETAIL, table_name: '出库明细', physical_table_name: DT_DETAIL, table_role: 'extension', sort_no: 1, field_count: 1, version_no: 1 }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [DT_MAIN]: [field('f_no', '单号')],
  [DT_DETAIL]: [field('f_qty', '数量'), field('f_material', '物料编码')],
  [TARGET_TABLE_ID]: [field('f_flow_no', '流水号'), field('f_flow_qty', '数量'), field('f_flow_order_no', '单号'), field('f_flow_material', '物料编码')]
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

/** 与截图一致的、"已保存过"的 V4 写节点文档：来源段两条 report 绑定（主表+明细），insert 写目标是
 *  另一模板的表（库存流水，不在来源段），四条赋值分别引用两张本报表表的字段（brackets 文本引用）。
 *  instance_id 用 reportInstanceId 现算（与生产链路同一份确定性派生），不手写假值。 */
function makeSavedWriteDoc(): V4WriteNodeDocument {
  const mainInstanceId = reportInstanceId({ alias: 'placeholder', data_table_id: DT_MAIN });
  const detailInstanceId = reportInstanceId({ alias: 'placeholder', data_table_id: DT_DETAIL });
  return {
    schema_version: 'kimpo.write-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [
        { kind: 'report', instance_id: mainInstanceId, alias: '出库单的主表', table_id: DT_MAIN, table_role: 'main' },
        { kind: 'report', instance_id: detailInstanceId, alias: '出库明细', table_id: DT_DETAIL, table_role: 'detail' }
      ],
      joins: [],
      options: { distinct: false, business_timezone: 'UTC' }
    },
    operation: 'insert',
    target: { template_id: TARGET_TEMPLATE_ID, data_table_id: TARGET_TABLE_ID },
    assignments: [
      { target_field_id: 'f_flow_no', expression: { expression_id: 'asg_f_flow_no', purpose: 'output', source_text: "'FLOW-001'", refs: [] } },
      { target_field_id: 'f_flow_qty', expression: { expression_id: 'asg_f_flow_qty', purpose: 'output', source_text: '本报表.[出库明细].[数量]', refs: [] } },
      { target_field_id: 'f_flow_order_no', expression: { expression_id: 'asg_f_flow_order_no', purpose: 'output', source_text: '本报表.[出库单的主表].[单号]', refs: [] } },
      { target_field_id: 'f_flow_material', expression: { expression_id: 'asg_f_flow_material', purpose: 'output', source_text: '本报表.[出库明细].[物料编码]', refs: [] } }
    ]
  };
}

function makeCtx(): V4ModelAdapterContext {
  return {
    templateId: REPORT_TEMPLATE_ID,
    readableTextOf: (_id, tokenized) => tokenized,
    tableLabelOf: ({ data_table_id }) =>
      data_table_id === DT_MAIN ? '出库单的主表' : data_table_id === DT_DETAIL ? '出库明细' : undefined
  };
}

// 自定义包内组件整体打桩（同 expressionEditorCatalogSelfJoinReconcile.spec.ts 惯例）：本文件只关心
// onMounted 迁移 reconcile 落定后的 model.source.tables 形状，不驱动这些子组件的交互。
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
  JoinDesignerDialog: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(initial: ExpressionModel): Promise<{ wrapper: VueWrapper; current: { value: ExpressionModel } }> {
  const current = ref<ExpressionModel>(initial);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      // V4 配置面恒 brackets 语法。
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              writeOperation: 'insert',
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

describe('写动作重开「已保存」的写节点，本报表主表+扩展表来源不重复', () => {
  it('挂载 ExpressionEditor（=重开写节点）后，本报表主表 context 条目不重复；收口回 V4 写文档 query.sources 恰两条且 instance_id 唯一', async () => {
    const doc = makeSavedWriteDoc();
    const ctx = makeCtx();
    // 模拟「动作设计器重开该写节点」：宿主用保存成功的 V4 写文档重新翻译出 ExpressionModel 喂给编辑器
    // （与 catalogSelfJoinReconcile.spec.ts 的取数节点复现同一手法，仅换写节点适配器）。
    const initialModel = v4WriteDocToExpressionModel(doc, ctx);
    // 反证前置条件：初始模型此刻只有两张本报表表（未经 onMounted 的迁移 reconcile）。
    expect(initialModel.source.tables).toHaveLength(2);

    const { wrapper, current } = await mountEditor(initialModel);
    try {
      // 断言①（根因钉点）：reconcile 落定后本报表 context 条目仍恰两条——不会因为「本报表扩展（明细）
      // 锚点」段按 bt<index> 字符串误判"主表不存在"而重复插入一条同表的锚点。
      const reportTables = current.value.source.tables.filter(t => t.is_context);
      expect(reportTables).toHaveLength(2);
      const mainEntries = reportTables.filter(t => t.data_table_id === DT_MAIN);
      expect(mainEntries).toHaveLength(1);
      const detailEntries = reportTables.filter(t => t.data_table_id === DT_DETAIL);
      expect(detailEntries).toHaveLength(1);

      const backDoc = expressionModelToV4WriteDoc(current.value, doc, ctx);
      expect(backDoc.query.sources).toHaveLength(2);
      const ids = backDoc.query.sources.map(s => s.instance_id);
      expect(new Set(ids).size).toBe(2);
      expect(new Set(ids)).toEqual(new Set(doc.query.sources.map(s => s.instance_id)));
    } finally {
      wrapper.unmount();
    }
  });
});
