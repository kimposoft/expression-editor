import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

/**
 * 中间模型 schema_version 硬切换：1 → 2 单测。
 *
 * 覆盖两条口径：
 *   ①新建模型（emptyExpressionModel，本就写 2）经编辑器确认（finalize()）后仍是 2——回归守护
 *     ExpressionEditor.vue reconcile() 不会把版本号漏改/写歪；
 *   ②打开 schema_version:1 的存量模型：首轮 reconcile（onMounted 迁移路径，与"条件段关联式→匹配键"
 *     等既有迁移同一收口点）把版本升到 2，且**结构性内容原样保留**（来源表、目标输出不丢）——
 *     证明这是随内容调和一起落地的升版，不是"读到 1 就地改标记、内容仍是旧形状"的半吊子路径。
 *
 * 挂载策略照抄 expressionEditorHaving.spec.ts / expressionEditorPreviewFinalized.spec.ts（真实
 * ExpressionEditor + 桩 host + naive-ui 整体打桩），finalize() 调用方式同 having 用例。
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
  [SOURCE_TABLE_ID]: [field('fld_category', '类别')],
  [TARGET_TABLE_ID]: [field('fld_cat_out', '类别输出')]
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

const directCategory = { kind: 'source_field' as const, alias: 't1', field_id: 'fld_category' };

/** 手写 schema_version:1 的存量模型（不经 emptyExpressionModel，模拟真实旧存档 JSON）：单来源表 +
 *  单一表填充目标 + 一条直连列输出，用于验证「打开 v1」路径既升版又不丢内容。 */
function legacyV1Model(): ExpressionModel {
  return {
    schema_version: 1,
    source: {
      tables: [{ alias: 't1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: SOURCE_TABLE_ID, is_context: false, role: 'main' }],
      joins: []
    },
    target: {
      target_template_id: REPORT_TEMPLATE_ID,
      target_data_table_id: TARGET_TABLE_ID,
      target_table_role: 'detail',
      outputs: [{ target_field_id: 'fld_cat_out', expression: directCategory, fill_strategy: 'overwrite' }]
    },
    distinct: true
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

describe('ExpressionEditor schema_version 硬切换', () => {
  it('新建模型（emptyExpressionModel）确认后 finalize() 仍 emit schema_version=2', async () => {
    const { wrapper, editor } = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID));
    const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
    expect(finalized.schema_version).toBe(2);
    wrapper.unmount();
  });

  it('打开 schema_version:1 的存量模型：首轮 reconcile 即升版为 2，来源表/目标输出原样保留（非半吊子路径）', async () => {
    const { wrapper, editor, current } = await mountEditor(legacyV1Model());

    // ①升版：打开即被 onMounted 迁移路径（与既有"条件段关联式→匹配键"迁移同一收口点）升到 2。
    expect(current().schema_version).toBe(2);

    // ②内容不丢：来源表与目标输出原样保留——证明升版是随结构性调和一起发生的，不是只改了个数字。
    expect(current().source.tables.some(t => t.alias === 't1' && t.data_table_id === SOURCE_TABLE_ID)).toBe(true);
    const outputs = current().targets?.[0]?.outputs ?? current().target.outputs;
    expect(outputs.map(o => o.target_field_id)).toEqual(['fld_cat_out']);
    expect(outputs[0].expression).toEqual(directCategory);

    // ③确认（finalize）产物同样是 2，不会因为再走一轮调和又掉回 1。
    const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
    expect(finalized.schema_version).toBe(2);

    wrapper.unmount();
  });
});
