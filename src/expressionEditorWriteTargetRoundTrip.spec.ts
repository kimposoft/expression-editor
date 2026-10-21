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


const REPORT_TEMPLATE_ID = 'tpl_report_r10';
const TARGET_TEMPLATE_ID = 'tpl_outbound_r10';
const TARGET_MAIN = 'dt_outbound_main_r10'; // 出库流水的主表
const TARGET_DETAIL = 'dt_outbound_detail_r10'; // 出库流水的扩展表（本用例的写目标）
const RPT_MAIN = 'dt_order_main_r10'; // 出库单的主表（本报表上下文）

const MAIN_LABEL = '出库流水的主表';
const DETAIL_LABEL = '出库流水的扩展表';
const RPT_MAIN_LABEL = '出库单的主表';

function field(fieldId: string, name = fieldId): TemplateField {
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

const TARGET_TABLES: TemplateDataTable[] = [table(TARGET_MAIN, 'main', MAIN_LABEL), table(TARGET_DETAIL, 'extension', DETAIL_LABEL)];
const REPORT_TABLES: TemplateDataTable[] = [table(RPT_MAIN, 'main', RPT_MAIN_LABEL)];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [TARGET_MAIN]: [field('f_source_no', '来源单号')],
  [TARGET_DETAIL]: [field('f_name', '名称'), field('f_remark', '备注')],
  [RPT_MAIN]: [field('f_order_no', '单据号')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId =>
      templateId === TARGET_TEMPLATE_ID ? TARGET_TABLES : templateId === REPORT_TEMPLATE_ID ? REPORT_TABLES : [],
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    // 恒成功：本文件复现的是往返丢标记问题，不是 G3/G4 死锁问题（既有 makeDeadlockAwareHost 覆盖
    // 死锁场景），条件弹窗随便什么文本都直接放行。
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
 *  这两处交互；弹窗内部重依赖（ExpressionSqlEditor/OperatorFunctionBar/ConditionTree/FieldTreeDock）打桩，
 *  同 expressionEditorWriteTargetFirst.spec.ts 既有 stubsWithRealConditionDialog 手法。 */
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
      ? MAIN_LABEL
      : data_table_id === TARGET_DETAIL
        ? DETAIL_LABEL
        : data_table_id === RPT_MAIN
          ? RPT_MAIN_LABEL
          : undefined,
  fieldLabelOf: (_instanceId, fieldId) => fieldId
};

/**
 * 照 ActionConfigSurface.vue 的往返形状挂载编辑器：docRef 是权威 V4WriteNodeDocument（等价 Surface
 * 的 `model` ref），expressionModel 是每次渲染都从 docRef 重新翻译出的全新 3.4 模型对象（等价 Surface
 * 的 `expressionModel` computed），`onUpdate:modelValue` 把编辑器吐出的模型翻回文档存进 docRef（等价
 * Surface 的 `onExpressionModelUpdate`）——**不直接存 3.4 模型对象**，这是与
 * expressionEditorWriteTargetFirst.spec.ts 的 mountEditor 唯一但关键的差异。
 */
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

describe('目标先行往返翻译（V4 文档⇄3.4 模型）不丢 is_write_target / 隐藏关联', () => {
  it('①选目标 → ②条件弹窗引用配对表+本报表表 → ③填充赋值 → finalize：query.joins 覆盖每条 sources，来源展示正确，候选池表可正常释放', async () => {
    const { wrapper, editor, doc, current } = await mountEditorWithRoundTrip(emptyWriteNodeDocument('update'), 'update', CTX);
    try {
      // ① 选目标＝出库流水的扩展表（每一步都经真实往返：ExpressionEditor 吐出的模型先翻成
      //    V4WriteNodeDocument 存进 docRef，再翻回全新的 3.4 模型对象喂回编辑器）。
      const picker = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      expect(picker, '①目标段的 SourceTreePicker（single=true）应存在').toBeTruthy();
      picker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_DETAIL, role: 'detail', name: DETAIL_LABEL }]);
      await flushMounted();

      expect(current().target.target_data_table_id).toBe(TARGET_DETAIL);
      // 往返一圈后隐含来源（目标本身）应仍带 is_write_target——不能只在 finalize() 那一刻才对，
      // 中间态（用户还没点确定）就该正确，否则②面板会在这一步之后立刻误显示「未关联」/可删除。
      const afterSelect = current().source.tables.filter(t => t.is_write_target);
      expect(afterSelect.map(t => t.data_table_id), `is_write_target 来源：${JSON.stringify(current().source.tables)}`).toEqual([
        TARGET_DETAIL
      ]);

      // ② 打开条件弹窗，插入引用「配对表（候选池=出库流水的主表）」+「本报表.出库单的主表」的定位条件。
      const { confirmBtn } = await openConditionDialogAndType(
        wrapper,
        `[${MAIN_LABEL}].[来源单号] = 本报表.[${RPT_MAIN_LABEL}].[单据号] 并且 [${DETAIL_LABEL}].[名称] = '螺丝'`
      );
      await confirmBtn.trigger('click');
      await flushMounted();

      // 候选池表（主表）应已正式登记入源，且往返一圈后仍带 is_write_target（不是只在提交给
      // update() 的那个瞬间对，喂回编辑器的下一份模型也要对）。
      const afterCondition = current().source.tables.filter(t => t.is_write_target);
      expect(
        afterCondition.map(t => t.data_table_id).sort(),
        `候选池表应已登记且仍带 is_write_target：${JSON.stringify(current().source.tables)}`
      ).toEqual([TARGET_DETAIL, TARGET_MAIN].sort());
      // 本报表来源也应已登记。
      expect(current().source.tables.some(t => t.is_context)).toBe(true);
      const writeTargetRows = wrapper.findAll('[data-write-target="true"]');
      expect(writeTargetRows.length, 'is_write_target 来源行数（中间态）').toBe(2);
      for (const row of writeTargetRows) {
        expect(row.classes()).toContain('qb-src-row-write-target');
        expect(row.find('.qb-src-remove').exists(), '目标相关来源不应有删除按钮（中间态）').toBe(false);
        expect(row.find('.qb-join-badge-unlinked').exists(), '目标相关来源不应显示「未关联」（中间态）').toBe(false);
      }

      // ③ 填充赋值：备注 ← '已核对'。
      const remarkRow = wrapper.find('[data-testid="expression-write-target-row-f_remark"]');
      expect(remarkRow.exists(), '备注字段行应已渲染').toBe(true);
      const remarkInput = remarkRow.findComponent(ExpressionInput as any);
      expect(remarkInput.exists()).toBe(true);
      remarkInput.vm.$emit('update:model-value', { kind: 'raw', text: "'已核对'" });
      await flushMounted();
      expect(current().target.outputs.find(o => o.target_field_id === 'f_remark')?.expression.text).toBe("'已核对'");

      const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
      const finalDoc = expressionModelToV4WriteDoc(finalized, doc(), CTX);
      const introduced = new Set(finalDoc.query.joins.map(j => j.right_instance_id));
      const rootId = finalDoc.query.sources[0]?.instance_id;
      const orphans = finalDoc.query.sources.filter(s => s.instance_id !== rootId && !introduced.has(s.instance_id));
      expect(orphans, `孤儿来源（从未被任何 Join 引入）：${JSON.stringify(finalDoc.query.sources)} / joins=${JSON.stringify(finalDoc.query.joins)}`).toEqual([]);
      // 目标模板配对表之间仍是记录身份关联（真实 ON），不是恒真占位符。
      const recordIdJoin = finalDoc.query.joins.find(
        j => j.on.refs.some(r => r.field_id === 'sys:parent_record_id') && j.on.refs.some(r => r.field_id === 'sys:record_id')
      );
      expect(recordIdJoin, `应有一条目标模板主+明细的记录身份关联：${JSON.stringify(finalDoc.query.joins)}`).toBeTruthy();
      expect(finalDoc.assignments.find(a => a.target_field_id === 'f_remark')?.expression.source_text).toBe("'已核对'");

      // ⑤ 清空条件（释放候选池表）：重开条件弹窗清空并确认，候选池表（主表）应从来源移除，
      //    连同其隐藏关联；隐含来源（目标本身）恒在。finalize() 是纯函数、不 emit，docRef 仍是
      //    ③步「填充赋值」update() 落地的那份文档（未含候选池释放），继续在其上操作即可。
      const { confirmBtn: confirmBtn2 } = await openConditionDialogAndType(wrapper, `[${DETAIL_LABEL}].[名称] = '螺丝'`);
      await confirmBtn2.trigger('click');
      await flushMounted();

      const afterClear = current().source.tables;
      expect(afterClear.some(t => t.data_table_id === TARGET_MAIN), `候选池表应已释放：${JSON.stringify(afterClear)}`).toBe(false);
      expect(afterClear.some(t => t.is_write_target && t.data_table_id === TARGET_DETAIL), '隐含来源恒在').toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});
