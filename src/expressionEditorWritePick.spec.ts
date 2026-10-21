import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import QuickFieldPicker from './QuickFieldPicker.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 *
 * ①赋值行经 ⊞ 快捷字段选择器点字段后插不进去——根因是 setWriteOutputExpr/setParentValue
 * 直接 `o.expression = v`，没有像取数 setOutputExprIn 那样先过 pickedRefForSyntax 把结构化
 * {kind:'source_field',...} 转成 V4（brackets）文本节点；插件 surface 往返（v4/writeModelAdapter.ts
 * valueRefToV4Expression 只认 text_source.text ?? text）把结构化 ref 压成空文本，表现为"插不进去"。
 *
 * ②经 ƒ 表达式弹窗设值后行上出现一枚独立的「取消」按钮，而取数③目标段没有这个按钮、
 * 用 ExpressionInput 恒驻的 ✕（data-testid="expr-clear"）清空——旧按钮已撤下，写行「已配置」/.filled
 * 改用 isFieldConfigured（isUnconfiguredOutputExpr 口径），✕ 清空落回未配置占位、行仍保留，与③目标行
 * 同语义。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TABLE_ID = 'dt_src';
const TARGET_TABLE_ID = 'dt_target';
const F1 = 'f_first';
const F2 = 'f_second';

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
  {
    data_table_id: SRC_TABLE_ID,
    table_code: SRC_TABLE_ID,
    table_name: '出库单的主表',
    physical_table_name: SRC_TABLE_ID,
    table_role: 'main',
    sort_no: 0,
    field_count: 1,
    version_no: 1
  },
  {
    // table_role: 'extension' → tableRoleOf 判定 'detail'，用于打开「父记录锚定」区块（writeTargetIsDetail）。
    data_table_id: TARGET_TABLE_ID,
    table_code: TARGET_TABLE_ID,
    table_name: '出库流水扩展表',
    physical_table_name: TARGET_TABLE_ID,
    table_role: 'extension',
    sort_no: 1,
    field_count: 2,
    version_no: 1
  }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [SRC_TABLE_ID]: [field('fld_qty', '数量')],
  [TARGET_TABLE_ID]: [field(F1, '第一字段'), field(F2, '第二字段')]
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

