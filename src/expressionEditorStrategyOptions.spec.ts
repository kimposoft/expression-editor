import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

/**
 * 填充策略下拉按目标字段类型隐藏「追加」「合并」单测。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const TARGET_TABLE_ID = 'dt_target';

/** 构造一个测试字段；controlType 缺省=undefined（对应真实数据里"未配置控件类型"的常见形态）。 */
function field(fieldId: string, dataType: string, controlType?: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: fieldId,
    field_name: fieldId,
    data_type: dataType,
    control_type: controlType,
    display_style: 'text',
    sort_no: 0,
    is_searchable: true,
    is_filterable: true,
    is_sortable: true,
    is_list_visible: true
  };
}

function table(dataTableId: string): TemplateDataTable {
  return {
    data_table_id: dataTableId,
    table_code: dataTableId,
    table_name: dataTableId,
    physical_table_name: dataTableId,
    table_role: 'extension',
    sort_no: 1,
    field_count: 7,
    version_no: 1
  };
}

const HOST_TABLES: TemplateDataTable[] = [table(TARGET_TABLE_ID)];
// 覆盖 G6 判据的全部触发面：date/datetime/boolean 三个 data_type + radio/select 两个 control_type
// （control_type 挂在 data_type='text' 的字段上，证明按 control_type 命中与 data_type 命中相互独立）；
// text/number 两个反向判据字段（均不命中，验证过滤不误伤正常类型）。
const HOST_FIELDS: TemplateField[] = [
  field('f_text', 'text'),
  field('f_number', 'number'),
  field('f_date', 'date'),
  field('f_datetime', 'datetime'),
  field('f_boolean', 'boolean'),
  field('f_radio', 'text', 'radio'),
  field('f_select', 'text', 'select')
];

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => (dataTableId === TARGET_TABLE_ID ? HOST_FIELDS : []),
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** 目标表模型：一个扩展表目标，f_date 预置存量 fill_strategy='append'（模拟"规则生效前已保存的配置/
 *  脏数据"），其余字段无输出行（outputForIn 缺省 'overwrite'）。 */
