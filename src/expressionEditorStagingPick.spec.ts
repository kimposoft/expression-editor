import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import StagingTargetSection from './StagingTargetSection.vue';
import { emptyExpressionModel, type ExpressionModel, type TargetSpec, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 * 暂存列的取值拾取必须与③目标段输出行同款收口。
 *
 * 本文件直接驱动 StagingTargetSection 的 update:modelValue（等价于用户在暂存列取值格里点了一个
 * 字段），断言回写进模型的表达式已是 raw 文本；并以 braces（3.4）语法作反向判据，证明转换只在
 * V4 语法下发生、没有波及 3.4 既有调用方。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TABLE_ID = 'dt_src';

const HOST_TABLES: TemplateDataTable[] = [
  {
    data_table_id: SRC_TABLE_ID,
    table_code: SRC_TABLE_ID,
    table_name: '出库单的主表',
    physical_table_name: SRC_TABLE_ID,
    table_role: 'main',
    sort_no: 1,
    field_count: 1,
    version_no: 1
  }
];
const HOST_FIELDS: TemplateField[] = [
  {
    field_id: 'fld_qty',
    field_code: 'qty',
    field_name: '数量',
    data_type: 'number',
    display_style: 'text',
    sort_no: 0,
    is_searchable: true,
    is_filterable: true,
    is_sortable: true,
    is_list_visible: true
  }
];

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async () => HOST_FIELDS,
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** 带一个暂存目标（一列，列名已填、取值待配）的模型：3.4 侧暂存目标以 target_kind='staging' 承载。 */
function modelWithStaging(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [
    { alias: 'src1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: SRC_TABLE_ID, is_context: false }
  ];
  m.targets = [
    { target_template_id: '', target_data_table_id: '', target_kind: 'staging', outputs: [{ target_field_id: 'qty_total', expression: { kind: 'const', value: '' } }] }
  ];
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
const componentStubs: Record<string, Component> = {
  Select: SlotPassthrough,
  Button: SlotPassthrough,
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
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

/** 挂 ExpressionEditor（真实 StagingTargetSection，不打桩——本用例要拿到它的 emit 通道）。 */
async function mountEditor(syntax: RefSyntax): Promise<{ wrapper: VueWrapper; editor: VueWrapper; current: { value: ExpressionModel } }> {
  const current = ref<ExpressionModel>(modelWithStaging());
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
  return { wrapper, editor: wrapper.findComponent(ExpressionEditor as any), current };
}

/** 模拟「用户在暂存列的取值格里点了来源字段」：StagingTargetSection 把整份 spec 回抛给编辑器。 */
async function pickFieldIntoStagingColumn(editor: VueWrapper): Promise<void> {
  const section = editor.findComponent(StagingTargetSection as any) as VueWrapper;
  expect(section.exists()).toBe(true);
  const spec = JSON.parse(JSON.stringify(section.props('modelValue'))) as TargetSpec;
  spec.outputs[0]!.expression = { kind: 'source_field', alias: 'src1', field_id: 'fld_qty' };
  section.vm.$emit('update:modelValue', spec);
  await flushMounted();
}

function stagingExprOf(model: ExpressionModel) {
  return (model.targets ?? []).find(t => t.target_kind === 'staging')?.outputs[0]?.expression;
}

describe('暂存列取值拾取的语法收口', () => {
  it('brackets（V4）：结构化拾取值落进模型前转成 raw 文本，不留 source_field', async () => {
    const { wrapper, editor, current } = await mountEditor('brackets');
    await pickFieldIntoStagingColumn(editor);

    const expr = stagingExprOf(current.value);
    expect(expr?.kind).toBe('raw'); // 核心：不能仍是 source_field（适配层会压成 source_text:''）
    expect(typeof expr?.text).toBe('string');
    expect(expr?.text).toContain('数量'); // 打成 [表].[字段] 可读文本
    wrapper.unmount();
  });

  it('braces（3.4）：原样保留结构化拾取值，转换不波及既有调用方', async () => {
    const { wrapper, editor, current } = await mountEditor('braces');
    await pickFieldIntoStagingColumn(editor);

    const expr = stagingExprOf(current.value);
    expect(expr?.kind).toBe('source_field');
    expect(expr?.field_id).toBe('fld_qty');
    wrapper.unmount();
  });
});
