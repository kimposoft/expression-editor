import { describe, expect, it } from 'vitest';
import { computed, defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import ExpressionInput from './ExpressionInput.vue';
import SourceTreePicker from './SourceTreePicker.vue';
import { type ExpressionModel, type TemplateDataTable, type TemplateField, type WriteOperation } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import type { V4ModelAdapterContext } from './v4/expressionModelAdapter';
import { v4WriteDocToExpressionModel, expressionModelToV4WriteDoc } from './v4/writeModelAdapter';
import { emptyWriteNodeDocument, type V4WriteNodeDocument } from './v4/writeNodeDocument';

/**
 *
 * 复现口径（本文件走查确认）：`autoMatchFields` 的 `isSelfMatch` 守卫（ExpressionEditor.vue
 * :2263 附近）只按 `src.dataTableId === tableId` 排除"候选来源就是写目标自身这一张表"——对**写目标
 * 自身**这一档，只要 sourceTablesForInput 的 dataTableId 正确回填，现有守卫确实能挡住字面意义的
 * "同表同字段"自赋值（本文件保留一条覆盖用例钉住这一点，回归不能退步）。
 *
 * 本文件照 expressionEditorWriteTargetRoundTrip.spec.ts 的往返驱动手法（docRef 权威 V4WriteNodeDocument
 * + expressionModel computed 每次重译）复现，全程真实交互（选目标→手动填一个引用候选池表的锚点字段
 * →配置定位条件引用本报表→点「按名称填充」），不手搭 model.source.tables 数组。
 */

const REPORT_TEMPLATE_ID = 'tpl_material_r0910'; // 物料信息（当前模板，本报表）
const TARGET_TEMPLATE_ID = 'tpl_purchase_r0910'; // 采购入库（写目标所在模板）
const RPT_MAIN = 'dt_material_main_r0910'; // 物料信息的主表
const TARGET_MAIN = 'dt_purchase_main_r0910'; // 采购入库的主表（候选池）
const TARGET_DETAIL = 'dt_purchase_detail_r0910'; // 采购入库的扩展表（写目标）

const RPT_MAIN_LABEL = '物料信息的主表';
const TARGET_MAIN_LABEL = '采购入库的主表';
const DETAIL_LABEL = '采购入库的扩展表';

function field(fieldId: string, code: string, name: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: code,
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
function table(dataTableId: string, role: 'main' | 'extension', name: string): TemplateDataTable {
  return {
    data_table_id: dataTableId,
    table_code: dataTableId,
    table_name: name,
    physical_table_name: dataTableId,
    table_role: role,
    sort_no: role === 'main' ? 0 : 1,
    field_count: 1,
    version_no: 1
  };
}

const TARGET_TABLES: TemplateDataTable[] = [table(TARGET_MAIN, 'main', TARGET_MAIN_LABEL), table(TARGET_DETAIL, 'extension', DETAIL_LABEL)];
const REPORT_TABLES: TemplateDataTable[] = [table(RPT_MAIN, 'main', RPT_MAIN_LABEL)];

// 本报表主表（权威来源，用户本意）/ 写目标候选池表（采购入库的主表，业务常见明细镶边快照）/
// 写目标扩展表本身（待填充）三处各自持有同名字段——field_code/field_name 三处双同，field_id 各自
// 独立（不同表的不同物理字段）。
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [RPT_MAIN]: [
    field('f_rpt_code', 'mat_code', '物料编号'),
    field('f_rpt_name', 'mat_name', '物料名称'),
    field('f_rpt_spec', 'mat_spec', '规格型号'),
    field('f_rpt_unit', 'mat_unit', '单位')
  ],
  [TARGET_DETAIL]: [
    field('f_tgt_code', 'mat_code', '物料编号'),
    field('f_tgt_name', 'mat_name', '物料名称'),
    field('f_tgt_spec', 'mat_spec', '规格型号'),
    field('f_tgt_unit', 'mat_unit', '单位')
  ],
  [TARGET_MAIN]: [
    field('f_pool_no', 'pool_no', '单号'),
    field('f_pool_name', 'mat_name', '物料名称'),
    field('f_pool_spec', 'mat_spec', '规格型号'),
    field('f_pool_unit', 'mat_unit', '单位')
  ]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId =>
      templateId === TARGET_TEMPLATE_ID ? TARGET_TABLES : templateId === REPORT_TEMPLATE_ID ? REPORT_TABLES : [],
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      condition: req.purpose === 'where' ? { logic: 'and' as const, items: [] } : undefined,
      text_source: { text: req.text, pack_revision: 'test', digest: `d:${req.text}` },
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
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
const SqlEditorStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { expose }) {
    expose({ focus() {}, focusRange() {}, insertAtCursor() {} });
    return () => h('div', { 'data-testid': 'sql-editor-stub' });
  }
});
/** 不打桩 ExpressionInput（④字段赋值行）与 ConditionEditorDialog（②条件弹窗）——本文件要真实驱动
 *  这两处交互，同 expressionEditorWriteTargetRoundTrip.spec.ts 既有手法。 */
