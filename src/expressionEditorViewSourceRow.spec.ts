/**
 *
 * 本文件直接在 model.source.tables 里构造 view 来源（绕开 SourceTreePicker 选择流程），与
 * expressionEditorCrossAppPrefix.spec.ts 的 goodsSource() 手法一致，只验证展示层
 * （sourceDisplayName/crossAppPrefix）——只要 SourceTable 带了 app_id 就会正确渲染前缀，不关心
 * app_id 是怎么落进模型的。选择流程本身（onSelectSources 是否把跨应用视图的 appId 写进
 * SourceTable.app_id）已在 expressionEditorViewSourceCrossAppSelect.spec.ts 单独钉住（该缺口已
 * 修复，见该文件头注释）。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type SourceTable } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TEMPLATE_ID = 'tpl_goods';
const DT_GOODS = 'dt_goods_main';
const APP_CURRENT = 'app-current';
const APP_OTHER = 'app-other';

function makeHost(overrides: Partial<ExpressionHost> = {}): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async () => [],
    listFields: async () => [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    }),
    ...overrides
  };
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

function viewSource(alias: string, viewId: string, appId?: string): SourceTable {
  return {
    alias,
    source_type: 'view',
    template_id: '',
    data_table_id: '',
    view_id: viewId,
    is_context: false,
    ...(appId ? { app_id: appId } : {})
  };
}

function tableSource(alias: string): SourceTable {
  return {
    alias,
    source_type: 'template',
    template_id: SRC_TEMPLATE_ID,
    data_table_id: DT_GOODS,
    is_context: false
  };
}

async function mountEditor(tables: SourceTable[], host: ExpressionHost): Promise<VueWrapper> {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = tables;
  const current = ref<ExpressionModel>(m);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(host);
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
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { global: { stubs: componentStubs } });
  await flushMounted();
  return wrapper;
}

describe('①来源行：视图来源类型标签 + 列数', () => {
  it('①常规视图显示「常规视图」标签 + 「N 列」副文案', async () => {
    const host = makeHost({
      listViews: async () => [{ view_id: 'v1', view_name: '出入库流水', view_type: 'regular', column_count: 5 }]
    });
    const wrapper = await mountEditor([viewSource('t1', 'v1')], host);
    const row = wrapper.find('.qb-src-row[data-source-alias="t1"]');
    expect(row.find('[data-testid="qb-src-view-type"]').text()).toBe('常规视图');
    expect(row.find('.qb-src-meta').text()).toBe('5 列');
  });

  it('②组合视图显示「组合视图」标签', async () => {
    const host = makeHost({
      listViews: async () => [{ view_id: 'v2', view_name: '汇总视图', view_type: 'combined', column_count: 3 }]
    });
    const wrapper = await mountEditor([viewSource('t1', 'v2')], host);
    const row = wrapper.find('.qb-src-row[data-source-alias="t1"]');
    expect(row.find('[data-testid="qb-src-view-type"]').text()).toBe('组合视图');
    expect(row.find('.qb-src-meta').text()).toBe('3 列');
  });

  it('③宿主未实现 listViews/getViewSchema：类型回落通用「视图」，列数副文案省略（不显示裸 0 列）', async () => {
    const host = makeHost(); // 不传 listViews / getViewSchema
    const wrapper = await mountEditor([viewSource('t1', 'v3')], host);
    const row = wrapper.find('.qb-src-row[data-source-alias="t1"]');
    expect(row.find('[data-testid="qb-src-view-type"]').text()).toBe('视图');
    expect(row.find('.qb-src-meta').exists()).toBe(false);
  });

  it('④宿主只实现 getViewSchema（无 listViews）：列数回落取字段条数，类型仍回落通用「视图」', async () => {
    const host = makeHost({
      getViewSchema: async () => ({
        view_name: '出入库流水',
        columns: [
          { code: 'a', name: 'A', type: 'text' },
          { code: 'b', name: 'B', type: 'text' }
        ]
      })
    });
    const wrapper = await mountEditor([viewSource('t1', 'v4')], host);
    const row = wrapper.find('.qb-src-row[data-source-alias="t1"]');
    expect(row.find('[data-testid="qb-src-view-type"]').text()).toBe('视图');
    expect(row.find('.qb-src-meta').text()).toBe('2 列');
  });

  it('⑤跨应用视图来源复用与数据表来源同一套「应用名 › 」前缀规则', async () => {
    const host = makeHost({
      listApps: async () => [
        { app_id: APP_CURRENT, app_name: '当前应用', is_current: true },
        { app_id: APP_OTHER, app_name: '财务', is_current: false }
      ],
      listViews: async () => [{ view_id: 'v5', view_name: '往来对账', view_type: 'regular', column_count: 4 }]
    });
    const wrapper = await mountEditor([viewSource('t1', 'v5', APP_OTHER)], host);
    const row = wrapper.find('.qb-src-row[data-source-alias="t1"]');
    expect(row.find('.qb-src-name').text()).toContain('财务 › ');
  });

  it('⑥本应用视图来源（app_id=当前应用）不加前缀', async () => {
    const host = makeHost({
      listApps: async () => [{ app_id: APP_CURRENT, app_name: '当前应用', is_current: true }],
      listViews: async () => [{ view_id: 'v6', view_name: '往来对账', view_type: 'regular', column_count: 4 }]
    });
    const wrapper = await mountEditor([viewSource('t1', 'v6', APP_CURRENT)], host);
    const row = wrapper.find('.qb-src-row[data-source-alias="t1"]');
    expect(row.find('.qb-src-name').text()).not.toContain('›');
  });

  it('⑦数据表来源行 DOM 结构完全不变：不出现类型徽标节点', async () => {
    const host = makeHost();
    const wrapper = await mountEditor([tableSource('t1')], host);
    const row = wrapper.find('.qb-src-row[data-source-alias="t1"]');
    expect(row.find('[data-testid="qb-src-view-type"]').exists()).toBe(false);
  });
});
