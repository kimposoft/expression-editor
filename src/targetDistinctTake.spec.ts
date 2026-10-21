import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NInputNumber, NMessageProvider, NSwitch } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 * ③目标 tab 栏「设置」浮层，逐目标独立设置；排除重复缺省开；前 N 条可 −/＋ 步进也可手输，清空=不限。仅 V4 显示。
 *
 * 本文件钉：A V4 下两行渲染、缺省展示（开 / 不限）；B 开关写回显式布尔；C 数字输入写回（整数、<1 与 null 都视为不限）；
 * D 3.4（braces）不渲染这两行。挂载/桩写法沿用 autoRowMatchV4Toggle.spec（NSwitch/NInputNumber 真实渲染；popover 内容
 * 懒渲染且传送 body，先点「设置」再查）。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const DT_DETAIL = 'dt_detail';

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
    })
  };
}

function modelWithDetailTarget(distinct?: boolean, take?: number): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: DT_DETAIL,
    target_table_role: 'detail',
    distinct,
    take,
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
  NSelect: SlotPassthrough, NButton: SlotPassthrough, NEmpty: SlotPassthrough, NSpin: SlotPassthrough, NTag: SlotPassthrough,
  NTooltip: SlotPassthrough, NPopover: SlotPassthrough, NRadioGroup: SlotPassthrough, NRadio: SlotPassthrough,
  SourceTreePicker: SlotPassthrough, JoinSettingsPanel: SlotPassthrough, ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough, ExpressionInput: SlotPassthrough, ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough, FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(syntax: RefSyntax, initial: ExpressionModel): Promise<{ wrapper: VueWrapper; current: { value: ExpressionModel } }> {
  const current = ref<ExpressionModel>(initial);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax(syntax);
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
  return { wrapper, current };
}

async function openSettings(wrapper: VueWrapper): Promise<void> {
  const btn = wrapper.find('[data-testid="target-settings-btn"]');
  expect(btn.exists()).toBe(true);
  await btn.trigger('click');
  await flushMounted();
}
function bodyRow(testid: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
}
/** 「排除重复」开关：popover 内第三个 NSwitch（前两个是自动按行列匹配 / 执行后清理空行）。 */
function distinctSwitch(wrapper: VueWrapper) {
  const switches = wrapper.findAllComponents(NSwitch as any);
  expect(switches.length).toBeGreaterThanOrEqual(3);
  return switches[2];
}
function takeInput(wrapper: VueWrapper) {
  const inputs = wrapper.findAllComponents(NInputNumber as any);
  expect(inputs.length).toBe(1);
  return inputs[0];
}

describe('逐目标「排除重复 / 仅限前 N 条」', () => {
  it('A：V4（brackets）—— 两行渲染；模型未写时排除重复展示为开、前 N 条为空（不限）', async () => {
    const { wrapper } = await mountEditor('brackets', modelWithDetailTarget(undefined, undefined));
    await openSettings(wrapper);
    expect(bodyRow('target-distinct')).not.toBeNull();
    expect(bodyRow('target-take')).not.toBeNull();
    expect(distinctSwitch(wrapper).props('value')).toBe(true);
    expect(takeInput(wrapper).props('value')).toBeNull();
    expect(takeInput(wrapper).props('min')).toBe(1);
    expect(takeInput(wrapper).props('buttonPlacement')).toBe('both');
    wrapper.unmount();
  });

  it('B：开关写回显式布尔——关→false、再开→true；存量 false 如实展示', async () => {
    const { wrapper, current } = await mountEditor('brackets', modelWithDetailTarget(false, undefined));
    await openSettings(wrapper);
    expect(distinctSwitch(wrapper).props('value')).toBe(false);
    distinctSwitch(wrapper).vm.$emit('update:value', true);
    await flushMounted();
    expect(current.value.target?.distinct).toBe(true);
    distinctSwitch(wrapper).vm.$emit('update:value', false);
    await flushMounted();
    expect(current.value.target?.distinct).toBe(false);
    wrapper.unmount();
  });

  it('C：前 N 条写回——5→5、7.9→7（向下取整）、0/null→删字段（不限）；存量 12 如实展示', async () => {
    const { wrapper, current } = await mountEditor('brackets', modelWithDetailTarget(true, 12));
    await openSettings(wrapper);
    expect(takeInput(wrapper).props('value')).toBe(12);
    takeInput(wrapper).vm.$emit('update:value', 5);
    await flushMounted();
    expect(current.value.target?.take).toBe(5);
    takeInput(wrapper).vm.$emit('update:value', 7.9);
    await flushMounted();
    expect(current.value.target?.take).toBe(7);
    takeInput(wrapper).vm.$emit('update:value', 0);
    await flushMounted();
    expect(current.value.target?.take).toBeUndefined();
    takeInput(wrapper).vm.$emit('update:value', 3);
    await flushMounted();
    takeInput(wrapper).vm.$emit('update:value', null);
    await flushMounted();
    expect(current.value.target?.take).toBeUndefined();
    wrapper.unmount();
  });

  it('D：3.4（braces）—— 不渲染这两行（3.4 的去重/限量在顶层 distinct/limit，由宿主浮层配置）', async () => {
    const { wrapper } = await mountEditor('braces', modelWithDetailTarget(undefined, undefined));
    await openSettings(wrapper);
    expect(bodyRow('target-distinct')).toBeNull();
    expect(bodyRow('target-take')).toBeNull();
    expect(wrapper.findAllComponents(NInputNumber as any).length).toBe(0);
    wrapper.unmount();
  });
});
