import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ConditionGroup, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

/**
 *   ① UI 撤除钉：无论模型是否structurally"可推导分组键"（旧判据 havingCandidatesFor 的两种输出
 *      组合），`qb-having-panel` 都不再渲染——不是"改判据"，是整段没了。
 *   ② round-trip 钉：存量模型带 having 段时，经编辑器打开（onMounted 迁移路径）与确认
 *      （finalize()）两个收口点，having 段必须**原样保留**（深比较）——回归守护 reconcile() 不再按
 *      候选清单剥离该字段。
 *      本文件覆盖 schema_version 1 与 2 两种存量文档、以及"可推导/不可推导分组键"两种输出形状——
 *      后者在旧实现下 open 时就会被剥离，是本轮改动的核心回归点。
 *
 * 挂载策略照抄 expressionEditorSchemaVersion.spec.ts（真实 ExpressionEditor + 桩 host + naive-ui
 * 整体打桩），`current()` 访问器同款读取 onMounted 迁移路径落地后的 v-model 值。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const TARGET_TABLE_ID = 'dt_target';
const SOURCE_TABLE_ID = 'dt_source';

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
function table(dataTableId: string, role: 'main' | 'extension'): TemplateDataTable {
  return {
    data_table_id: dataTableId,
    table_code: dataTableId,
    table_name: dataTableId,
    physical_table_name: dataTableId,
    table_role: role,
    sort_no: 0,
    field_count: 1,
    version_no: 1
  };
}
const HOST_TABLES: TemplateDataTable[] = [table(SOURCE_TABLE_ID, 'main'), table(TARGET_TABLE_ID, 'extension')];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [SOURCE_TABLE_ID]: [field('fld_category', '类别'), field('fld_amount', '金额')],
  [TARGET_TABLE_ID]: [field('fld_cat_out', '类别输出'), field('fld_sum_out', '合计输出')]
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

const sumOfAmount = { kind: 'func' as const, name: 'sum', args: [{ kind: 'source_field' as const, alias: 't1', field_id: 'fld_amount' }] };
const directCategory = { kind: 'source_field' as const, alias: 't1', field_id: 'fld_category' };
/** 存量 having 段：真实态左值直接引用目标输出表达式（sum(fld_amount)），与后端/旧存档口径一致——
 *  UI 撤除前的合成/真实态互译只发生在运行时展示层，持久化的 model.having 从来就是这个真实形态。 */
const legacyHavingGroup: ConditionGroup = {
  logic: 'and',
  items: [{ predicate: { left: sumOfAmount, op: 'gt', right: { kind: 'const', value: 100 } } }]
};

