/**
 * 视图来源字段目录：模型里的 (view_id, app_id) 组合变化时必须重新按新键预取（2026-09-14 缺陷修复）。
 *
 * 缺陷现场：来源选择器对**当前应用**的视图恒不下发 appId（SourceTreePicker 视图叶子分支），
 * onSelectSources 于是按裸 view_id 写字段缓存；而调用方（取数 / 控件查询配置面）每次改动都会把
 *
 * 判据落在①筛选条件弹窗拿到的 dockColumns 上，不测中间缓存：
 * 缓存键怎么设计是实现细节，"模型里有视图来源就必须有字段"才是要钉住的行为。
 */
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type SourceTable } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

const REPORT_TEMPLATE_ID = 'tpl_report';
const VIEW_ID = 'view_test';
const VIEW_NAME = 'test';
const APP_CURRENT = 'app-current';

/** 侦测①筛选条件弹窗收到的 dockColumns。 */
let dockSources: any[] = [];
const ConditionDialogSpy = defineComponent({
  props: { dockColumns: { type: Object, required: false } },
  setup(props) {
    return () => {
      if (props.dockColumns) dockSources = (props.dockColumns as any).sources ?? [];
      return h('div');
    };
  }
});
const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_p, { slots }) {
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
  ConditionEditorDialog: ConditionDialogSpy
};

function makeHost(getViewSchema: ExpressionHost['getViewSchema']): ExpressionHost {
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
    getViewSchema
  } as ExpressionHost;
}

function modelWith(appId?: string): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [
    {
      alias: 't1',
      source_type: 'view',
      template_id: '',
      data_table_id: '',
      view_id: VIEW_ID,
      is_context: false,
      ...(appId ? { app_id: appId } : {})
    } as SourceTable
  ];
  return m;
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 10; i += 1) await nextTick();
}

function viewColumn(): any {
  return dockSources[0];
}

describe('视图来源字段目录跟随 (view_id, app_id) 组合重新预取', () => {
  it('挂载时无 app_id、随后 V4 往返补上 app_id：字段仍在（缺陷现场是塌成 0 条、只剩视图名）', async () => {
    const getViewSchema = vi.fn(async () => ({
      view_name: VIEW_NAME,
      columns: [
        { code: 'col_1', name: '供应商编码', type: 'text' },
        { code: 'col_2', name: '供应商名称', type: 'text' }
      ]
    }));
    const Harness = defineComponent({
      data: () => ({ m: modelWith(undefined) as ExpressionModel }),
      setup() {
        provideExpressionHost(makeHost(getViewSchema));
      },
      render() {
        return h(NMessageProvider, null, {
          default: () => h(ExpressionEditor as any, { modelValue: this.m, templateId: REPORT_TEMPLATE_ID })
        });
      }
    });
    const wrapper = mount(Harness, { global: { stubs: componentStubs } });
    await flush();
    expect(viewColumn()?.tables?.[0]?.fields).toHaveLength(2);

    // V4 往返把当前应用 ID 盖到视图来源上（正向 app_id: t.app_id || ctx.appId ⇒ 反向原样带回）。
    (wrapper.vm as any).m = modelWith(APP_CURRENT);
    await flush();
    expect(viewColumn()?.header).toBe(VIEW_NAME);
    expect(viewColumn()?.tables?.[0]?.fields).toHaveLength(2);
    wrapper.unmount();
  });

  it('视图来源晚于挂载才进模型（文档异步装载）：字段照样补得上', async () => {
    const getViewSchema = vi.fn(async () => ({
      view_name: VIEW_NAME,
      columns: [{ code: 'col_1', name: '供应商编码', type: 'text' }]
    }));
    const Harness = defineComponent({
      data: () => ({ m: emptyExpressionModel(REPORT_TEMPLATE_ID) as ExpressionModel }),
      setup() {
        provideExpressionHost(makeHost(getViewSchema));
      },
      render() {
        return h(NMessageProvider, null, {
          default: () => h(ExpressionEditor as any, { modelValue: this.m, templateId: REPORT_TEMPLATE_ID })
        });
      }
    });
    const wrapper = mount(Harness, { global: { stubs: componentStubs } });
    await flush();
    expect(getViewSchema).not.toHaveBeenCalled();

    (wrapper.vm as any).m = modelWith(APP_CURRENT);
    await flush();
    expect(getViewSchema).toHaveBeenCalledWith(VIEW_ID, APP_CURRENT);
    expect(viewColumn()?.tables?.[0]?.fields).toHaveLength(1);
    wrapper.unmount();
  });
});
