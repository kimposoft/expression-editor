import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider, NSwitch } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';
import zhCN from './locales/zh-CN';

/**
 *
 * 本文件钉三件事：
 * A. V4 模式下开关可用，模型未写字段时展示为开（缺省即开），tooltip 换成 V4 抽键提示；
 * B. V4 模式下即便绕过禁用状态直接 emit update:value，也不会把 auto_row_match 写回文档
 *   （setAutoRowMatchIn 的写入侧防御）；
 * C. 反证：braces（3.4）语法下开关不受影响——正常可用、如实展示模型值、点击可写回文档。
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

/** 一个明细目标（target_table_role 直接固化，无需真表数据）；autoRowMatch 复现"存量已开"场景。 */
function modelWithDetailTarget(autoRowMatch?: boolean): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: DT_DETAIL,
    target_table_role: 'detail',
    auto_row_match: autoRowMatch,
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
  SourceTreePicker: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
  // 注意：NSwitch 不在桩列表——本文件正要断言它的真实 disabled/value，必须真实渲染。
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(
  syntax: RefSyntax,
  initial: ExpressionModel
): Promise<{ wrapper: VueWrapper; current: { value: ExpressionModel } }> {
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

/** 打开目标 tab 栏的「设置」popover（UI 反馈 2026-09-07 ⑥：设置项收进 popover，内容懒渲染且传送到 body，
 *  须先点按钮再查询）。 */
async function openSettings(wrapper: VueWrapper): Promise<void> {
  const btn = wrapper.find('[data-testid="target-settings-btn"]');
  expect(btn.exists()).toBe(true);
  await btn.trigger('click');
  await flushMounted();
}
/** popover 内容传送到 body：按 data-testid 从 document 上取容器元素。 */
function settingsRow(testid: string): HTMLElement {
  const el = document.body.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
  expect(el, `settings row ${testid} should be rendered after opening the popover`).not.toBeNull();
  return el!;
}
/** 自动按行列匹配开关：popover 内恒排第一个 NSwitch（第二个是「执行后清理空行」）；传送到 body 的组件仍在
 *  VTU 组件树里，findAllComponents 能取到。 */
function autoRowMatchSwitch(wrapper: VueWrapper) {
  const switches = wrapper.findAllComponents(NSwitch as any);
  expect(switches.length).toBeGreaterThan(0);
  return switches[0];
}

describe('V4 文档模式下「自动按行列匹配」开关', () => {
  it('A：V4（brackets）—— 开关可用、缺省展示为开，tooltip 换成 V4 抽键提示', async () => {
    const { wrapper } = await mountEditor('brackets', modelWithDetailTarget(undefined));
    await openSettings(wrapper);
    const container = settingsRow('target-auto-row-match');
    expect(container.getAttribute('title')).toBe(zhCN['editor.autoRowMatchV4Hint']);
    expect(container.getAttribute('title')).not.toBe(zhCN['editor.autoRowMatchTitle']);

    const sw = autoRowMatchSwitch(wrapper);
    expect(sw.props('disabled')).toBe(false);
    // 模型未写字段 ⇒ 缺省即开。
    expect(sw.props('value')).toBe(true);
    wrapper.unmount();
  });

  it('B：V4（brackets）—— 关闭写 auto_row_match=false 并展示为关；重新打开回到缺省（删字段）', async () => {
    const { wrapper, current } = await mountEditor('brackets', modelWithDetailTarget(undefined));
    await openSettings(wrapper);
    autoRowMatchSwitch(wrapper).vm.$emit('update:value', false);
    await flushMounted();
    expect(current.value.target?.auto_row_match).toBe(false);
    expect(autoRowMatchSwitch(wrapper).props('value')).toBe(false);

    autoRowMatchSwitch(wrapper).vm.$emit('update:value', true);
    await flushMounted();
    expect(current.value.target?.auto_row_match).toBeUndefined();
    expect(autoRowMatchSwitch(wrapper).props('value')).toBe(true);
    wrapper.unmount();
  });

  it('C 反证：braces（3.4）语法下开关不受影响——正常可用、如实展示模型值（缺省关）、点击可写回文档', async () => {
    const { wrapper, current } = await mountEditor('braces', modelWithDetailTarget(undefined));
    await openSettings(wrapper);
    const container = settingsRow('target-auto-row-match');
    expect(container.getAttribute('title')).toBe(zhCN['editor.autoRowMatchTitle']);

    const sw = autoRowMatchSwitch(wrapper);
    expect(sw.props('disabled')).toBe(false);
    expect(sw.props('value')).toBe(false);
    sw.vm.$emit('update:value', true);
    await flushMounted();
    expect(current.value.target?.auto_row_match).toBe(true);
    wrapper.unmount();
  });
});
