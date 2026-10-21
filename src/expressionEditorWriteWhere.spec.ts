import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ConditionGroup, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';


const REPORT_TEMPLATE_ID = 'tpl_report';

function field(fieldId: string, name = fieldId): TemplateField {
  return {
    field_id: fieldId, field_code: fieldId, field_name: name, data_type: 'text', display_style: 'text',
    sort_no: 0, is_searchable: true, is_filterable: true, is_sortable: true, is_list_visible: true
  };
}
function table(dataTableId: string, role: 'main' | 'extension'): TemplateDataTable {
  return {
    data_table_id: dataTableId, table_code: dataTableId, table_name: dataTableId, physical_table_name: dataTableId,
    table_role: role, sort_no: 0, field_count: 1, version_no: 1
  };
}
const HOST_TABLES: TemplateDataTable[] = [table('dt_main', 'main')];
const HOST_FIELDS: Record<string, TemplateField[]> = { dt_main: [field('f_1')] };

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

/** 写模式（update/delete）模型：已选目标别名 t1（唯一显式来源，恒不触发 unlinkedAliases）；
 *  update 额外携带一条字段映射（delete 结构上不允许 outputs，故 op='delete' 时不种 outputs）。
 *  where 由参数控制，undefined＝未配置（对齐真实"新建写动作，尚未打开②面板配置过"的初始形态）。 */
function writeModel(operation: 'update' | 'delete' | 'insert', where?: ConditionGroup): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source = {
    tables: [
      { alias: 't1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: 'dt_main', is_context: false, role: 'main' }
    ],
    joins: []
  };
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: 'dt_main',
    target_table_role: 'main',
    operation,
    outputs: operation === 'update' ? [{ target_field_id: 'f_1', expression: { kind: 'const', value: 'new-value' } }] : []
  };
  if (operation !== 'insert') m.target.target_alias = 't1';
  if (where) m.where = where;
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
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough, NButton: ButtonStub, NEmpty: SlotPassthrough, NSpin: SlotPassthrough, NTag: SlotPassthrough,
  NTooltip: SlotPassthrough, NPopover: SlotPassthrough, NRadioGroup: SlotPassthrough, NRadio: SlotPassthrough,
  SourceTreePicker: SlotPassthrough, JoinSettingsPanel: SlotPassthrough, ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough, ChartTargetSection: SlotPassthrough, StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(initial: ExpressionModel, writeOperation: 'update' | 'delete' | 'insert') {
  const Harness = defineComponent({
    setup(_props, { expose }) {
      provideExpressionHost(makeHost());
      const current = ref<ExpressionModel>(JSON.parse(JSON.stringify(initial)));
      expose({ getModel: () => current.value });
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              writeOperation,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  // update:validity / write-where 提示 DOM 都挂在内层 ExpressionEditor 组件上，外层 Harness 不会
  // 重新转发子组件 emit——断言须对 findComponent 取到的子组件 wrapper 取，同 expressionEditorLayout.spec.ts
  // 既有写法（mounted.editor），不是对外层 wrapper 取。
  const editor = wrapper.findComponent(ExpressionEditor as any);
  return { wrapper, editor };
}

const EMPTY_WHERE_SHAPES: Array<{ label: string; where: ConditionGroup | undefined }> = [
  { label: '未配置（undefined）', where: undefined },
  { label: '空 items', where: { logic: 'and', items: [] } },
  { label: '仅含一个空子组', where: { logic: 'and', items: [{ group: { logic: 'and', items: [] } }] } }
];

describe('ExpressionEditor 写模式定位条件判空——撤销 W1，空条件不阻断', () => {
  for (const shape of EMPTY_WHERE_SHAPES) {
    it(`update + where ${shape.label} → update:validity 发 true，不展示「缺失」提示`, async () => {
      const { wrapper, editor } = await mountEditor(writeModel('update', shape.where), 'update');
      expect(editor.emitted('update:validity')?.at(-1)).toEqual([true]);
      expect(editor.find('[data-testid="write-where-required-hint"]').exists()).toBe(false);
      wrapper.unmount();
    });
  }

  it('delete + where 未配置 → update:validity 发 true，不展示提示（delete 无 outputs，仅定位条件）', async () => {
    const { wrapper, editor } = await mountEditor(writeModel('delete', undefined), 'delete');
    expect(editor.emitted('update:validity')?.at(-1)).toEqual([true]);
    expect(editor.find('[data-testid="write-where-required-hint"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('update + where 含一条真实谓词 → update:validity 发 true，不展示提示', async () => {
    const where: ConditionGroup = {
      logic: 'and',
      items: [{ predicate: { left: { kind: 'source_field', alias: 't1', field_id: 'f_1' }, op: 'eq', right: { kind: 'const', value: 1 } } }]
    };
    const { wrapper, editor } = await mountEditor(writeModel('update', where), 'update');
    expect(editor.emitted('update:validity')?.at(-1)).toEqual([true]);
    expect(editor.find('[data-testid="write-where-required-hint"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('insert + where 未配置 → 不拦（insert 不使用定位条件，target_alias 亦不涉及）', async () => {
    const { wrapper, editor } = await mountEditor(writeModel('insert', undefined), 'insert');
    expect(editor.emitted('update:validity')?.at(-1)).toEqual([true]);
    expect(editor.find('[data-testid="write-where-required-hint"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