function modelWithWriteTarget(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [
    { alias: 'src1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: SRC_TABLE_ID, is_context: false }
  ];
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: TARGET_TABLE_ID,
    target_table_role: 'detail',
    operation: 'insert',
    outputs: []
  };
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
/** NButton 桩成原生 button 并透传 attrs：✕ 的 @click.stop 与 data-testid 都落在 button 上，能真点。 */
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
// 🔴 与 targetRowFilledState.spec.ts 的唯一差别：不桩 QuickFieldPicker——本用例要拿到它真实的
// pick emit（等价于"用户在 ⊞ 快捷选择器里点了字段"）。ExpressionInput 同样不桩，才能验证
// :ref="setExprInputRef" / @quick-pick-close 这套接线确有其效。
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

async function mountEditor(syntax: RefSyntax): Promise<{ wrapper: VueWrapper; current: { value: ExpressionModel } }> {
  const current = ref<ExpressionModel>(modelWithWriteTarget());
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

function writeRow(wrapper: VueWrapper, fieldId: string) {
  const r = wrapper.find(`[data-testid="expression-write-target-row-${fieldId}"]`);
  expect(r.exists(), `write target row ${fieldId} should render`).toBe(true);
  return r;
}

/** 在给定容器内找到真实 QuickFieldPicker 实例并触发其 pick emit（等价"用户点了来源字段"）。 */
async function pickInto(container: VueWrapper, ref: { kind: 'source_field'; alias: string; field_id: string }): Promise<void> {
  const qfp = container.findComponent(QuickFieldPicker as any);
  expect(qfp.exists(), 'QuickFieldPicker should be mounted inside the row').toBe(true);
  qfp.vm.$emit('pick', ref);
  await flushMounted();
}

describe('写模式赋值行 ⊞ 拾取 / ✕ 清空同③目标段一致', () => {
  it('A：brackets（V4）赋值行经 QuickFieldPicker pick 插入 → 落盘 raw 文本，不留 source_field', async () => {
    const { wrapper, current } = await mountEditor('brackets');
    try {
      await pickInto(writeRow(wrapper, F1), { kind: 'source_field', alias: 'src1', field_id: 'fld_qty' });

      const out = current.value.target.outputs.find(o => o.target_field_id === F1);
      expect(out).toBeDefined();
      expect(out!.expression.kind).toBe('raw'); // 核心：不能仍是 source_field（适配层会压成 source_text:''）
      expect(typeof out!.expression.text).toBe('string');
      expect(out!.expression.text).toContain('数量'); // 打成 [表].[字段] 可读文本
    } finally {
      wrapper.unmount();
    }
  });

  it('braces（3.4）：原样保留结构化拾取值，转换不波及既有调用方', async () => {
    const { wrapper, current } = await mountEditor('braces');
    try {
      await pickInto(writeRow(wrapper, F1), { kind: 'source_field', alias: 'src1', field_id: 'fld_qty' });

      const out = current.value.target.outputs.find(o => o.target_field_id === F1);
      expect(out?.expression.kind).toBe('source_field');
      expect(out?.expression.field_id).toBe('fld_qty');
    } finally {
      wrapper.unmount();
    }
  });

  it('C：✕ 清空后行回落未配置占位、.filled 消失、行仍保留', async () => {
    const { wrapper, current } = await mountEditor('brackets');
    try {
      await pickInto(writeRow(wrapper, F1), { kind: 'source_field', alias: 'src1', field_id: 'fld_qty' });
      expect(writeRow(wrapper, F1).classes()).toContain('filled');

      const clearBtn = writeRow(wrapper, F1).find('[data-testid="expr-clear"]');
      expect(clearBtn.exists()).toBe(true);
      await clearBtn.trigger('click');
      await flushMounted();

      expect(writeRow(wrapper, F1).classes()).not.toContain('filled');
      const out = current.value.target.outputs.find(o => o.target_field_id === F1);
      expect(out).toBeDefined(); // 行仍在（与③目标行同语义，不整行摘除）
      expect(out!.expression).toEqual({ kind: 'const' }); // 落回「不填充」占位态，不是空字符串常量
    } finally {
      wrapper.unmount();
    }
  });

  it('D：模板里不再存在旧的「取消」按钮', async () => {
    const { wrapper } = await mountEditor('brackets');
    try {
      await pickInto(writeRow(wrapper, F1), { kind: 'source_field', alias: 'src1', field_id: 'fld_qty' });
      expect(wrapper.find('.w-unmap').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('E：插入后自动跳到下一行（activeFieldKey/row-active 联动，钉 setExprInputRef 接线生效）+ ⊞ 面板层叠向下续弹', async () => {
    const { wrapper } = await mountEditor('brackets');
    try {
      expect(writeRow(wrapper, F2).classes()).not.toContain('row-active');
      // 先触发一次真实点击（带坐标）打开第一行 ⊞ 面板，记为「上次弹出点」——不然 pickInto 直接找
      // QuickFieldPicker 发 pick 会绕过 onTargetRowClick，测不到层叠续弹（无上次记录即回落旧行为）。
      await writeRow(wrapper, F1).trigger('click', { clientX: 300, clientY: 200 });
      await pickInto(writeRow(wrapper, F1), { kind: 'source_field', alias: 'src1', field_id: 'fld_qty' });
      expect(writeRow(wrapper, F2).classes()).toContain('row-active');
      // 下一行 ⊞ 面板续弹坐标 = 上次弹出点 + 行高偏移；jsdom 无真实布局（getBoundingClientRect 恒 0），
      // 落到 ExpressionEditor.measureNextRowStep 的常量回落 36px（TARGET_ROW_STEP_FALLBACK）。
      const qfpNext = writeRow(wrapper, F2).findComponent(QuickFieldPicker as any);
      expect(qfpNext.props('x')).toBe(300);
      expect(qfpNext.props('y')).toBe(200 + 36);
    } finally {
      wrapper.unmount();
    }
  });
});
