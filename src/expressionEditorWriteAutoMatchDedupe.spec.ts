import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField, type WriteOperation } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost, type RefSyntax } from './host';

/**
 *
 * ① 「按名称填充」泛化到写模式（insert/update 段头渲染同款按钮；delete 无字段列表不渲染）：点击后
 *   与③目标段同一套 autoMatchFields 实现按 field_code/field_name 匹配来源列，写模式分支落盘前多过一次
 *   pickedRefForSyntax——brackets（V4）语法下不得残留结构化
 *   source_field，故这里钉「点击后落成 {kind:'raw', text:'[表].[字段]'}」而不是结构化引用。
 *
 *
 * ③ 原生文本语义提示条从「防重区块下方、仅 insert 渲染」挪到「字段列表上方、insert/update 常显」，
 *   delete 无字段列表故不显示，与③目标段 order-native-text-hint 同位置同判据。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const SRC_TABLE_ID = 'dt_src';
const TARGET_TABLE_ID = 'dt_target';
const F_MATCH = 'f_match'; // field_code 与来源字段相同，钉「按名称填充」命中
const F_OTHER = 'f_other'; // field_code/field_name 均不匹配，钉「无命中不生成行」
const F_PICS = 'f_pics';

function makeField(fieldId: string, code: string, name: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: code,
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

const HOST_TABLES: TemplateDataTable[] = [
  {
    data_table_id: SRC_TABLE_ID,
    table_code: SRC_TABLE_ID,
    table_name: '出库单的主表',
    physical_table_name: SRC_TABLE_ID,
    table_role: 'main',
    sort_no: 0,
    field_count: 1,
    version_no: 1
  },
  {
    data_table_id: TARGET_TABLE_ID,
    table_code: TARGET_TABLE_ID,
    table_name: '出库流水目标表',
    physical_table_name: TARGET_TABLE_ID,
    table_role: 'main',
    sort_no: 1,
    field_count: 2,
    version_no: 1
  }
];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [SRC_TABLE_ID]: [makeField('fld_qty', 'fld_qty', '数量')],
  [TARGET_TABLE_ID]: [
    makeField(F_MATCH, 'fld_qty', '匹配字段'),
    makeField(F_OTHER, 'f_other_code', '不匹配字段'),
    { ...makeField(F_PICS, 'f_pics_code', '图片'), data_type: 'attachment' }
  ]
};

function makeHost(opts: { fieldsDelayMs?: number } = {}): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? HOST_TABLES : []),
    listFields: async (_templateId, dataTableId) => {
      if (opts.fieldsDelayMs) await new Promise(resolve => setTimeout(resolve, opts.fieldsDelayMs));
      return HOST_FIELDS[dataTableId] ?? [];
    },
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** 写模式模型：insert 直接选定目标表；update/delete 走来源别名（"查询它并写它"）。
 *  dedupeFieldIds 非空时预置一行已填充输出（dedupe 字段须 ⊆ 已配置输出，见 buildFinalizedModel 注释）；
 *  presetOutputs 供「已配置行不覆盖」用例在挂载前就把某字段落成非空表达式（挂载后再改 v-model 引用
 *  是否会被组件内部深拷贝的编辑态感知不确定，钉在挂载前更稳）；targetRole 默认 'main'——本文件其它
 *  用例聚焦①③两条钉，恒 main 避免引入角色相关分支；仅「范围行渐进出现」「主表目标不渲染范围行」
 *  两条钉显式传 'detail'/'main' 来钉 writeTargetIsDetail 门控。 */