const STUBS: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: ButtonStub,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  NRadioGroup: SlotPassthrough,
  NRadio: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  JoinDesignerDialog: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  OperatorFunctionBar: SlotPassthrough,
  ExpressionSqlEditor: SqlEditorStub
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

const CTX: V4ModelAdapterContext = {
  templateId: REPORT_TEMPLATE_ID,
  readableTextOf: (_id, tokenized) => tokenized,
  tableLabelOf: ({ data_table_id }) =>
    data_table_id === TARGET_MAIN
      ? TARGET_MAIN_LABEL
      : data_table_id === TARGET_DETAIL
        ? DETAIL_LABEL
        : data_table_id === RPT_MAIN
          ? RPT_MAIN_LABEL
          : undefined,
  fieldLabelOf: (_instanceId, fieldId) => fieldId
};

/** 照 ActionConfigSurface.vue 的往返形状挂载编辑器：docRef 是权威 V4WriteNodeDocument，
 *  expressionModel 是每次渲染都从 docRef 重新翻译出的全新 3.4 模型对象，onUpdate:modelValue 把
 *  编辑器吐出的模型翻回文档存进 docRef——与 expressionEditorWriteTargetRoundTrip.spec.ts 同一手法。 */
async function mountEditorWithRoundTrip(
  initialDoc: V4WriteNodeDocument,
  writeOperation: WriteOperation,
  ctx: V4ModelAdapterContext,
  host: ExpressionHost = makeHost()
): Promise<{
  wrapper: VueWrapper;
  editor: VueWrapper;
  doc: () => V4WriteNodeDocument;
  current: () => ExpressionModel;
}> {
  const docRef = ref<V4WriteNodeDocument>(initialDoc);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(host);
      provideRefSyntax('brackets');
      const expressionModel = computed(() => v4WriteDocToExpressionModel(docRef.value, ctx));
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: expressionModel.value,
              templateId: REPORT_TEMPLATE_ID,
              writeOperation: writeOperation || undefined,
              'onUpdate:modelValue': (next: ExpressionModel) => {
                docRef.value = expressionModelToV4WriteDoc(next, docRef.value, ctx);
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: STUBS } });
  await flushMounted();
  const editor = wrapper.findComponent(ExpressionEditor as any);
  return {
    wrapper,
    editor,
    doc: () => docRef.value,
    current: () => v4WriteDocToExpressionModel(docRef.value, CTX)
  };
}

async function openConditionDialogAndType(wrapper: VueWrapper, text: string): Promise<{ confirmBtn: DOMWrapper<Element> }> {
  await wrapper.find('[data-testid="qb-condition-view"]').trigger('click');
  await flushMounted();
  const sqlEditor = wrapper.findComponent(SqlEditorStub as any);
  expect(sqlEditor.exists(), '条件弹窗应已渲染真实 AdvancedExpressionPanel/ExpressionSqlEditor 桩').toBe(true);
  sqlEditor.vm.$emit('update:modelValue', text);
  await flushMounted();
  const confirmBtnEl = document.body.querySelector('.exd-footer [data-kdlf="confirm"]');
  expect(confirmBtnEl, '确定按钮应已渲染（KDialog 传送到 document.body）').not.toBeNull();
  return { confirmBtn: new DOMWrapper(confirmBtnEl as Element) };
}

