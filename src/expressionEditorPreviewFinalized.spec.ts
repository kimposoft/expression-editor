import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

/**
 * 防抖语法检查发送「finalize 后模型」回归单测。
 *
 * 修法：runPreview 改发 buildFinalizedModel()（finalize 的纯函数部分，深拷贝上收口、不 emit
 * 不回写）。本文件锁两条：①预览 payload 不含占位行（与保存闸看到的模型一致）；②预览不把
 * finalize 副作用回写编辑态——占位行在当前模型里原样保留（继续承载策略/排序下拉）。
 *
 * 挂载策略照抄 expressionEditorHaving.spec.ts（真实 ExpressionEditor + 桩 host + naive-ui 整体
 * 打桩）；防抖 1.5s 用 vi.useFakeTimers + advanceTimersByTimeAsync 推进，不真等。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const TARGET_TABLE_ID = 'dt_target';
const SOURCE_TABLE_ID = 'dt_source';

function field(fieldId: string, name = fieldId): TemplateField {
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
function table(dataTableId: string, role: 'main' | 'extension'): TemplateDataTable {
  return {
    data_table_id: dataTableId,
    table_code: dataTableId,
    table_name: dataTableId,
    physical_table_name: dataTableId,
    table_role: role,
    sort_no: 0,
    field_count: 1,
    version_no: 1
  };
}
const HOST_TABLES: TemplateDataTable[] = [table(SOURCE_TABLE_ID, 'main'), table(TARGET_TABLE_ID, 'extension')];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [SOURCE_TABLE_ID]: [field('fld_category', '类别'), field('fld_amount', '金额')],
  [TARGET_TABLE_ID]: [field('fld_cat_out', '类别输出'), field('fld_sum_out', '合计输出'), field('fld_note_out', '备注输出')]
};

/** 记录型 host：compilePreview 把每次收到的模型深拷贝存档（防后续引用被原地改动污染断言）。 */
function makeRecordingHost(previewCalls: ExpressionModel[]): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async (_templateId, model) => {
      previewCalls.push(JSON.parse(JSON.stringify(model)));
      return { valid: true, arg_count: 0 };
    },
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

const sumOfAmount = { kind: 'func' as const, name: 'sum', args: [{ kind: 'source_field' as const, alias: 't1', field_id: 'fld_amount' }] };
const directCategory = { kind: 'source_field' as const, alias: 't1', field_id: 'fld_category' };

/** 复现模型（对齐任务书最小复现）：单来源表 + 直连列 + SUM + 一条「不填充」占位行
 *  （{kind:'const'} 且 value 缺省——upsertOutputIn 先选策略/排序、还没配表达式时的编辑期形态）。 */
function modelWithPlaceholderRow(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source = { tables: [{ alias: 't1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: SOURCE_TABLE_ID, is_context: false, role: 'main' }], joins: [] };
  m.target = {
    target_template_id: REPORT_TEMPLATE_ID,
    target_data_table_id: TARGET_TABLE_ID,
    target_table_role: 'detail',
    outputs: [
      { target_field_id: 'fld_cat_out', expression: directCategory, fill_strategy: 'overwrite' },
      { target_field_id: 'fld_sum_out', expression: sumOfAmount, fill_strategy: 'overwrite' },
      { target_field_id: 'fld_note_out', expression: { kind: 'const' }, fill_strategy: 'overwrite' }
    ]
  };
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
// 🔴 桩键名必须是组件内部注册名（'Select'/'Button' 等，无 N 前缀），见
// expressionEditorStrategyOptions.spec.ts 文件头对该坑的实测记录。
const componentStubs: Record<string, Component> = {
  Select: ButtonStub,
  Button: ButtonStub,
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

/** 假定时器版 flush：推进 0ms 触发挂载期 setTimeout(0) 与全部微任务，再补几轮 nextTick。 */
async function flushMountedFake(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(initial: ExpressionModel, previewCalls: ExpressionModel[]): Promise<{ wrapper: VueWrapper; current: () => ExpressionModel }> {
  const current = ref<ExpressionModel>(JSON.parse(JSON.stringify(initial)));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeRecordingHost(previewCalls));
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
  await flushMountedFake();
  return { wrapper, current: () => current.value };
}

/** finalize 后目标 outputs 的读取口径：writeTargets 会把单数 target 归一成 targets[]，两个位置都认。 */
function targetOutputs(m: ExpressionModel): Array<{ target_field_id: string }> {
  const target = m.targets?.[0] ?? m.target;
  return target?.outputs ?? [];
}

describe('ExpressionEditor 防抖语法检查发送 finalize 后模型', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('预览 payload 剔除「不填充」占位行；编辑态模型仍原样保留占位行', async () => {
    const previewCalls: ExpressionModel[] = [];
    const { wrapper, current } = await mountEditor(modelWithPlaceholderRow(), previewCalls);

    // 推进过 1.5s 防抖窗口（多推进几轮：挂载期 reconcile 若 emit 过 update:modelValue，deep watch
    // 会重置计时器；预览本身不再触发模型变更，计时器不会被无限顺延）。
    for (let round = 0; round < 4; round += 1) {
      await vi.advanceTimersByTimeAsync(1600);
      await nextTick();
    }
    expect(previewCalls.length).toBeGreaterThan(0);

    // ① 发给 host.compilePreview 的模型 = finalize 后形状：占位行已剔除，两条真实输出原样在。
    const sent = previewCalls[previewCalls.length - 1];
    const sentFieldIds = targetOutputs(sent).map(o => o.target_field_id).sort();
    expect(sentFieldIds).toEqual(['fld_cat_out', 'fld_sum_out']);

    // ② 预览不回写：编辑态模型里占位行仍在（继续承载「填充策略」「排序」下拉的行内配置）。
    const editingFieldIds = targetOutputs(current()).map(o => o.target_field_id).sort();
    expect(editingFieldIds).toEqual(['fld_cat_out', 'fld_note_out', 'fld_sum_out']);

    wrapper.unmount();
  });
});