function modelFor(
  operation: WriteOperation,
  opts: { dedupeFieldIds?: string[]; presetOutputs?: ExpressionModel['target']['outputs']; targetRole?: 'main' | 'detail' } = {}
): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source.tables = [{ alias: 'src1', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: SRC_TABLE_ID, is_context: false }];
  const targetRole = opts.targetRole ?? 'main';
  if (operation === 'insert') {
    m.target = { target_template_id: REPORT_TEMPLATE_ID, target_data_table_id: TARGET_TABLE_ID, target_table_role: targetRole, operation: 'insert', outputs: [] };
  } else {
    m.target = {
      target_template_id: REPORT_TEMPLATE_ID,
      target_data_table_id: TARGET_TABLE_ID,
      target_table_role: targetRole,
      operation,
      outputs: []
    };
  }
  if (opts.presetOutputs?.length) {
    m.target.outputs = opts.presetOutputs;
  }
  if (opts.dedupeFieldIds?.length) {
    m.target.outputs = opts.dedupeFieldIds.map(id => ({ target_field_id: id, expression: { kind: 'const' as const, value: 'x' } }));
    m.target.dedupe_field_ids = opts.dedupeFieldIds;
    m.target.dedupe_scope = 'all';
  }
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
/** NButton 桩成原生 button 并透传 attrs：@click 与 data-testid/disabled 都落在 button 上，能真点。 */
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.());
  }
});
// 桩集照抄 expressionEditorWritePick.spec.ts。
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: ButtonStub,
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
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  AdvancedExpressionDialog: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(
  syntax: RefSyntax,
  operation: WriteOperation,
  opts: {
    dedupeFieldIds?: string[];
    presetOutputs?: ExpressionModel['target']['outputs'];
    targetRole?: 'main' | 'detail';
    fieldsDelayMs?: number;
  } = {}
): Promise<{ wrapper: VueWrapper; editor: VueWrapper; current: () => ExpressionModel; setCurrent: (v: ExpressionModel) => Promise<void> }> {
  const current = ref<ExpressionModel>(modelFor(operation, opts));
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost({ fieldsDelayMs: opts.fieldsDelayMs }));
      provideRefSyntax(syntax);
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              writeOperation: operation,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  const editor = wrapper.findComponent(ExpressionEditor as any);
  // setCurrent：模拟"模型被外部改动后重挂/重传"（如另一处联动清空了某字段表达式），驱动子组件
  // 的 model=computed(()=>props.modelValue) 跟着变化，从而能测组件内部对 model 变化的响应式联动
  // （dedupeCandidateFields → watch 自动摘除防重键）。
  const setCurrent = async (v: ExpressionModel): Promise<void> => {
    current.value = v;
    await flushMounted();
  };
  return { wrapper, editor, current: () => current.value, setCurrent };
}

