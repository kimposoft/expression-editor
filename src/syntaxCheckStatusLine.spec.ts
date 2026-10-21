import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type ExpressionNotice } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import zhCN from './locales/zh-CN';

/**
 *
 * 本文件钉：A 无通知零变化；B 错误+提示混合的着色/计数/首条/明细列表；C 单条提示不出计数、着色跟随语法态；
 * D 仅警告走警告档；E 完全相同的重复上报只算一条。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';

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

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
/** 注意：按名字桩 NPopover 对直接 import 的 naive 组件不生效（同 autoRowMatchV4Toggle.spec 的经验）——明细列表
 *  是真 popover，内容懒渲染且传送到 body：断言前先点状态条，再从 document.body 取。 */
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: SlotPassthrough,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  NSwitch: SlotPassthrough,
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
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(
  notices?: ExpressionNotice[],
  options?: { hideStatusBar?: boolean }
): Promise<{ wrapper: VueWrapper; notices: { value: ExpressionNotice[] | undefined } }> {
  const current = ref<ExpressionModel>(emptyExpressionModel(REPORT_TEMPLATE_ID));
  const noticesRef = ref<ExpressionNotice[] | undefined>(notices);
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
              notices: noticesRef.value,
              hideStatusBar: options?.hideStatusBar,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  return { wrapper, notices: noticesRef };
}

/** popover 内容传送到 body：按 testid 从 document 上取明细行。 */
function noticeRow(i: number): HTMLElement {
  const el = document.body.querySelector(`[data-testid="syntax-check-notice-${i}"]`) as HTMLElement | null;
  expect(el, `notice row ${i} should be rendered after opening the popover`).not.toBeNull();
  return el!;
}

const SYNTAX_LABELS = [
  zhCN['editor.syntaxCheckPending'],
  zhCN['editor.syntaxCheckChecking'],
  zhCN['editor.syntaxCheckValid'],
  zhCN['editor.syntaxCheckInvalid']
];

