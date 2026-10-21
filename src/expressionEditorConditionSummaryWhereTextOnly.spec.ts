import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

/**
 *
 * 病灶（ExpressionEditor.vue conditionHasContent，改造前）：
 *   const conditionHasContent = computed(() => !!model.value.where && model.value.where.items.length > 0);
 * V4（brackets）正向翻译（v4/expressionModelAdapter.ts）只产出 where_text_source，从不写结构化
 * where（V4 没有引导式条件，筛选内容全在文本 sidecar 里）——反向翻译 v4DocToExpressionModel 同理，
 * V4 壳下 model.value.where 恒为空。故 conditionHasContent 恒 false，模板 `v-if="conditionHasContent"`
 * 走不到 whereExprDisplaySegments() 原文分支，②面板恒显示 qb-condition-empty 提示——即便
 * where_text_source 里明明有一条完整的筛选表达式，摘要区也看不出「已配置」。
 *
 * 本文件覆盖改造后的判据：conditionHasContent 除了看结构化 where，还看 where_text_source.text
 * 是否有非空白内容（本文件只挂 where_text_source、不挂 where，复现 V4 壳下的真实模型形状），
 * 断言渲染出 .qb-condition-expr-view（原文只读展示）而不是 .qb-condition-empty。
 * 3.4（braces）壳下 lowerText 产出 where 与 where_text_source 成对且 where 非空，走的是原判据的
 * 前半句，不受本次改动影响——该口径由既有用例 expressionEditorReportRefInWhereText.spec.ts 与
 * v4/expressionModelAdapter.test.ts 覆盖，本文件不重复。
 */

const TEMPLATE_ID = 'tpl_i808';

/** 最小可用 ExpressionHost 桩：本文件只测②面板的只读渲染，不驱动任何编辑/确认交互，
 *  各方法给恒成功空桩满足 ExpressionEditor 挂载期的必需调用（listTables/loadCatalog 等）。 */
function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async () => [],
    listFields: async () => [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({ purpose: req.purpose, text_source: { text: req.text, pack_revision: 'test', digest: 'd' }, diagnostics: [] })
  };
}

/** 与 expressionEditorReportRefInWhereText.spec.ts 同款子组件桩集合：ExpressionEditor 依赖的重组件
 *  （字段树坞/关联面板/条件编辑弹窗等）本文件不需要真实交互，顶掉避免其内部逻辑干扰渲染断言。 */
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

/** 挂 ExpressionEditor（brackets 语法，与真实 V4 设计器 ActionConfigSurface.vue 一致），
 *  初始模型只带 where_text_source、不带结构化 where——复现 V4 反向翻译的真实模型形状。 */
async function mountEditorWithWhereTextOnly(text: string) {
  const initial: ExpressionModel = {
    ...emptyExpressionModel(TEMPLATE_ID),
    where_text_source: { text, pack_revision: 'alice-v4', digest: 'd' }
  };
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: initial,
              templateId: TEMPLATE_ID,
              'onUpdate:modelValue': () => undefined
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  return wrapper;
}

describe('② 筛选条件摘要区', () => {
  it('只有 where_text_source、无结构化 where：渲染出条件原文只读视图，不显示空态提示', async () => {
    const wrapper = await mountEditorWithWhereTextOnly('[金额] > 100');

    expect(wrapper.find('.qb-condition-expr-view').exists()).toBe(true);
    expect(wrapper.find('.qb-condition-empty').exists()).toBe(false);
    wrapper.unmount();
  });

  it('where_text_source.text 全是空白：仍判定为空（不是随便非 undefined 就算有内容）', async () => {
    const wrapper = await mountEditorWithWhereTextOnly('   ');

    expect(wrapper.find('.qb-condition-empty').exists()).toBe(true);
    expect(wrapper.find('.qb-condition-expr-view').exists()).toBe(false);
    wrapper.unmount();
  });
});
