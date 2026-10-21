/**
 * ① 来源表行的「应用名 › 」前缀只给真正的跨应用来源（2026-09-11 用户反馈：表格编辑器控件查询选完来源表后，
 * 来源行显示成「<整串应用 UUID> › 商品档案的主表」并撑出横向滚动条，与取数配置面不一致）。
 *
 * 根因：V4 文档的目录来源恒带 app_id（本应用也带），而旧逻辑见 app_id 就加前缀、应用名查不到回落裸
 * app_id。修后口径：本应用来源（= listApps 的 is_current）不加；allowCrossApp=false 的场景不加；
 * 应用名未知不回落裸 ID。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type SourceTable, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TEMPLATE_ID = 'tpl_goods';
const DT_GOODS = 'dt_goods_main';
const APP_CURRENT = '4e0166e8-4b0d-4783-a9bb-1042c0947a2b';
const APP_OTHER = 'app_other';

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

const GOODS_TABLES: TemplateDataTable[] = [
  { data_table_id: DT_GOODS, table_code: DT_GOODS, table_name: '商品档案的主表', physical_table_name: DT_GOODS, table_role: 'main', sort_no: 0, field_count: 1, version_no: 1 }
];

/** withApps=false 模拟表格编辑器宿主桥（未实现 listApps）。 */
function makeHost(withApps: boolean): ExpressionHost {
  const host: Record<string, unknown> = {
    listTemplates: async () => [],
    listTables: async (templateId: string) => (templateId === SRC_TEMPLATE_ID ? GOODS_TABLES : []),
    listFields: async () => [field('f_code', '商品编码')],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async (req: { purpose: string; text: string }) => ({ purpose: req.purpose, text_source: { text: req.text, pack_revision: 'test', digest: 'd' }, diagnostics: [] })
  };
  if (withApps) {
    host.listApps = async () => [
      { app_id: APP_CURRENT, app_name: '进销存', is_current: true },
      { app_id: APP_OTHER, app_name: '财务', is_current: false }
    ];
  }
  return host as unknown as ExpressionHost;
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

function goodsSource(alias: string, appId: string): SourceTable {
  return { alias, source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: DT_GOODS, is_context: false, app_id: appId };
}

async function mountEditor(tables: SourceTable[], withApps: boolean, extraProps: Record<string, unknown> = {}): Promise<VueWrapper> {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = tables;
  const current = ref<ExpressionModel>(m);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost(withApps));
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              hideImplicitMain: true,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              },
              ...extraProps
            })
        });
    }
  });
  const wrapper = mount(Harness, { global: { stubs: componentStubs } });
  await flushMounted();
  return wrapper;
}

function sourceNames(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.qb-src-row .qb-src-name').map(n => n.text());
}

describe('① 来源行：「应用名 › 」前缀只给跨应用来源', () => {
  it('本应用来源（app_id = 当前应用）不加前缀；其他应用来源加「应用名 › 」', async () => {
    const wrapper = await mountEditor([goodsSource('t1', APP_CURRENT), goodsSource('t2', APP_OTHER)], true);
    const names = sourceNames(wrapper);
    expect(names[0]).toBe('商品档案的主表(1)');
    expect(names[1]).toBe('财务 › 商品档案的主表(2)');
  });

  it('宿主未实现 listApps + 关闭跨应用（表格编辑器控件查询）：不显示裸应用 UUID', async () => {
    const wrapper = await mountEditor([goodsSource('t1', APP_CURRENT)], false, {
      sourcePickerOptions: { selectableKinds: ['table'], allowCrossApp: false }
    });
    const names = sourceNames(wrapper);
    expect(names).toEqual(['商品档案的主表']);
    expect(wrapper.text()).not.toContain(APP_CURRENT);
  });

  it('应用名未知的跨应用来源不回落裸 app_id', async () => {
    const wrapper = await mountEditor([goodsSource('t1', 'app_unknown')], true);
    expect(sourceNames(wrapper)).toEqual(['商品档案的主表']);
    expect(wrapper.text()).not.toContain('app_unknown');
  });
});
