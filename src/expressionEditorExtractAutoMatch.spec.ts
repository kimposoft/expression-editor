import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type OutputMapping, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 * 取数模式「按名称填充」两处修复钉（demo 采购入库单值变动动作：提示「已匹配 4 个字段」却无任何填充）：
 *
 * ① brackets（V4）语法下命中值须落成 raw 文本（[表].[字段]），不得留结构化 source_field——V4 壳每次
 *   update 都经适配层 valueRefToV4Expression 往返，它只认文本，结构化引用会被压成空串（此前仅写模式
 *   过 pickedRefForSyntax，取数模式漏了）。braces（3.4）下仍保留结构化引用。
 * ② V4 往返回来的空文本行 {kind:'raw', text:'', text_source:{text:''}} 属「未配置」，按名称填充须照常
 *   填入（此前判据用 isEmptyExpr 把它当已配置整行跳过）；真正已配置的行仍不覆盖。
 */

const TEMPLATE_ID = 'tpl_report';
const SRC_TABLE_ID = 'dt_src';
const TARGET_TABLE_ID = 'dt_target';
const F_BY_CODE = 'f_by_code'; // field_code 与来源字段相同、目标行尚不存在
const F_EMPTY_RAW = 'f_empty_raw'; // field_name 与来源字段相同、目标行是 V4 往返空文本
const F_CONFIGURED = 'f_configured'; // 同名可命中，但已配置——不得覆盖
const F_OTHER = 'f_other'; // 无同名来源字段

function makeField(fieldId: string, code: string, name: string): TemplateField {
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

const HOST_TABLES: TemplateDataTable[] = [
  {
    data_table_id: SRC_TABLE_ID,
    table_code: SRC_TABLE_ID,
    table_name: '采购订单采购明细',
    physical_table_name: SRC_TABLE_ID,
    table_role: 'main',
    sort_no: 0,
    field_count: 3,
    version_no: 1
  },
  {
    data_table_id: TARGET_TABLE_ID,
    table_code: TARGET_TABLE_ID,
    table_name: '采购入库单入库明细',
    physical_table_name: TARGET_TABLE_ID,
    table_role: 'main',
    sort_no: 1,
    field_count: 4,
    version_no: 1
  }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [SRC_TABLE_ID]: [makeField('src_goods', 'goods', '货品'), makeField('src_price', 'src_price_code', '采购价'), makeField('src_spec', 'spec', '规格')],
  [TARGET_TABLE_ID]: [
    makeField(F_BY_CODE, 'goods', '货品名'),
    makeField(F_EMPTY_RAW, 'tgt_price_code', '采购价'),
    makeField(F_CONFIGURED, 'spec', '规格'),
    makeField(F_OTHER, 'other', '序号')
  ]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === TEMPLATE_ID ? HOST_TABLES : []),
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

/** 取数模式模型：单一表目标，预置 V4 往返空文本行与已配置行。 */
function extractModel(): ExpressionModel {
  const m = emptyExpressionModel(TEMPLATE_ID);
  m.source.tables = [{ alias: 'src1', source_type: 'template', template_id: TEMPLATE_ID, data_table_id: SRC_TABLE_ID, is_context: false }];
  const outputs: OutputMapping[] = [
    { target_field_id: F_EMPTY_RAW, expression: { kind: 'raw', text: '', text_source: { text: '' } }, fill_strategy: 'overwrite', separator: ',' },
    { target_field_id: F_CONFIGURED, expression: { kind: 'raw', text: '既有值' }, fill_strategy: 'overwrite', separator: ',' }
  ];
  const target = { target_template_id: TEMPLATE_ID, target_data_table_id: TARGET_TABLE_ID, target_table_role: 'main' as const, outputs };
  m.target = target;
  m.targets = [target];
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
/** NButton 桩成原生 button 并透传 attrs（含 class），能按 .auto-match-btn 定位并真点。 */
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
// 桩集照抄 expressionEditorWriteAutoMatchDedupe.spec.ts。
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: ButtonStub,
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
  ConditionEditorDialog: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  AdvancedExpressionDialog: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountAndAutoMatch(syntax: RefSyntax): Promise<{ wrapper: VueWrapper; outputOf: (fieldId: string) => OutputMapping | undefined }> {
  const current = ref<ExpressionModel>(extractModel());
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax(syntax);
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: TEMPLATE_ID,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  const btn = wrapper.find('button.auto-match-btn');
  expect(btn.exists()).toBe(true);
  await btn.trigger('click');
  await flushMounted();
  const outputOf = (fieldId: string) =>
    (current.value.targets ?? [current.value.target]).find(t => t.target_data_table_id === TARGET_TABLE_ID)?.outputs.find(o => o.target_field_id === fieldId);
  return { wrapper, outputOf };
}

describe('取数模式「按名称填充」', () => {
  it('brackets（V4）：命中值落成 raw 文本，不留结构化 source_field', async () => {
    const { wrapper, outputOf } = await mountAndAutoMatch('brackets');
    try {
      expect(outputOf(F_BY_CODE)?.expression).toEqual({ kind: 'raw', text: '[采购订单采购明细].[货品]' });
      // 取数模式新建行保留填充策略默认值。
      expect(outputOf(F_BY_CODE)?.fill_strategy).toBe('overwrite');
    } finally {
      wrapper.unmount();
    }
  });

  it('V4 往返空文本行视为未配置，照常填入；已配置行不覆盖；无同名不生成行', async () => {
    const { wrapper, outputOf } = await mountAndAutoMatch('brackets');
    try {
      expect(outputOf(F_EMPTY_RAW)?.expression).toEqual({ kind: 'raw', text: '[采购订单采购明细].[采购价]' });
      expect(outputOf(F_CONFIGURED)?.expression).toEqual({ kind: 'raw', text: '既有值' });
      expect(outputOf(F_OTHER)).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it('braces（3.4）：保留结构化 source_field', async () => {
    const { wrapper, outputOf } = await mountAndAutoMatch('braces');
    try {
      expect(outputOf(F_BY_CODE)?.expression).toEqual({ kind: 'source_field', alias: 'src1', field_id: 'src_goods' });
    } finally {
      wrapper.unmount();
    }
  });
});
