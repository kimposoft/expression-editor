/**
 *
 * 缺陷现场：候选 aliasOptions 此前按 tableName(t.data_table_id) 取名，而视图 / 暂存区 / 外部表
 * 三类来源的 data_table_id 恒为空串（身份在 view_id / external_object_id 上，见 onSelectSources），
 * tableName('') 原样回落空串 ⇒ 选项 label 为 ''，NSelect 渲染成没有文字的空白行，用户表现为
 * 「来源表选的是视图时，关联下拉里选不中它」。修法是改走 sourceDisplayName（与①来源行、
 * 关联设计器顶部「待配来源」芯片同一口径）。
 *
 * 本文件直接在 model.source.tables 里构造各类来源（绕开 SourceTreePicker 选择流程，手法同
 * expressionEditorViewSourceRow.spec.ts），只断言传给 JoinDesignerDialog 的 sourceOptions。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import JoinDesignerDialog from './JoinDesignerDialog.vue';
import { emptyExpressionModel, type ExpressionModel, type SourceTable } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TEMPLATE_ID = 'tpl_goods';
const DT_GOODS = 'dt_goods_main';

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

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

function tableSource(alias: string): SourceTable {
  return { alias, source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: DT_GOODS, is_context: false };
}
function viewSource(alias: string, viewId: string): SourceTable {
  return { alias, source_type: 'view', template_id: '', data_table_id: '', view_id: viewId, is_context: false };
}
function externalSource(alias: string, objectId: string): SourceTable {
  return { alias, source_type: 'external', template_id: '', data_table_id: '', external_object_id: objectId, is_context: false };
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

function sourceOptionsOf(wrapper: VueWrapper): { label: string; value: string }[] {
  return wrapper.findComponent(JoinDesignerDialog).props('sourceOptions') as { label: string; value: string }[];
}

describe('表关联候选显示名', () => {
  it('①视图来源的候选 label 是视图名，不是空串', async () => {
    const host = makeHost({
      listTables: async () => [{ data_table_id: DT_GOODS, table_name: '商品档案', template_id: SRC_TEMPLATE_ID, role: 'main' } as never],
      // 视图显示名来自 getViewSchema.view_name（ensureViewFields 写入 viewNameCache）。
      getViewSchema: async () => ({ view_name: '出入库流水', columns: [] })
    });
    const wrapper = await mountEditor([tableSource('t1'), viewSource('t2', 'v1')], host);
    const opts = sourceOptionsOf(wrapper);
    expect(opts.find(o => o.value === 't2')?.label).toBe('出入库流水');
  });

  it('②视图名未加载到（旧宿主桥无 listViews/getViewSchema）时回落裸 view_id，仍不是空串', async () => {
    const host = makeHost();
    const wrapper = await mountEditor([tableSource('t1'), viewSource('t2', 'v_unloaded')], host);
    expect(sourceOptionsOf(wrapper).find(o => o.value === 't2')?.label).toBe('v_unloaded');
  });

  it('③外部表来源（data_table_id 同样恒空）的候选 label 也非空（名称未预取时回落裸 object_id + 「（外部表）」后缀）', async () => {
    const host = makeHost();
    const wrapper = await mountEditor([tableSource('t1'), externalSource('t2', 'ext1')], host);
    const label = sourceOptionsOf(wrapper).find(o => o.value === 't2')?.label ?? '';
    expect(label).not.toBe('');
    expect(label).toContain('ext1');
  });

  it('④普通数据表来源显示名不受影响（仍是表名）', async () => {
    const host = makeHost({
      listTables: async () => [{ data_table_id: DT_GOODS, table_name: '商品档案', template_id: SRC_TEMPLATE_ID, role: 'main' } as never],
      listViews: async () => [{ view_id: 'v1', view_name: '出入库流水', view_type: 'regular', column_count: 5 }]
    });
    const wrapper = await mountEditor([tableSource('t1'), viewSource('t2', 'v1')], host);
    expect(sourceOptionsOf(wrapper).find(o => o.value === 't1')?.label).toBe('商品档案');
  });
});
