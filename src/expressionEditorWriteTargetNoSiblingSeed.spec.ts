import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import SourceTreePicker from './SourceTreePicker.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

/**
 *
 * 本文件验证修复：insert 选定写目标后，source.tables 不再包含目标模板的其他表；取数模式不经过
 * onSelectWriteTarget，不受影响（该函数只在写模式的插入目标选择器上挂载，见 ExpressionEditor.vue
 * `v-if="writeOp === 'insert'"` 分支）。
 *
 * 驱动方式：SourceTreePicker 内部弹层树是异步懒加载（host.fetchTree 缺省时才回落 listTemplates 扁平
 * 分组，且要点开触发按钮才会跑），真去点开、逐级展开、点数据表叶子在 jsdom 下成本高且脆——同
 * expressionEditorChartPick.spec.ts 的既有手法：**不打桩** SourceTreePicker，直接找到真实组件实例
 * 触发它的 `select` emit，等价于"用户在弹层里选好了目标表、点了确定"。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const TARGET_TEMPLATE_ID = 'tpl_inventory';
const TARGET_MAIN = 'dt_inv_main';
const TARGET_DETAIL = 'dt_inv_detail'; // 目标模板的扩展表——不应被自动加入来源。

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
    data_table_id: dataTableId, table_code: dataTableId, table_name: dataTableId, physical_table_name: dataTableId,
    table_role: role, sort_no: 0, field_count: 1, version_no: 1
  };
}
const TARGET_TABLES: TemplateDataTable[] = [table(TARGET_MAIN, 'main'), table(TARGET_DETAIL, 'extension')];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [TARGET_MAIN]: [field('f_flow_no', '流水号')],
  [TARGET_DETAIL]: [field('f_flow_qty', '数量')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === TARGET_TEMPLATE_ID ? TARGET_TABLES : []),
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

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
// 🔴 不打桩 SourceTreePicker——本用例要拿到真实组件实例去触发它的 select emit。
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

async function mountEditor() {
  const current = ref<ExpressionModel>(emptyExpressionModel(REPORT_TEMPLATE_ID));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
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
  const editor = wrapper.findComponent(ExpressionEditor as any);
  return { wrapper, editor, current };
}

describe('写模式选定目标后不再自动附加目标模板其他表', () => {
  it('insert 选「目标模板主表」为写目标后，source.tables 不含该模板的扩展表', async () => {
    const { wrapper, editor, current } = await mountEditor();
    try {
      // 写目标选择器是 :single="true" 的那个 SourceTreePicker 实例（①来源面板另有一个非 single 的）。
      const pickers = editor.findAllComponents(SourceTreePicker as any);
      const targetPicker = pickers.find(p => p.props('single') === true);
      expect(targetPicker).toBeTruthy();

      targetPicker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_MAIN, role: 'main', name: '目标主表' }]);
      await flushMounted();

      expect(current.value.target.target_template_id).toBe(TARGET_TEMPLATE_ID);
      expect(current.value.target.target_data_table_id).toBe(TARGET_MAIN);

      // 核心断言（根因钉点）：不再自动把目标模板的扩展表（TARGET_DETAIL）当来源塞进来。
      const seededSibling = current.value.source.tables.some(t => t.data_table_id === TARGET_DETAIL);
      expect(seededSibling).toBe(false);
      // 目标表本身也不作来源（insert 是写入、不是查询它）——这条是既有行为，顺带钉住不回归。
      const seededTargetItself = current.value.source.tables.some(t => t.data_table_id === TARGET_MAIN && !t.is_context);
      expect(seededTargetItself).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
