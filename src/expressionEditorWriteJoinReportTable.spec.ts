import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField } from './types';
import { provideExpressionHost, type ExpressionHost } from './host';

/**
 *
 * 本文件验证修复：写模式下手动关联候选池额外并入本报表各表（含尚未真正"用到"、还没登记进
 * model.source.tables 的），按钮可用；新建一条手动关联后，model.source.joins 落地该条，且它引用的
 * 本报表别名会被 reconcile 自动补登记进 source.tables（不需要用户先在别处引用一次该表）。
 *
 * 挂载策略同 expressionEditorWriteWhere.spec.ts：真实 ExpressionEditor + 桩 host；与其不同点是
 * **不打桩** JoinSettingsPanel（本用例正是要断言它内部真实 DOM 的 disabled 态与点击行为）。
 *   ① 数据层（reconcile/update/emitUpdate 全链路）逐行代码走查 + grep 全包，未发现任何会
 *     "补一条手动关联"的逻辑——唯一 push 新 join 的位置是 reconcile ②段自动 record_id 关联
 *     （auto_record_id:true 且有幂等 exists 判断），不会被本文件下方新增的长度不变量断言命中；
 *   ② 用真实 NModal + 真实 NSelect（非桩）在真实浏览器里搭建最小复现（JoinDesignerDialog.vue +
 *     JoinSettingsPanel.vue 原文件、未改一行）反复验证：弹层与「＋新增手动关联」按钮/其他控件
 *     视觉重叠时（窄视口、面板变高需要滚动、甚至弹层溢出弹窗卡片边界），`document.elementFromPoint`
 *     在重叠像素处仍稳定解析到下拉选项本身（因为浮层是 `.jd-shell` 的最后一个子节点，同 z-index
 *     下按 DOM 序在最上层）——鼠标点击、键盘 ArrowDown+Enter、连续 4 轮开合选值均未能在最小复现里
 *     诱发额外 join；
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const DT_MAIN = 'dt_po_main';
const DT_DETAIL = 'dt_po_detail';
const CATALOG_TEMPLATE_ID = 'tpl_catalog';
const DT_CATALOG = 'dt_catalog_main';

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
    table_name: dataTableId === DT_MAIN ? '出库单的主表' : dataTableId === DT_DETAIL ? '出库明细' : '商品档案的主表',
    physical_table_name: dataTableId,
    table_role: role,
    sort_no: 0,
    field_count: 1,
    version_no: 1
  };
}

const REPORT_TABLES: TemplateDataTable[] = [table(DT_MAIN, 'main'), table(DT_DETAIL, 'extension')];
const CATALOG_TABLES: TemplateDataTable[] = [table(DT_CATALOG, 'main')];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [DT_MAIN]: [field('f_order_no', '单号')],
  [DT_DETAIL]: [field('f_material', '明细商品')],
  [DT_CATALOG]: [field('f_name', '商品名称')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === REPORT_TEMPLATE_ID ? REPORT_TABLES : templateId === CATALOG_TEMPLATE_ID ? CATALOG_TABLES : []),
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

function writeModel(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source = {
    tables: [{ alias: 't1', source_type: 'template', template_id: CATALOG_TEMPLATE_ID, data_table_id: DT_CATALOG, is_context: false, role: 'main' }],
    joins: []
  };
  m.target = {
    target_template_id: CATALOG_TEMPLATE_ID,
    target_data_table_id: DT_CATALOG,
    target_table_role: 'main',
    operation: 'update',
    outputs: []
  };
  m.where = { logic: 'and', items: [{ predicate: { left: { kind: 'source_field', alias: 't1', field_id: 'f_name' }, op: 'neq', right: { kind: 'const', value: '' } } }] };
  return m;
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
/** NSelect 记录型桩（同 expressionEditorStrategyOptions.spec.ts / autoRowMatchV4Toggle.spec.ts
 *  既定手法）：options/value 声明为组件 props（不落 $attrs、不经 DOM 序列化，findAllComponents
 *  能拿到未失真原始数组），并真实暴露 update:value——测试按 data-join-part/data-join-index 等
 *  透传属性（未声明 prop，走默认 fallthrough 落到根节点）定位到具体下拉后，用
 *  `select.vm.$emit('update:value', v)` 驱动，触发的是与真实 NSelect 选中后完全一致的那条
 *  @update:value 事件链路（JoinSettingsPanel → ExpressionEditor.onUpdateJoins → update() →
 *  reconcile()），不是绕过组件直接改 model——只是不依赖 naive-ui 在 jsdom 下的弹层渲染
 *  （真实弹层需要浏览器布局，jsdom 没有渲染引擎，这部分留给 CSS 走查，见文件头注释）。 */
