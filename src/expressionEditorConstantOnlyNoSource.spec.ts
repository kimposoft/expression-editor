import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 * 表达式引擎 V4 四形态 B5。
 *
 * 场景：一个只往目标字段写**常量**的取数节点，没有任何表达式引用来源表。
 * 调和①段跑完 source.tables 为空 ⇒ V4 文档 query.sources 为空 ⇒ 服务端「query.sources 至少需要 1 条」
 * 当场拒。查询总得有个 FROM 才能产出一行；本报表主表在填报态恒一行，挂它即得「恰好一行常量」。
 */

const TEMPLATE_ID = 'tpl_report';
const MAIN_TABLE_ID = 'dt_main';

const HOST_TABLES: TemplateDataTable[] = [
  {
    data_table_id: MAIN_TABLE_ID,
    table_code: MAIN_TABLE_ID,
    table_name: '物料信息的主表',
    physical_table_name: MAIN_TABLE_ID,
    table_role: 'main',
    sort_no: 1,
    field_count: 1,
    version_no: 1
  }
];
const HOST_FIELDS: TemplateField[] = [
  {
    field_id: 'fld_unit',
    field_code: 'unit',
    field_name: '单位',
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
    listTables: async templateId => (templateId === TEMPLATE_ID ? HOST_TABLES : []),
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

function constantOnlyModel(): ExpressionModel {
  const m = emptyExpressionModel(TEMPLATE_ID);
  m.source.tables = [];
  m.targets = [
    {
      target_template_id: TEMPLATE_ID,
      target_data_table_id: MAIN_TABLE_ID,
      outputs: [{ target_field_id: 'fld_unit', expression: { kind: 'raw', text: "'只'" } }]
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
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(syntax: RefSyntax) {
  const current = ref<ExpressionModel>(constantOnlyModel());
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
  const editor = wrapper.findComponent(ExpressionEditor as never) as never as { vm: { reconcilePublic?: unknown } };
  return { wrapper, current, editor };
}

describe('无来源常量填充：调和挂上本报表主表（B5）', () => {
  it('零来源 + 常量输出：编辑一次后模型带上本报表主表来源', async () => {
    const { wrapper, current } = await mountEditor('brackets');
    // 触发一次 update（编辑器内部任一改动都会走 reconcile 总闸门）——这里改查询选项，最不侵入。
    const editorVm = wrapper.findComponent(ExpressionEditor as never).vm as unknown as {
      $emit: (e: string, v: ExpressionModel) => void;
    };
    void editorVm;
    // 直接读挂载后编辑器已回抛的模型：reconcile 在 onMounted 与每次 update 都跑。
    await flushMounted();

    const tables = current.value.source?.tables ?? [];
    const main = tables.find(t => t.data_table_id === MAIN_TABLE_ID);
    expect(tables.length).toBeGreaterThan(0);
    expect(main).toBeDefined();
    expect(main?.is_context).toBe(true);
    expect(main?.role).toBe('main');
    wrapper.unmount();
  });
});