/** 单一来源表 t1 + 单一表填充目标（dt_target）的基础模型；outputs/having/schema_version 由调用方指定。 */
function havingBaseModel(
  outputs: ExpressionModel['target']['outputs'],
  having: ConditionGroup,
  schemaVersion: number
): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.schema_version = schemaVersion;
  m.source = { tables: [{ alias: 't1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: SOURCE_TABLE_ID, is_context: false, role: 'main' }], joins: [] };
  m.target = { target_template_id: REPORT_TEMPLATE_ID, target_data_table_id: TARGET_TABLE_ID, target_table_role: 'detail', outputs };
  m.having = having;
  return m;
}

/** 聚合输出与非聚合直连列混用——旧判据 havingCandidatesFor 会判"可推导分组键"（段本会显示）。 */
function modelHavingEligible(schemaVersion: number): ExpressionModel {
  return havingBaseModel(
    [
      { target_field_id: 'fld_cat_out', expression: directCategory, fill_strategy: 'overwrite' },
      { target_field_id: 'fld_sum_out', expression: sumOfAmount, fill_strategy: 'overwrite' }
    ],
    legacyHavingGroup,
    schemaVersion
  );
}

/** 纯标量聚合、无直连列——旧判据 havingCandidatesFor 会判"不可推导分组键"，reconcile 旧实现会把
 *  having 静默剥离。本形状是本轮回归的核心钉子：having 现在必须原样保留，不再被这条判据牵连。 */
function modelHavingIneligible(schemaVersion: number): ExpressionModel {
  return havingBaseModel([{ target_field_id: 'fld_sum_out', expression: sumOfAmount, fill_strategy: 'overwrite' }], legacyHavingGroup, schemaVersion);
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
// 🔴 桩键名必须是组件内部注册名（'Select'/'Button' 等，无 N 前缀）——见
// expressionEditorStrategyOptions.spec.ts 文件头对该坑的实测记录。
const componentStubs: Record<string, Component> = {
  Select: ButtonStub,
  Button: ButtonStub,
  Empty: SlotPassthrough,
  Spin: SlotPassthrough,
  Tag: SlotPassthrough,
  Tooltip: SlotPassthrough,
  Popover: SlotPassthrough,
  RadioGroup: SlotPassthrough,
  Radio: SlotPassthrough,
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(initial: ExpressionModel): Promise<{ wrapper: VueWrapper; editor: VueWrapper; current: () => ExpressionModel }> {
  const current = ref<ExpressionModel>(JSON.parse(JSON.stringify(initial)));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
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
  const editor = wrapper.findComponent(ExpressionEditor as any);
  return { wrapper, editor, current: () => current.value };
}

describe('ExpressionEditor 分组后筛选（HAVING）UI 入口已撤除', () => {
  it('聚合+直连列混用（旧判据「可推导分组键」）形状下，having 面板不再渲染', async () => {
    const { wrapper, editor } = await mountEditor(modelHavingEligible(2));
    expect(editor.find('[data-testid="qb-having-panel"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('纯标量聚合（旧判据「不可推导分组键」）形状下，having 面板同样不渲染（本就没有，非新增判据）', async () => {
    const { wrapper, editor } = await mountEditor(modelHavingIneligible(2));
    expect(editor.find('[data-testid="qb-having-panel"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('ExpressionEditor having 存量 round-trip', () => {
  it('schema_version:2 存量文档 + 可推导分组键形状：打开（onMounted 迁移）与 finalize() 均原样保留 having', async () => {
    const original = modelHavingEligible(2);
    const { wrapper, editor, current } = await mountEditor(original);

    // ①打开（onMounted reconcile 迁移路径）：having 段与原始存档深度相等，字节级不丢。
    expect(current().having).toEqual(original.having);

    // ②确认（finalize()）：再走一轮 reconcile 后 having 依旧原样，不因重复调和而丢失/改写。
    const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
    expect(finalized.having).toEqual(original.having);

    wrapper.unmount();
  });

  it('schema_version:1 存量文档 + 可推导分组键形状：打开即升版为 2，having 原样保留（升版与内容调和同批落地）', async () => {
    const original = modelHavingEligible(1);
    const { wrapper, editor, current } = await mountEditor(original);

    expect(current().schema_version).toBe(2);
    expect(current().having).toEqual(original.having);

    const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
    expect(finalized.schema_version).toBe(2);
    expect(finalized.having).toEqual(original.having);

    wrapper.unmount();
  });

  it('回归核心钉子：纯标量聚合（旧判据「不可推导分组键」，旧实现会静默剥离）形状下 having 依然原样保留', async () => {
    const original = modelHavingIneligible(2);
    const { wrapper, editor, current } = await mountEditor(original);

    // 旧实现：havingCandidatesForModel 在此形状下返回 []，reconcile 会 `delete m.having`——
    // 本用例钉住新行为：不再有这条剥离逻辑，having 原样保留。
    expect(current().having).toEqual(original.having);

    const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
    expect(finalized.having).toEqual(original.having);

    wrapper.unmount();
  });

  it('回归核心钉子（schema_version:1 版）：纯标量聚合形状 + 旧版本号，打开升版且 having 不因旧剥离判据丢失', async () => {
    const original = modelHavingIneligible(1);
    const { wrapper, editor, current } = await mountEditor(original);

    expect(current().schema_version).toBe(2);
    expect(current().having).toEqual(original.having);

    const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
    expect(finalized.schema_version).toBe(2);
    expect(finalized.having).toEqual(original.having);

    wrapper.unmount();
  });
});