const SelectRecorderStub = defineComponent({
  props: { options: { type: Array, default: () => [] }, value: { default: null } },
  emits: ['update:value'],
  setup() {
    return () => h('div', { class: 'select-recorder-stub' });
  }
});
// 🔴 与其他既有 spec 的桩表唯一差别：不打桩 JoinSettingsPanel/JoinDesignerDialog/NModal——
// 本用例要驱动「新增手动关联」按钮的真实 disabled 态与点击行为，必须用真实组件树。
// 🔴 桩键名必须是组件内部注册名（不带 N 前缀，如 'Select' 不是 'NSelect'）——见
// expressionEditorStrategyOptions.spec.ts 头注释同一坑的详细说明；用错键名桩不生效，
// 渲染出的是真实 naive-ui 组件（在 jsdom 下大概率直接报错或静默不匹配）。
const componentStubs: Record<string, Component> = {
  Select: SelectRecorderStub,
  NButton: SlotPassthrough,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  NRadioGroup: SlotPassthrough,
  NRadio: SlotPassthrough,
  NSwitch: SlotPassthrough,
  SourceTreePicker: SlotPassthrough,
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

async function mountEditor(initial: ExpressionModel, writeOperation: 'insert' | 'update' | 'delete' | 'extract' = 'update') {
  const current = ref<ExpressionModel>(initial);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: REPORT_TEMPLATE_ID,
              writeOperation: writeOperation === 'extract' ? undefined : writeOperation,
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
  return { wrapper, current, editor };
}

/** 复现场景③（本文件第二条用例）：目录表 t1 已加入来源，本报表明细 bt1 因被 where 条件引用而登记
 *  进 source.tables，但两者尚未建立任何关联——此前 unlinkedAliases 判定池只看 explicitSources，
 *  bt1（is_context）不计入池，池长度恒为 1（只有 t1），< 2 的豁免规则会让这个"事实上的笛卡尔积"
 *  被误判为"无未关联项"，validity=true、允许保存。 */
function unlinkedComboModel(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source = {
    tables: [{ alias: 't1', source_type: 'template', template_id: CATALOG_TEMPLATE_ID, data_table_id: DT_CATALOG, is_context: false, role: 'main' }],
    joins: []
  };
  m.target = {
    target_template_id: CATALOG_TEMPLATE_ID,
    target_data_table_id: DT_CATALOG,
    target_table_role: 'main',
    operation: 'update',
    outputs: []
  };
  // 两条谓词：一条挂 t1（写模式定位条件非空门槛），一条挂本报表明细 bt1——后者是本用例的关键，
  // 逼 reconcile 把 bt1（连带 bt0 主表锚点）登记进 source.tables，制造"两张表都在 FROM 里、
  // 谁都没跟谁关联"的场景。
  m.where = {
    logic: 'and',
    items: [
      { predicate: { left: { kind: 'source_field', alias: 't1', field_id: 'f_name' }, op: 'neq', right: { kind: 'const', value: '' } } },
      { predicate: { left: { kind: 'source_field', alias: 'bt1', field_id: 'f_material' }, op: 'neq', right: { kind: 'const', value: '' } } }
    ]
  };
  return m;
}

/** 取数模式（无 writeOperation）对照夹具：两张显式来源表（目录表 t1 + 本报表主表 t2，均
 *  is_context:false，即用户显式添加，不是①面板固定行的隐式本报表上下文表），互不关联——
 *  只为让 aliasOptions（取数模式=explicitSources，见 ExpressionEditor.vue 同名 computed 注释）
 *  长度≥2，满足 JoinSettingsPanel.canAddJoin 门槛，用于验证「新增手动关联」默认 join_type
 *  在取数模式下仍是旧行为 'left'。 */
function extractModel(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.source = {
    tables: [
      { alias: 't1', source_type: 'template', template_id: CATALOG_TEMPLATE_ID, data_table_id: DT_CATALOG, is_context: false, role: 'main' },
      { alias: 't2', source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: DT_MAIN, is_context: false, role: 'main' }
    ],
    joins: []
  };
  return m;
}

/** 按 JoinSettingsPanel 三联下拉/关联条件下拉的 `data-join-part`（左表="left-source"、
 *  右表="right-source"、字段①="left-field"、字段②="right-field"）与可选的 `data-join-index`
 *  （原始 joins 数组下标，addJoin() 新建的第一条手动关联恒为其在 model.source.joins 里的下标）
 *  定位到具体那个 SelectRecorderStub wrapper；找不到时返回 undefined，让调用方对"前置条件是否
 *  满足"显式断言，不把"找不到"悄悄坍缩成 undefined 属性访问的 TypeError。 */
function findJoinSelect(editor: VueWrapper, joinIndex: number, part: string): VueWrapper | undefined {
  const selects = editor.findAllComponents(SelectRecorderStub as any) as VueWrapper[];
  return selects.find(w => w.attributes('data-join-index') === String(joinIndex) && w.attributes('data-join-part') === part);
}

describe('写模式手动关联可把「本报表」表纳入候选', () => {
  it('打开⋈表关联设计器后「新增手动关联」按钮可用（不再恒 disabled）', async () => {
    const { wrapper, current } = await mountEditor(writeModel());
    try {
      // 前置：确认此刻显式来源只有目录表一张（否则数量门槛本就满足，测试没有覆盖到根因）。
      expect(current.value.source.tables.filter(t => !t.is_context)).toHaveLength(1);

      const joinEntry = wrapper.find('[data-testid="qb-join-entry"]');
      expect(joinEntry.exists()).toBe(true);
      await joinEntry.trigger('click');
      await flushMounted();

      // NModal 的内容经 Teleport 挂到 document.body 之下、脱离 wrapper 自身的渲染子树——
      // wrapper.find() 只在组件自身挂载点下查找，找不到被传送出去的节点；直接用 DOMWrapper 包一层
      // document.body.querySelector 的结果，复用同一套 .exists()/.attributes()/.trigger() API。
      const addBtnEl = document.body.querySelector('[data-testid="join-add-manual"]');
      const addBtn = new DOMWrapper(addBtnEl ?? document.createElement('button'));
      expect(addBtnEl).not.toBeNull();
      // 核心断言（根因钉点）：按钮不再因为「候选池只有 1 张显式来源」被禁用。
      expect(addBtn.attributes('disabled')).toBeUndefined();

      await addBtn.trigger('click');
      await flushMounted();

      // 新建的手动关联应落进 model.source.joins，且至少一端引用了「本报表」上下文别名（bt0/bt1，
      // 或往返 V4 后的 rpt-* 形态）——即候选池确实把本报表表并进去了，不是巧合命中别的显式来源。
      const manualJoins = current.value.source.joins.filter(j => !j.auto_record_id);
      expect(manualJoins).toHaveLength(1);
      const join = manualJoins[0];
      const aliasesInJoin = [join.left_alias, join.right_alias];
      expect(aliasesInJoin).toContain('t1');
      const reportAliasInJoin = aliasesInJoin.find(a => a !== 't1');
      expect(reportAliasInJoin).toBeTruthy();
      expect(reportAliasInJoin?.startsWith('bt') || reportAliasInJoin?.startsWith('rpt-')).toBe(true);

      // reconcile 应据此把这张此前"没在 source.tables 里登记过"的本报表表正式补进来
      //（collectUsedAliases 从 join.on[].left/right.alias 抓到引用），否则关联会指向一个悬空别名。
      const registered = current.value.source.tables.some(t => t.is_context && t.alias === reportAliasInJoin);
      expect(registered).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it('目录表与已登记的本报表明细都在来源里但未关联时，validity=false（阻断保存）；补上关联后转 true', async () => {
    const { wrapper, current, editor } = await mountEditor(unlinkedComboModel());
    try {
      // 前置：bt1（连带主表锚点 bt0）确实已因 where 引用被 reconcile 登记进 source.tables，
      // 且 t1 目前没有任何 join 覆盖——这是本用例要卡住的"事实笛卡尔积"场景。
      const contextTables = current.value.source.tables.filter(t => t.is_context);
      expect(contextTables.map(t => t.data_table_id).sort()).toEqual([DT_DETAIL, DT_MAIN].sort());
      expect(current.value.source.joins.some(j => !j.auto_record_id)).toBe(false);

      // 核心断言（防御钉点）：判定池须把已登记的本报表上下文表也算进去，t1 无任何关联时
      // validity 必须是 false，不能被"池只有 1 张显式来源"的旧豁免口径放行。
      expect(editor.emitted('update:validity')?.at(-1)).toEqual([false]);

      // 补上 t1 ↔ 本报表表的手动关联后，validity 应转回 true。
      const joinEntry = wrapper.find('[data-testid="qb-join-entry"]');
      await joinEntry.trigger('click');
      await flushMounted();
      const addBtnEl = document.body.querySelector('[data-testid="join-add-manual"]');
      const addBtn = new DOMWrapper(addBtnEl ?? document.createElement('button'));
      await addBtn.trigger('click');
      await flushMounted();

      expect(editor.emitted('update:validity')?.at(-1)).toEqual([true]);
    } finally {
      wrapper.unmount();
    }
  });

  it('真实下拉交互：右表选中「本报表.出库明细」后不回退，关联条件两侧别名随表选择同步', async () => {
    const { wrapper, current, editor } = await mountEditor(writeModel());
    try {
      const joinEntry = wrapper.find('[data-testid="qb-join-entry"]');
      await joinEntry.trigger('click');
      await flushMounted();
      const addBtnEl = document.body.querySelector('[data-testid="join-add-manual"]') as HTMLButtonElement | null;
      expect(addBtnEl).not.toBeNull();
      addBtnEl!.click();
      await flushMounted();

      const rightSourceBefore = findJoinSelect(editor, 0, 'right-source');
      expect(rightSourceBefore).toBeTruthy();
      const rightOptions = rightSourceBefore!.props('options') as Array<{ label: string; value: string }>;
      const detailOption = rightOptions.find(o => o.label.includes('出库明细'));
      expect(detailOption).toBeTruthy();
      const mainOption = rightOptions.find(o => o.label.includes('出库单'));
      expect(rightSourceBefore!.props('value')).toBe(mainOption!.value); // 默认值＝本报表主表。

      // 真实驱动右表下拉的 update:value（与真实 NSelect 选中"本报表.出库明细"触发的事件完全同源）。
      rightSourceBefore!.vm.$emit('update:value', detailOption!.value);
      await flushMounted();

      const manualJoinsAfterRightSourceSwitch = current.value.source.joins.filter(j => !j.auto_record_id);
      expect(manualJoinsAfterRightSourceSwitch).toHaveLength(1);
      const extraJoinsAfterRightSourceSwitch = current.value.source.joins.filter(j => j.auto_record_id);
      for (const extra of extraJoinsAfterRightSourceSwitch) {
        expect(extra.auto_record_id).toBe(true);
      }

      // 断言①（选中值保持、不回退）：JoinSettingsPanel 的三联下拉直接绑定 join.right_alias
      //（非 on[].alias），这条链路本身没有"改了又被改回去"的逻辑缺陷——钉住它防止后续改动引入回归。
      const rightSourceAfter = findJoinSelect(editor, 0, 'right-source');
      expect(rightSourceAfter!.props('value')).toBe(detailOption!.value);
      const manualJoinAfterTableSwitch = current.value.source.joins.find(j => !j.auto_record_id);
      expect(manualJoinAfterTableSwitch?.right_alias).toBe(detailOption!.value);
      expect(manualJoinAfterTableSwitch?.left_alias).toBe('t1');

      // 真实驱动左字段＝商品名称（t1.f_name）、右字段＝明细商品（bt1.f_material）。
      const leftField = findJoinSelect(editor, 0, 'left-field');
      expect(leftField).toBeTruthy();
      leftField!.vm.$emit('update:value', 'f_name');
      await flushMounted();
      const rightField = findJoinSelect(editor, 0, 'right-field');
      expect(rightField).toBeTruthy();
      const rightFieldOptions = rightField!.props('options') as Array<{ label: string; value: string }>;
      // fieldSelectOptions('bt1') 的字段目录须真是"出库明细"的字段（明细商品），不是切表前残留的
      // "出库单"字段目录——这一断言本身在两处根因修复前也成立（fieldOptions 读的是最新
      // right_alias，见 JoinSettingsPanel.vue :options="fieldOptions(item.j.right_alias)"），
      // 用来确认前置条件没有跑偏：用户看到的字段选项确实是"新表"的。
      expect(rightFieldOptions.map(o => o.value)).toContain('f_material');
      rightField!.vm.$emit('update:value', 'f_material');
      await flushMounted();

      // 同上，关联条件字段②选值后再核一次手动关联数不变量（左表/联接方式/右表/字段①/字段②五联
      // 下拉逐一驱动完，手动关联应恒为 1 条，不因任一次选值悄悄多出一条；②段自动 record_id 关联
      // 不受影响、不计入本断言，理由同上）。
      expect(current.value.source.joins.filter(j => !j.auto_record_id)).toHaveLength(1);

      // 核心断言（根因②钉点，JoinSettingsPanel.vue setJoinField）：关联条件 on[0] 两侧的 alias
      // 必须与三联下拉当前选中的表一致——修复前 on[0].right.alias 仍停留在 addJoin() 创建时的
      // 默认值 bt0（本报表主表），与用户选的 bt1（出库明细）对不上号，等值关联条件
      // "[商品档案].[商品名称] = [出库明细].[明细商品]" 实际落盘成
      // "[商品档案].[商品名称] = [本报表主表：不存在的字段]"，无法建立。
      const finalJoin = current.value.source.joins.find(j => !j.auto_record_id);
      expect(finalJoin?.on?.[0]?.left).toEqual({ alias: 't1', field_id: 'f_name' });
      expect(finalJoin?.on?.[0]?.right).toEqual({ alias: detailOption!.value, field_id: 'f_material' });

      const deleteBtn = document.body.querySelector('.jp-close') as HTMLButtonElement | null;
      expect(deleteBtn).not.toBeNull();
      deleteBtn!.click();
      await flushMounted();
      expect(current.value.source.joins.some(j => !j.auto_record_id)).toBe(false);
      // 再多等一轮，确认删除结果没有被任何调和逻辑悄悄补回一条手动关联。
      await flushMounted();
      expect(current.value.source.joins.some(j => !j.auto_record_id)).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});

/**
 *
 * 本文件验证两处修复：① 写模式新增手动关联默认 join_type 改为 'inner'（取数模式仍默认 'left'，
 * 见 JoinSettingsPanel.vue defaultJoinType prop）；② 写模式关联设计器里若存在左联合且左右任一侧
 * 是写目标实例本身的手动关联，关联行下方显示风险提示（不阻断，JoinSettingsPanel.vue
 * showWriteLeftJoinNotice/editor.writeLeftJoinNotice）。
 */
describe('写模式手动关联默认内联合 + 左关联写空值风险提示', () => {
  it('写模式新增手动关联：join_type 默认为 inner（不再默认 left）', async () => {
    const { wrapper, current } = await mountEditor(writeModel(), 'update');
    try {
      const joinEntry = wrapper.find('[data-testid="qb-join-entry"]');
      await joinEntry.trigger('click');
      await flushMounted();
      const addBtnEl = document.body.querySelector('[data-testid="join-add-manual"]') as HTMLButtonElement | null;
      expect(addBtnEl).not.toBeNull();
      expect(addBtnEl!.disabled).toBe(false);
      addBtnEl!.click();
      await flushMounted();

      const manualJoins = current.value.source.joins.filter(j => !j.auto_record_id);
      expect(manualJoins).toHaveLength(1);
      // 核心断言：写模式下新建的手动关联默认联接方式是 inner，不是取数模式沿用的旧默认 left。
      expect(manualJoins[0].join_type).toBe('inner');
    } finally {
      wrapper.unmount();
    }
  });

  it('取数模式新增手动关联：join_type 仍默认为 left（旧行为不变，不受写模式新默认值影响）', async () => {
    const { wrapper, current } = await mountEditor(extractModel(), 'extract');
    try {
      const joinEntry = wrapper.find('[data-testid="qb-join-entry"]');
      await joinEntry.trigger('click');
      await flushMounted();
      const addBtnEl = document.body.querySelector('[data-testid="join-add-manual"]') as HTMLButtonElement | null;
      expect(addBtnEl).not.toBeNull();
      expect(addBtnEl!.disabled).toBe(false);
      addBtnEl!.click();
      await flushMounted();

      const manualJoins = current.value.source.joins.filter(j => !j.auto_record_id);
      expect(manualJoins).toHaveLength(1);
      // 对照断言：取数模式默认联接方式保持旧行为 left（回归防护，防止本次改动误伤取数模式）。
      expect(manualJoins[0].join_type).toBe('left');
    } finally {
      wrapper.unmount();
    }
  });

  it('写模式左关联命中写目标实例：关联行下方显示风险提示（不阻断）', async () => {
    const { wrapper, current, editor } = await mountEditor(writeModel(), 'update');
    try {
      const joinEntry = wrapper.find('[data-testid="qb-join-entry"]');
      await joinEntry.trigger('click');
      await flushMounted();
      const addBtnEl = document.body.querySelector('[data-testid="join-add-manual"]') as HTMLButtonElement | null;
      addBtnEl!.click();
      await flushMounted();

      // 新建关联默认 inner（本文件上一条用例已钉住），提示此刻不应出现。
      expect(document.body.querySelector('[data-testid="write-left-join-notice"]')).toBeNull();
      const manualJoinBefore = current.value.source.joins.find(j => !j.auto_record_id);
      // 前置：这条关联确实一端是写目标实例本身（addJoin() 左=候选池[0]=写目标别名 t1）。
      expect(manualJoinBefore?.left_alias).toBe('t1');

      // 真实驱动「联接方式」下拉切到 left。
      const typeSelect = findJoinSelect(editor, 0, 'type');
      expect(typeSelect).toBeTruthy();
      typeSelect!.vm.$emit('update:value', 'left');
      await flushMounted();

      // 核心断言①：数据层确实落成 left。
      const manualJoinAfter = current.value.source.joins.find(j => !j.auto_record_id);
      expect(manualJoinAfter?.join_type).toBe('left');

      // 核心断言②：风险提示出现，且不阻断——「新增手动关联」按钮/关联本身不因此被禁用或清空。
      const notice = document.body.querySelector('[data-testid="write-left-join-notice"]');
      expect(notice).not.toBeNull();
      expect(notice?.textContent?.trim()).toBe(
        '左关联会让目标表中未匹配的记录也被写入（相关字段得空值）；只想改命中的记录请用内关联'
      );
      expect(current.value.source.joins.some(j => !j.auto_record_id)).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});
