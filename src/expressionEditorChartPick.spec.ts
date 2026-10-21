import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import ChartTargetSection from './ChartTargetSection.vue';
import {
  emptyExpressionModel,
  type ChartTargetSpec,
  type ExpressionModel,
  type TemplateDataTable,
  type TemplateField
} from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 * 图表槽位的取值拾取必须与③目标段输出行同款收口。
 *
 * 本文件直接驱动 ChartTargetSection 的 update:modelValue（等价于用户在「系列」槽位里点了一个字段），
 * 断言回写进模型的表达式已是 raw 文本；并以 braces（3.4）语法作反向判据，证明转换只在 V4 语法下发生。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TABLE_ID = 'dt_src';
const CHART_ID = 'chart_1';

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
    field_id: 'fld_line',
    field_code: 'line',
    field_name: '产品线',
    data_type: 'text',
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

/** 带一个 categorySeries/long 图表目标（三槽位皆空）的模型。 */
function modelWithChart(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [
    { alias: 'src1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: SRC_TABLE_ID, is_context: false }
  ];
  m.chart_targets = [
    {
      chart_id: CHART_ID,
      chart_form: 'categorySeries',
      mapping: {
        form: 'categorySeries',
        layout: 'long',
        category: { kind: 'const', value: '' },
        series: { kind: 'const', value: '' },
        value: { kind: 'const', value: '' }
      }
    }
  ];
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
// 🔴 与 expressionEditorStagingPick.spec.ts 的桩表唯一差别：**不打桩 ChartTargetSection**——本用例
// 要拿到它真实的 update:modelValue 通道。
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
  RadioButton: SlotPassthrough,
  Input: SlotPassthrough,
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(syntax: RefSyntax): Promise<{ wrapper: VueWrapper; editor: VueWrapper; current: { value: ExpressionModel } }> {
  const current = ref<ExpressionModel>(modelWithChart());
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

/** 模拟「用户在图表的『系列』槽位里点了来源字段」：ChartTargetSection 把整份 spec 回抛给编辑器。 */
async function pickFieldIntoSeriesSlot(editor: VueWrapper): Promise<void> {
  const section = editor.findComponent(ChartTargetSection as any) as VueWrapper;
  expect(section.exists()).toBe(true);
  const spec = JSON.parse(JSON.stringify(section.props('modelValue'))) as ChartTargetSpec;
  (spec.mapping as { series?: unknown }).series = { kind: 'source_field', alias: 'src1', field_id: 'fld_line' };
  section.vm.$emit('update:modelValue', spec);
  await flushMounted();
}

function seriesExprOf(model: ExpressionModel) {
  const chart = (model.chart_targets ?? []).find(c => c.chart_id === CHART_ID);
  return (chart?.mapping as { series?: { kind?: string; text?: string; field_id?: string } } | undefined)?.series;
}

describe('图表槽位取值拾取的语法收口', () => {
  it('brackets（V4）：结构化拾取值落进模型前转成 raw 文本，不留 source_field', async () => {
    const { wrapper, editor, current } = await mountEditor('brackets');
    await pickFieldIntoSeriesSlot(editor);

    const expr = seriesExprOf(current.value);
    // 核心：不能仍是 source_field——那会被适配层压成 source_text:''，回程空文本 ⇒ 值区不显示却算已设置
    expect(expr?.kind).toBe('raw');
    expect(typeof expr?.text).toBe('string');
    expect(expr?.text).toContain('产品线'); // 打成 [表].[字段] 可读文本
    wrapper.unmount();
  });

  it('braces（3.4）：原样保留结构化拾取值，转换不波及既有调用方', async () => {
    const { wrapper, editor, current } = await mountEditor('braces');
    await pickFieldIntoSeriesSlot(editor);

    const expr = seriesExprOf(current.value);
    expect(expr?.kind).toBe('source_field');
    expect(expr?.field_id).toBe('fld_line');
    wrapper.unmount();
  });
});