describe('写模式「按名称填充」按钮泛化', () => {
  it('insert/update 段头渲染「按名称填充」按钮，delete 不渲染', async () => {
    const insert = await mountEditor('brackets', 'insert');
    const update = await mountEditor('brackets', 'update');
    const del = await mountEditor('brackets', 'delete');
    try {
      expect(insert.wrapper.find('[data-testid="write-auto-match-btn"]').exists()).toBe(true);
      expect(update.wrapper.find('[data-testid="write-auto-match-btn"]').exists()).toBe(true);
      expect(del.wrapper.find('[data-testid="write-auto-match-btn"]').exists()).toBe(false);
    } finally {
      insert.wrapper.unmount();
      update.wrapper.unmount();
      del.wrapper.unmount();
    }
  });

  it('brackets（V4）语法下点击后按 field_code 命中来源字段，落盘 raw 文本（不留结构化 source_field）', async () => {
    const { wrapper, current } = await mountEditor('brackets', 'insert');
    try {
      await wrapper.find('[data-testid="write-auto-match-btn"]').trigger('click');
      await flushMounted();

      const matched = current().target.outputs.find(o => o.target_field_id === F_MATCH);
      expect(matched).toBeDefined();
      expect(matched!.expression).toEqual({ kind: 'raw', text: '[出库单的主表].[数量]' });
      // 无命中的字段不落输出行（field_code/field_name 均不匹配）。
      expect(current().target.outputs.some(o => o.target_field_id === F_OTHER)).toBe(false);
      expect(matched).not.toHaveProperty('fill_strategy');
      expect(matched).not.toHaveProperty('separator');
    } finally {
      wrapper.unmount();
    }
  });

  it('update 操作同样按名称填充并过 pickedRefForSyntax（钉两种写操作共用同一实现）', async () => {
    const { wrapper, current } = await mountEditor('brackets', 'update');
    try {
      await wrapper.find('[data-testid="write-auto-match-btn"]').trigger('click');
      await flushMounted();

      const matched = current().target.outputs.find(o => o.target_field_id === F_MATCH);
      expect(matched?.expression).toEqual({ kind: 'raw', text: '[出库单的主表].[数量]' });
    } finally {
      wrapper.unmount();
    }
  });

  it('braces（3.4）语法下点击后原样保留结构化 source_field（不经 brackets 转换）', async () => {
    const { wrapper, current } = await mountEditor('braces', 'insert');
    try {
      await wrapper.find('[data-testid="write-auto-match-btn"]').trigger('click');
      await flushMounted();

      const matched = current().target.outputs.find(o => o.target_field_id === F_MATCH);
      expect(matched?.expression).toEqual({ kind: 'source_field', alias: 'src1', field_id: 'fld_qty' });
    } finally {
      wrapper.unmount();
    }
  });

  it('已配置的行不被覆盖（同③目标段口径）', async () => {
    // 挂载前预置已配置行（挂载后再改 v-model 引用是否会被组件内部编辑态感知不确定，钉在挂载前更稳）。
    const { wrapper, current } = await mountEditor('brackets', 'insert', {
      presetOutputs: [{ target_field_id: F_MATCH, expression: { kind: 'raw', text: '既有值' } }]
    });
    try {
      await wrapper.find('[data-testid="write-auto-match-btn"]').trigger('click');
      await flushMounted();

      const matched = current().target.outputs.find(o => o.target_field_id === F_MATCH);
      expect(matched?.expression).toEqual({ kind: 'raw', text: '既有值' });
    } finally {
      wrapper.unmount();
    }
  });
});