describe('① 校验状态条单行合并（notices prop）', () => {
  it('A：不传 notices —— 只显示语法三态词，无「详情」入口、无明细列表', async () => {
    const { wrapper } = await mountEditor(undefined);
    const bar = wrapper.find('[data-testid="syntax-check-bar"]');
    expect(bar.exists()).toBe(true);
    expect(SYNTAX_LABELS).toContain(wrapper.find('[data-testid="syntax-check-label"]').text());
    expect(wrapper.find('[data-testid="syntax-check-more"]').exists()).toBe(false);
    expect(document.body.querySelector('[data-testid="syntax-check-notice-0"]')).toBeNull();
    expect(bar.classes()).not.toContain('sc-clickable');
    wrapper.unmount();
  });

  it('B：错误 + 提示混合 —— 错误档着色、状态词 · 计数 · 首条错误明细，一行；明细列表逐条齐全', async () => {
    const { wrapper } = await mountEditor([
      { severity: 'info', where: '目标 采购明细', message: '已把「物料编号」转为按行列匹配' },
      { severity: 'error', where: '筛选条件', message: '未提供稳定引用 #{r1} 的绑定' }
    ]);
    const bar = wrapper.find('[data-testid="syntax-check-bar"]');
    expect(bar.classes()).toContain('sc-invalid');
    expect(bar.classes()).toContain('sc-clickable');
    const label = wrapper.find('[data-testid="syntax-check-label"]').text();
    // 一条 label：状态词 · 错误 1 · 提示 1 · 首条按错误优先（不是宿主顺序里排第一的 info）
    expect(label).toBe(`✗ ${zhCN['editor.validationFailedMsg']} · ${zhCN['editor.noticeErrors']} 1 · ${zhCN['editor.noticeInfos']} 1 · 筛选条件：未提供稳定引用 #{r1} 的绑定`);
    expect(label.includes('\n')).toBe(false);
    expect(wrapper.find('[data-testid="syntax-check-more"]').text()).toContain(zhCN['editor.noticeDetails']);
    // title 悬浮全文逐条
    expect(bar.attributes('title')).toBe('目标 采购明细：已把「物料编号」转为按行列匹配\n筛选条件：未提供稳定引用 #{r1} 的绑定');
    // 点状态条展开 popover：明细列表保持宿主顺序、逐条齐全（内容传送到 body）
    await bar.trigger('click');
    await flushMounted();
    const row0 = noticeRow(0);
    const row1 = noticeRow(1);
    expect(row0.textContent).toContain('已把「物料编号」转为按行列匹配');
    expect(row0.classList.contains('is-info')).toBe(true);
    expect(row1.textContent).toContain('未提供稳定引用 #{r1} 的绑定');
    expect(row1.classList.contains('is-error')).toBe(true);
    expect(document.body.querySelector('[data-testid="syntax-check-notice-2"]')).toBeNull();
    wrapper.unmount();
  });

  it('C：只有一条提示 —— 不出计数段，着色跟随语法三态（不是错误/警告档），首条明细直接接在状态词后', async () => {
    const { wrapper } = await mountEditor([{ severity: 'info', message: '测试通过：查询可以正常编译' }]);
    const bar = wrapper.find('[data-testid="syntax-check-bar"]');
    expect(bar.classes()).not.toContain('sc-invalid');
    expect(bar.classes()).not.toContain('sc-warning');
    const label = wrapper.find('[data-testid="syntax-check-label"]').text();
    expect(label).not.toContain(`${zhCN['editor.noticeInfos']} 1`);
    expect(label.endsWith(' · 测试通过：查询可以正常编译')).toBe(true);
    expect(SYNTAX_LABELS.some(word => label.startsWith(word))).toBe(true);
    wrapper.unmount();
  });

  it('D：只有警告 —— 走警告档：⚠ 状态词 + 橙色类', async () => {
    const { wrapper } = await mountEditor([{ severity: 'warning', where: '目标 采购明细', message: '按映射清空但没有按行列匹配列' }]);
    const bar = wrapper.find('[data-testid="syntax-check-bar"]');
    expect(bar.classes()).toContain('sc-warning');
    expect(wrapper.find('[data-testid="syntax-check-label"]').text()).toBe(`⚠ ${zhCN['editor.statusWarning']} · 目标 采购明细：按映射清空但没有按行列匹配列`);
    wrapper.unmount();
  });

  it('E：完全相同的重复上报只算一条；通知变化后 label 随之更新', async () => {
    const dup: ExpressionNotice = { severity: 'error', where: '筛选条件', message: '同一条' };
    const { wrapper, notices } = await mountEditor([dup, { ...dup }, { severity: 'error', where: '目标', message: '另一条' }]);
    let label = wrapper.find('[data-testid="syntax-check-label"]').text();
    expect(label).toContain(`${zhCN['editor.noticeErrors']} 2`);
    await wrapper.find('[data-testid="syntax-check-bar"]').trigger('click');
    await flushMounted();
    expect(noticeRow(1)).not.toBeNull();
    expect(document.body.querySelector('[data-testid="syntax-check-notice-2"]')).toBeNull();
    notices.value = [];
    await flushMounted();
    label = wrapper.find('[data-testid="syntax-check-label"]').text();
    expect(SYNTAX_LABELS).toContain(label);
    expect(wrapper.find('[data-testid="syntax-check-more"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('F：hideStatusBar 缺省/false 时内置状态条渲染不变；true 时整块消失', async () => {
    const { wrapper: defaultWrapper } = await mountEditor(undefined);
    expect(defaultWrapper.find('[data-testid="syntax-check-bar"]').exists()).toBe(true);
    defaultWrapper.unmount();

    const { wrapper: explicitFalseWrapper } = await mountEditor(undefined, { hideStatusBar: false });
    expect(explicitFalseWrapper.find('[data-testid="syntax-check-bar"]').exists()).toBe(true);
    explicitFalseWrapper.unmount();

    const { wrapper: hiddenWrapper } = await mountEditor(undefined, { hideStatusBar: true });
    expect(hiddenWrapper.find('[data-testid="syntax-check-bar"]').exists()).toBe(false);
    hiddenWrapper.unmount();
  });
});