function modelWithTarget(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.targets = [
    {
      target_template_id: REPORT_TEMPLATE_ID,
      target_data_table_id: TARGET_TABLE_ID,
      target_table_role: 'detail',
      outputs: [{ target_field_id: 'f_date', expression: { kind: 'const', value: 'x' }, fill_strategy: 'append' }]
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
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
/** NSelect 记录型桩：见文件头注释——options/value 声明为组件 props，避免数组被 DOM 序列化丢失；
 *  data-testid 等其余属性未声明，走默认 fallthrough 落到根节点。不模拟用户交互（不 emit
 *  update:value），本文件只断言"下拉收到了哪些选项"，不驱动选择流程。 */
const SelectRecorderStub = defineComponent({
  props: { options: { type: Array, default: () => [] }, value: { default: null } },
  emits: ['update:value'],
  setup() {
    return () => h('div', { class: 'select-recorder-stub' });
  }
});
// 🔴 桩键名必须是组件**内部注册名**，不是本文件 import 时用的 N 前缀别名——naive-ui 组件的
// `name` 选项本身不带 N 前缀（N 前缀只是包导出层的别名，如 `export { default as NSelect } from
// './Select'` 而 Select.mjs 内部 `name: 'Select'`），vue-test-utils 的 stubs 按 vnode 的
// `type.name` 匹配；实测过用 'NSelect'/'NButton' 当键完全不命中，
// 桩组件从未被使用、渲染出的是真实 naive-ui 组件。此坑另两份参照文件
// （expressionEditorWriteWhere.spec.ts / expressionEditorMainTargetRowMatch.spec.ts）同样踩了
// 但未暴露——它们的断言不依赖这些桩是否真的生效（只读跨组件的 model/emit，不读被误当桩替换的
// naive-ui 组件内部）。本文件的断言依赖 NSelect 收到的 options，必须用真正命中的键名。
// 自定义包内组件（SourceTreePicker 等）走 Vue SFC 编译期自动推断的 __name（=文件名，无 N 前缀），
// 与本文件 import 时的名字一致，不受此坑影响。
const componentStubs: Record<string, Component> = {
  Select: SelectRecorderStub,
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

async function mountEditor(initial: ExpressionModel): Promise<{ wrapper: VueWrapper; editor: VueWrapper }> {
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      const current = ref<ExpressionModel>(JSON.parse(JSON.stringify(initial)));
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
  // 断言目标挂在内层 ExpressionEditor 组件的子组件树上（同 expressionEditorWriteWhere.spec.ts 既有写法）。
  const editor = wrapper.findComponent(ExpressionEditor as any);
  return { wrapper, editor };
}

/** 按 fieldId 取该行策略下拉桩组件的 wrapper；找不到（该行尚未渲染）时返回 undefined，让调用方
 *  显式对"前置条件是否满足"断言，不把"找不到"悄悄坍缩成"选项为空数组"两种不同情形。 */
function findStrategySelect(editor: VueWrapper, fieldId: string): VueWrapper | undefined {
  const selects = editor.findAllComponents(SelectRecorderStub as any) as VueWrapper[];
  return selects.find(w => w.attributes('data-testid') === `target-strategy-select-${fieldId}`);
}

describe('ExpressionEditor 填充策略下拉按目标字段类型隐藏追加/合并', () => {
  it('text 字段：合并出现、追加不再提供（V4 规格），覆盖保留', async () => {
    const { wrapper, editor } = await mountEditor(modelWithTarget());
    const select = findStrategySelect(editor, 'f_text');
    expect(select).toBeTruthy();
    const values = (select!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(values).not.toContain('append');
    expect(values).toContain('merge');
    expect(values).toContain('overwrite');
    wrapper.unmount();
  });

  it('number 字段：合并出现、追加不再提供（反向判据，覆盖数值型不受 G6 限制）', async () => {
    const { wrapper, editor } = await mountEditor(modelWithTarget());
    const select = findStrategySelect(editor, 'f_number');
    const values = (select!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(values).not.toContain('append');
    expect(values).toContain('merge');
    wrapper.unmount();
  });

  it('datetime 字段：追加/合并均不出现，覆盖仍保留（G6 data_type 命中）', async () => {
    const { wrapper, editor } = await mountEditor(modelWithTarget());
    const select = findStrategySelect(editor, 'f_datetime');
    const values = (select!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(values).not.toContain('append');
    expect(values).not.toContain('merge');
    expect(values).toContain('overwrite');
    wrapper.unmount();
  });

  it('boolean 字段：追加/合并均不出现（G6 data_type 命中）', async () => {
    const { wrapper, editor } = await mountEditor(modelWithTarget());
    const select = findStrategySelect(editor, 'f_boolean');
    const values = (select!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(values).not.toContain('append');
    expect(values).not.toContain('merge');
    wrapper.unmount();
  });

  it('control_type=radio 字段（data_type=text）：追加/合并均不出现（G6 control_type 命中，与 data_type 判据相互独立）', async () => {
    const { wrapper, editor } = await mountEditor(modelWithTarget());
    const select = findStrategySelect(editor, 'f_radio');
    const values = (select!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(values).not.toContain('append');
    expect(values).not.toContain('merge');
    wrapper.unmount();
  });

  it('control_type=select 字段（data_type=text）：追加/合并均不出现（G6 control_type 命中）', async () => {
    const { wrapper, editor } = await mountEditor(modelWithTarget());
    const select = findStrategySelect(editor, 'f_select');
    const values = (select!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(values).not.toContain('append');
    expect(values).not.toContain('merge');
    wrapper.unmount();
  });

  it('date 字段已存量选中 append：选项列表保留 append 可见（不静默改写），但未选中的 merge 仍不出现', async () => {
    const { wrapper, editor } = await mountEditor(modelWithTarget());
    const select = findStrategySelect(editor, 'f_date');
    expect(select).toBeTruthy();
    // 先核验挂载确实带上了种子模型里的存量选中值，防止"选项恰好都不含 append"这类假阳性。
    expect(select!.props('value')).toBe('append');
    const values = (select!.props('options') as Array<{ value: string }>).map(o => o.value);
    expect(values).toContain('append');
    expect(values).not.toContain('merge');
    wrapper.unmount();
  });
});