describe('唯一键防重（09-10）解冻：常显 + chips 候选 + 联动 + 范围行', () => {
  it('insert 且已选目标表：防重区块常显（原 SHOW_WRITE_DEDUPE 常量已删除）', async () => {
    const { wrapper } = await mountEditor('brackets', 'insert');
    try {
      expect(wrapper.find('[data-testid="write-dedupe-block"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('唯一键防重');
    } finally {
      wrapper.unmount();
    }
  });

  it('候选 chips 只出自「已填充表达式」的字段：F_MATCH 已填充出现，F_OTHER 未配置不出现', async () => {
    const { wrapper } = await mountEditor('brackets', 'insert', {
      presetOutputs: [{ target_field_id: F_MATCH, expression: { kind: 'raw', text: '既有值' } }]
    });
    try {
      expect(wrapper.find(`[data-testid="write-dedupe-chip-${F_MATCH}"]`).exists()).toBe(true);
      expect(wrapper.find(`[data-testid="write-dedupe-chip-${F_OTHER}"]`).exists()).toBe(false);
      expect(wrapper.find('.wdd-empty-hint').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('图片 / 附件字段已填充也不进判重键候选（附件不能比较）', async () => {
    const { wrapper } = await mountEditor('brackets', 'insert', {
      presetOutputs: [
        { target_field_id: F_MATCH, expression: { kind: 'raw', text: '既有值' } },
        { target_field_id: F_PICS, expression: { kind: 'raw', text: '[图片]' } }
      ]
    });
    try {
      expect(wrapper.find(`[data-testid="write-dedupe-chip-${F_MATCH}"]`).exists()).toBe(true);
      expect(wrapper.find(`[data-testid="write-dedupe-chip-${F_PICS}"]`).exists()).toBe(false);
      // 写目标行的附件字段带类型提示。
      expect(wrapper.find(`[data-testid="write-target-attachment-hint-${F_PICS}"]`).exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it('没有任何已填充字段时：chips 区域显示引导空态提示，不渲染任何 chip', async () => {
    const { wrapper } = await mountEditor('brackets', 'insert'); // outputs 恒空（默认无 presetOutputs）
    try {
      expect(wrapper.find('.wdd-chip').exists()).toBe(false);
      expect(wrapper.find('.wdd-empty-hint').exists()).toBe(true);
      expect(wrapper.text()).toContain('请先在上方为字段填充表达式');
    } finally {
      wrapper.unmount();
    }
  });

  it('扩展表目标：范围行未选键也常显，再点选 chip 写入 dedupe_field_ids，移出后范围行仍不收起', async () => {
    const { wrapper, current } = await mountEditor('brackets', 'insert', {
      targetRole: 'detail',
      presetOutputs: [{ target_field_id: F_MATCH, expression: { kind: 'raw', text: '既有值' } }]
    });
    try {
      // 未选任何键：范围行已常显（不再是渐进式）。
      expect(wrapper.find('[data-testid="write-dedupe-scope"]').exists()).toBe(true);

      await wrapper.find(`[data-testid="write-dedupe-chip-${F_MATCH}"]`).trigger('click');
      await flushMounted();
      expect(current().target.dedupe_field_ids).toEqual([F_MATCH]);
      expect(wrapper.find('[data-testid="write-dedupe-scope"]').exists()).toBe(true);
      expect(wrapper.find(`[data-testid="write-dedupe-chip-${F_MATCH}"]`).text()).toContain('✓');

      // 移出唯一的键：范围行不再随之收起（常显，与「是否已选键」解耦）。
      await wrapper.find(`[data-testid="write-dedupe-chip-${F_MATCH}"]`).trigger('click');
      await flushMounted();
      expect(current().target.dedupe_field_ids ?? []).toEqual([]);
      expect(wrapper.find('[data-testid="write-dedupe-scope"]').exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it('主表目标：不渲染判重范围行（无论是否已选键）', async () => {
    const { wrapper, current } = await mountEditor('brackets', 'insert', {
      presetOutputs: [{ target_field_id: F_MATCH, expression: { kind: 'raw', text: '既有值' } }]
    });
    try {
      expect(wrapper.find('[data-testid="write-dedupe-scope"]').exists()).toBe(false);

      await wrapper.find(`[data-testid="write-dedupe-chip-${F_MATCH}"]`).trigger('click');
      await flushMounted();
      expect(current().target.dedupe_field_ids).toEqual([F_MATCH]);
      expect(wrapper.find('[data-testid="write-dedupe-scope"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('未选键时切换范围只改本地暂存不写模型；选中第一个键时把暂存值补写进 dedupe_scope', async () => {
    // 桩集里 NRadioGroup/NRadio 都是 SlotPassthrough（同一个组件定义），真实 value/@update:value 语义
    // 被吞掉——同 autoRowMatchV4Toggle.spec.ts 对已桩组件的驱动手法，直接在组件实例上 $emit
    // 'update:value'，Vue 运行时仍会调用模板里登记的 @update:value 监听器（本例即 setDedupeScope）。
    // 全局同款 SlotPassthrough 实例很多，按渲染文本同时含「全表」+「同一父记录内」两个选项文案定位
    // 到范围行的 NRadioGroup（其默认插槽正是两个 NRadio 子项，文本天然包含两个选项标签）。
    const { wrapper, current } = await mountEditor('brackets', 'insert', {
      targetRole: 'detail',
      presetOutputs: [{ target_field_id: F_MATCH, expression: { kind: 'raw', text: '既有值' } }]
    });
    try {
      // NRadioGroup 桩成 SlotPassthrough 后 inheritAttrs:false 只吞掉非 class/style 的 attrs，
      // :class="wdd-scope-radio" 仍会 fallthrough 到桩组件的根 DOM——findComponent 支持传 CSS
      // 选择器按"根元素匹配该选择器"定位组件实例，借这个 class 精确拿到范围单选组，而不必和其它
      // 同样桩成 SlotPassthrough 的组件（NSelect/NTooltip/…）混在一起用文本内容猜。
      const scopeGroup = () => wrapper.findComponent('.wdd-scope-radio');

      // 未选键时把范围切到「同一父记录内」：只改本地展示，不落模型（field_ids 仍空）。
      scopeGroup().vm.$emit('update:value', 'parent');
      await flushMounted();
      expect(current().target.dedupe_field_ids ?? []).toEqual([]);
      expect(current().target.dedupe_scope).toBeUndefined();

      // 选中第一个键：模型里的 scope 落成用户刚才在单选上选的 'parent'，不是默认 'all'。
      await wrapper.find(`[data-testid="write-dedupe-chip-${F_MATCH}"]`).trigger('click');
      await flushMounted();
      expect(current().target.dedupe_field_ids).toEqual([F_MATCH]);
      expect(current().target.dedupe_scope).toBe('parent');
    } finally {
      wrapper.unmount();
    }
  });

  it('已选防重键的字段表达式被清空后，自动从 dedupe_field_ids 摘除（不必等到「确定」才收口）', async () => {
    const { wrapper, current, setCurrent } = await mountEditor('brackets', 'insert', { dedupeFieldIds: [F_MATCH] });
    try {
      expect(current().target.dedupe_field_ids).toEqual([F_MATCH]);

      // 模拟该字段表达式被清空（如另一处联动/用户 ✕ 清空）：整行落回未配置占位态 {kind:'const'}。
      await setCurrent({
        ...current(),
        target: { ...current().target, outputs: [{ target_field_id: F_MATCH, expression: { kind: 'const' } }] }
      });

      expect(current().target.dedupe_field_ids ?? []).toEqual([]);
      expect(current().target.dedupe_scope).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it('打开存量节点时字段目录延迟到位：已保存的防重键不被联动摘除', async () => {
    const { wrapper, current } = await mountEditor('brackets', 'insert', { dedupeFieldIds: [F_MATCH], fieldsDelayMs: 30 });
    try {
      await new Promise(resolve => setTimeout(resolve, 120));
      for (let i = 0; i < 10; i += 1) await nextTick();
      expect(current().target.dedupe_field_ids).toEqual([F_MATCH]);
      expect(current().target.dedupe_scope).toBe('all');
    } finally {
      wrapper.unmount();
    }
  });

  it('finalize() 收口后 dedupe_field_ids/dedupe_scope 原样保留（存量文档往返不丢字节）', async () => {
    const { wrapper, editor } = await mountEditor('brackets', 'insert', { dedupeFieldIds: [F_MATCH] });
    try {
      const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
      expect(finalized.target.dedupe_field_ids).toEqual([F_MATCH]);
      expect(finalized.target.dedupe_scope).toBe('all');
    } finally {
      wrapper.unmount();
    }
  });
});

describe('原生文本语义提示条挪到写模式字段列表上方', () => {
  it('insert/update 常显（字段列表之上），delete 不显示（无字段列表）', async () => {
    const insert = await mountEditor('brackets', 'insert');
    const update = await mountEditor('brackets', 'update');
    const del = await mountEditor('brackets', 'delete');
    try {
      expect(insert.wrapper.find('[data-testid="write-native-text-hint"]').exists()).toBe(true);
      expect(update.wrapper.find('[data-testid="write-native-text-hint"]').exists()).toBe(true);
      expect(del.wrapper.find('[data-testid="write-native-text-hint"]').exists()).toBe(false);

      // 位置钉：提示条须在字段行列表之前渲染（挪到列表上方，不再挂防重区块下方）。
      const html = insert.wrapper.html();
      const hintIdx = html.indexOf('write-native-text-hint');
      const rowsIdx = html.indexOf('write-rows');
      expect(hintIdx).toBeGreaterThan(-1);
      expect(rowsIdx).toBeGreaterThan(-1);
      expect(hintIdx).toBeLessThan(rowsIdx);
    } finally {
      insert.wrapper.unmount();
      update.wrapper.unmount();
      del.wrapper.unmount();
    }
  });
});