describe('用户 09-10 反馈：写模式「修改数据」目标=扩展表，按名称填充误命中候选池/自身字段', () => {
  it('候选池表（写目标模板配对表）先于本报表被引用时，按名称填充误命中候选池自己的同名字段（不是本报表）', async () => {
    const { wrapper, editor, current } = await mountEditorWithRoundTrip(emptyWriteNodeDocument('update'), 'update', CTX);
    try {
      // ① 选目标＝采购入库的扩展表。
      const picker = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      expect(picker, '①目标段的 SourceTreePicker（single=true）应存在').toBeTruthy();
      picker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_DETAIL, role: 'detail', name: DETAIL_LABEL }]);
      await flushMounted();
      expect(current().target.target_data_table_id).toBe(TARGET_DETAIL);

      // ② 先手动给「物料编号」填一个引用候选池表（采购入库的主表）自身字段的锚点表达式——与本次
      //    自动匹配无关的一次正常操作，但会让候选池表「引用即入源」正式登记进 model.source.tables，
      //    登记时间早于本报表（下一步才配置定位条件）。
      const codeRow = wrapper.find('[data-testid="expression-write-target-row-f_tgt_code"]');
      expect(codeRow.exists(), '物料编号字段行应已渲染').toBe(true);
      const codeInput = codeRow.findComponent(ExpressionInput as any);
      expect(codeInput.exists()).toBe(true);
      codeInput.vm.$emit('update:model-value', { kind: 'raw', text: `[${TARGET_MAIN_LABEL}].[单号]` });
      await flushMounted();
      expect(current().target.outputs.find(o => o.target_field_id === 'f_tgt_code')?.expression.text).toBe(`[${TARGET_MAIN_LABEL}].[单号]`);
      // 候选池表应已登记入源。
      expect(current().source.tables.some(t => t.data_table_id === TARGET_MAIN), `候选池表应已登记：${JSON.stringify(current().source.tables)}`).toBe(true);

      // ③ 定位条件：本报表.[物料信息的主表].[物料编号] = [采购入库的扩展表].[物料编号]。
      const { confirmBtn } = await openConditionDialogAndType(
        wrapper,
        `本报表.[${RPT_MAIN_LABEL}].[物料编号] = [${DETAIL_LABEL}].[物料编号]`
      );
      await confirmBtn.trigger('click');
      await flushMounted();
      expect(current().source.tables.some(t => t.is_context), '本报表来源也应已登记').toBe(true);

      // ④ 点「按名称填充」。
      await wrapper.find('[data-testid="write-auto-match-btn"]').trigger('click');
      await flushMounted();

      const outputs = current().target.outputs;
      const nameExpr = outputs.find(o => o.target_field_id === 'f_tgt_name')?.expression;
      const specExpr = outputs.find(o => o.target_field_id === 'f_tgt_spec')?.expression;
      const unitExpr = outputs.find(o => o.target_field_id === 'f_tgt_unit')?.expression;

      // 修前失败断言（当前 bug）：三条命中的都必须是本报表主表的同名字段，不能命中候选池表
      // （采购入库的主表）自己的同名字段——候选池表比本报表先登记入源，按现有"先到先得"扫描顺序
      // 会被误选中，值与用户想要的本报表字段完全无关。只比 kind/text（往返翻译会给 raw 节点多挂一份
      // text_source sidecar，非本用例断言范围）。
      expect(nameExpr?.kind, `物料名称填充表达式：${JSON.stringify(nameExpr)}`).toBe('raw');
      expect(nameExpr?.text, `物料名称填充表达式：${JSON.stringify(nameExpr)}`).toBe(`本报表.[${RPT_MAIN_LABEL}].[物料名称]`);
      expect(specExpr?.kind, `规格型号填充表达式：${JSON.stringify(specExpr)}`).toBe('raw');
      expect(specExpr?.text, `规格型号填充表达式：${JSON.stringify(specExpr)}`).toBe(`本报表.[${RPT_MAIN_LABEL}].[规格型号]`);
      expect(unitExpr?.kind, `单位填充表达式：${JSON.stringify(unitExpr)}`).toBe('raw');
      expect(unitExpr?.text, `单位填充表达式：${JSON.stringify(unitExpr)}`).toBe(`本报表.[${RPT_MAIN_LABEL}].[单位]`);
    } finally {
      wrapper.unmount();
    }
  });

  it('（回归钉）写目标自身字段永不被按名称填充自赋值——即使候选池/本报表都缺席', async () => {
    // 只选目标、不配置定位条件、不引用候选池：候选列表里唯一可能撞见的"同名字段"就是目标自身。
    // 无论修法怎么改候选顺序，这条钉都必须继续成立：目标字段绝不能被填成引用自己。
    const { wrapper, current } = await mountEditorWithRoundTrip(emptyWriteNodeDocument('update'), 'update', CTX);
    try {
      const editor = wrapper.findComponent(ExpressionEditor as any);
      const picker = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      picker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_DETAIL, role: 'detail', name: DETAIL_LABEL }]);
      await flushMounted();

      await wrapper.find('[data-testid="write-auto-match-btn"]').trigger('click');
      await flushMounted();

      const outputs = current().target.outputs;
      for (const fieldId of ['f_tgt_name', 'f_tgt_spec', 'f_tgt_unit', 'f_tgt_code']) {
        const expr = outputs.find(o => o.target_field_id === fieldId)?.expression;
        if (!expr) continue; // 无命中不落行，同样满足"没有自赋值"。
        expect(expr.text, `${fieldId} 不应自赋值：${JSON.stringify(expr)}`).not.toBe(`[${DETAIL_LABEL}].[${HOST_FIELDS[TARGET_DETAIL].find(f => f.field_id === fieldId)?.field_name}]`);
      }
    } finally {
      wrapper.unmount();
    }
  });

  it('（兜底提示）手动把字段填成引用目标字段自身时，④该行下方显示 info 提示，不阻断其它行', async () => {
    // 兜底提示覆盖的是"自动匹配之外任何来源"的自赋值（如用户手动在 ƒ 表达式框直接敲了一遍目标
    // 表名+字段名）——不依赖 autoMatchFields，直接模拟一次手动填值。
    const { wrapper, current } = await mountEditorWithRoundTrip(emptyWriteNodeDocument('update'), 'update', CTX);
    try {
      const editor = wrapper.findComponent(ExpressionEditor as any);
      const picker = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      picker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_DETAIL, role: 'detail', name: DETAIL_LABEL }]);
      await flushMounted();

      const nameRow = wrapper.find('[data-testid="expression-write-target-row-f_tgt_name"]');
      const nameInput = nameRow.findComponent(ExpressionInput as any);
      nameInput.vm.$emit('update:model-value', { kind: 'raw', text: `[${DETAIL_LABEL}].[物料名称]` });
      await flushMounted();
      expect(current().target.outputs.find(o => o.target_field_id === 'f_tgt_name')?.expression.text).toBe(`[${DETAIL_LABEL}].[物料名称]`);

      // 自赋值字段（物料名称）下方应出现提示；未配置/未自赋值的字段（规格型号）不应出现。
      expect(wrapper.find('[data-testid="write-self-assignment-hint-f_tgt_name"]').exists(), '物料名称行应显示自赋值提示').toBe(true);
      expect(wrapper.text()).toContain('该填充引用了目标字段自身，执行后值不变');
      expect(wrapper.find('[data-testid="write-self-assignment-hint-f_tgt_spec"]').exists(), '未自赋值的规格型号行不应显示提示').toBe(false);

      // 改成引用本报表字段后，提示应消失（不再是自赋值）。
      nameInput.vm.$emit('update:model-value', { kind: 'raw', text: `本报表.[${RPT_MAIN_LABEL}].[物料名称]` });
      await flushMounted();
      expect(wrapper.find('[data-testid="write-self-assignment-hint-f_tgt_name"]').exists(), '改成引用本报表字段后提示应消失').toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
