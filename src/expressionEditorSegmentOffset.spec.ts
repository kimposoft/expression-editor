import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';


const TEMPLATE_ID = 'tpl_report';
const TARGET_TABLE_ID = 'dt_target';

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
    data_table_id: TARGET_TABLE_ID,
    table_code: TARGET_TABLE_ID,
    table_name: '出库流水扩展表',
    physical_table_name: TARGET_TABLE_ID,
    table_role: 'extension',
    sort_no: 0,
    field_count: 1,
    version_no: 1
  }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [TARGET_TABLE_ID]: [field('f1', '第一字段')]
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

/** 写模式（insert）模型：写目标已选定，来源/条件均为空——本文件只关心分段序号数字，不关心内容。 */
function writeModel(): ExpressionModel {
  const m = emptyExpressionModel(TEMPLATE_ID);
  m.target = {
    target_template_id: TEMPLATE_ID,
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
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(opts: { writeOperation?: 'insert' | 'delete'; segmentOffset?: number }): Promise<VueWrapper> {
  const current = ref<ExpressionModel>(opts.writeOperation ? writeModel() : emptyExpressionModel(TEMPLATE_ID));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: TEMPLATE_ID,
              writeOperation: opts.writeOperation,
              segmentOffset: opts.segmentOffset,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  return wrapper;
}

/** 取某分段面板圆圈显示的数字。 */
function segN(wrapper: VueWrapper, testId: string): string {
  const el = wrapper.find(`[data-testid="${testId}"] .seg-n`);
  expect(el.exists(), `${testId} .seg-n should exist`).toBe(true);
  return el.text();
}

describe('分段编号偏移 segmentOffset', () => {
  it('取数模式：默认（不传）编号 1/2/3', async () => {
    const wrapper = await mountEditor({});
    expect(segN(wrapper, 'qb-source-panel')).toBe('1');
    expect(segN(wrapper, 'qb-condition-panel')).toBe('2');
    expect(wrapper.find('.qb-right .seg-n').text()).toBe('3');
    wrapper.unmount();
  });

  it('取数模式：segmentOffset=5 → 编号整体平移为 6/7/8', async () => {
    const wrapper = await mountEditor({ segmentOffset: 5 });
    expect(segN(wrapper, 'qb-source-panel')).toBe('6');
    expect(segN(wrapper, 'qb-condition-panel')).toBe('7');
    expect(wrapper.find('.qb-right .seg-n').text()).toBe('8');
    wrapper.unmount();
  });

  it('写模式（insert）：默认（不传）编号 1/2/3/4（①目标/②来源/③条件/④字段赋值）', async () => {
    const wrapper = await mountEditor({ writeOperation: 'insert' });
    expect(segN(wrapper, 'qb-write-target-panel')).toBe('1');
    expect(segN(wrapper, 'qb-source-panel')).toBe('2');
    expect(segN(wrapper, 'qb-condition-panel')).toBe('3');
    expect(wrapper.find('.qb-right .seg-n').text()).toBe('4');
    wrapper.unmount();
  });

  it('写模式（insert）：segmentOffset=10 → 编号整体平移为 11/12/13/14', async () => {
    const wrapper = await mountEditor({ writeOperation: 'insert', segmentOffset: 10 });
    expect(segN(wrapper, 'qb-write-target-panel')).toBe('11');
    expect(segN(wrapper, 'qb-source-panel')).toBe('12');
    expect(segN(wrapper, 'qb-condition-panel')).toBe('13');
    expect(wrapper.find('.qb-right .seg-n').text()).toBe('14');
    wrapper.unmount();
  });

  it('写模式（delete）：右栏定位条件复用同一 qb-condition-panel testid，编号仍按 isWriteMode?3:2 口径 + 偏移', async () => {
    const wrapper = await mountEditor({ writeOperation: 'delete', segmentOffset: 1 });
    expect(segN(wrapper, 'qb-write-target-panel')).toBe('2'); // segNo(1)
    expect(segN(wrapper, 'qb-source-panel')).toBe('3'); // segNo(isWriteMode?2:1)=segNo(2)
    expect(segN(wrapper, 'qb-condition-panel')).toBe('4'); // 右栏定位条件，segNo(isWriteMode?3:2)=segNo(3)
    wrapper.unmount();
  });
});
