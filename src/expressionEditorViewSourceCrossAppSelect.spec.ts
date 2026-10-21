/**
 *
 * 调用方需显式放开 sourcePickerOptions.selectableKinds 含 'view'（见 ExpressionEditor.vue
 * 2026-09-12 改判：缺省仅 table），与 expressionEditorCrossAppPrefix.spec.ts 的既有测试手法一致
 * （构造 host + 直接对 SourceTreePicker 组件 emit select，不依赖真实弹层交互）。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import SourceTreePicker from './SourceTreePicker.vue';
import { emptyExpressionModel, type ExpressionModel } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

const REPORT_TEMPLATE_ID = 'tpl_report';
const APP_OTHER = 'app_finance';

function makeHost(): ExpressionHost {
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
    // 跨应用视图选中后编辑器会尝试预取字段/元信息，
    // 提供最小实现避免请求悬空报错，本用例不断言其具体展示，只关心 app_id 是否落进模型。
    getViewSchema: async () => ({ view_name: '往来对账', columns: [] }),
    listViews: async () => [{ view_id: 'vw_ar', view_name: '往来对账', view_type: 'regular', column_count: 0 }]
  } as unknown as ExpressionHost;
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
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough
  // 🔴 SourceTreePicker 不放进 stubs：本用例需要拿到真实组件实例发 `select` 事件（与
  // expressionEditorWriteSelfAssignment.spec.ts 的既有手法一致），若整体桩掉就找不到目标组件。
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(): Promise<{ wrapper: VueWrapper; current: () => ExpressionModel }> {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  const current = ref<ExpressionModel>(m);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              hideImplicitMain: true,
              // 显式放开视图叶子（缺省仅 table，见 ExpressionEditor.vue 2026-09-12 改判）。
              sourcePickerOptions: { selectableKinds: ['table', 'view'] },
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { global: { stubs: componentStubs } });
  await flushMounted();
  return { wrapper, current: () => current.value };
}

describe('②来源：选中跨应用视图后 SourceTable.app_id 正确落进模型', () => {
  it('picker 发出的 kind=view 条目带 appId 时，新增来源的 app_id 与之一致', async () => {
    const { wrapper, current } = await mountEditor();
    // ②来源段的添加器（非 single）：写目标段在取数模式不存在，这里唯一一个 SourceTreePicker
    // 就是①来源添加器。
    const picker = wrapper.findComponent(SourceTreePicker as unknown as Component);
    expect(picker.exists(), '①来源添加器 SourceTreePicker 应已渲染').toBe(true);
    picker.vm.$emit('select', [
      { templateId: '', dataTableId: '', role: 'main', kind: 'view', view_id: 'vw_ar', appId: APP_OTHER, name: '往来对账' }
    ]);
    await flushMounted();

    const model = current();
    const added = model.source.tables.find(t => t.source_type === 'view');
    expect(added, `新增视图来源应已落进模型：${JSON.stringify(model.source.tables)}`).toBeTruthy();
    expect(added?.view_id).toBe('vw_ar');
    expect(added?.app_id).toBe(APP_OTHER);
  });

  it('当前应用的视图（picker 不下发 appId）：不写 app_id 字段（与数据表来源同一约定）', async () => {
    const { wrapper, current } = await mountEditor();
    const picker = wrapper.findComponent(SourceTreePicker as unknown as Component);
    picker.vm.$emit('select', [{ templateId: '', dataTableId: '', role: 'main', kind: 'view', view_id: 'vw_ar', name: '往来对账' }]);
    await flushMounted();

    const added = current().source.tables.find(t => t.source_type === 'view');
    expect(added).toBeTruthy();
    expect(added?.app_id).toBeUndefined();
  });
});
