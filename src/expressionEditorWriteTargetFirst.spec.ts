import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import ExpressionInput from './ExpressionInput.vue';
import SourceTreePicker from './SourceTreePicker.vue';
import { emptyExpressionModel, type ExpressionModel, type TemplateDataTable, type TemplateField, type WriteOperation } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import type { V4ModelAdapterContext } from './v4/expressionModelAdapter';
import { v4WriteDocToExpressionModel, expressionModelToV4WriteDoc } from './v4/writeModelAdapter';
import type { V4WriteNodeDocument } from './v4/writeNodeDocument';

/**
 *
 * 覆盖点：
 * A ①目标段（三操作）只渲染一个数据表选择器，不带任何说明文字/chip/提示条；段名按操作三选一。
 * B 选扩展表目标（insert→扩展表）后：「目标」分组（dock/⊞ 快捷面板候选）含主表 + 扩展表；隐含来源
 *   （目标模板主表）恒在 finalize() 结果的 sources 里（即便未被任何表达式引用）；候选池表（扩展表
 *   本身）在未被引用时不进 sources。
 * C 引用即入源：候选池表一旦被引用（字段赋值原文出现 `[表名].[字段]`），reconcile 把它正式登记进
 *   sources（is_write_target 打标）。
 * D 读兼容：update 旧文档 `target.instance_id`（决议 ⑧ 之前的寻址方式）读入后①段即视为"已选目标"；
 *   带 `parent`（三态）的旧文档读入后编辑器不产出任何父记录锚定 UI，保存收口 doc.parent 消失
 *   （细粒度往返断言见 v4/writeModelAdapter.spec.ts，本文件只钉 UI 可观测行为）。
 */

const REPORT_TEMPLATE_ID = 'tpl_report';
const TARGET_TEMPLATE_ID = 'tpl_inventory';
const TARGET_MAIN = 'dt_inv_main';
const TARGET_DETAIL = 'dt_inv_detail';

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
function table(dataTableId: string, role: 'main' | 'extension', name: string): TemplateDataTable {
  return {
    data_table_id: dataTableId,
    table_code: dataTableId,
    table_name: name,
    physical_table_name: dataTableId,
    table_role: role,
    sort_no: role === 'main' ? 0 : 1,
    field_count: 1,
    version_no: 1
  };
}
const TARGET_TABLES: TemplateDataTable[] = [table(TARGET_MAIN, 'main', '库存主表'), table(TARGET_DETAIL, 'extension', '库存流水')];
const SRC_TEMPLATE_ID = 'tpl_customer';
const SRC_TABLE = 'dt_customer_main';
const SRC_TABLES: TemplateDataTable[] = [table(SRC_TABLE, 'main', '客户资料')];
const HOST_FIELDS: Record<string, TemplateField[]> = {
  [TARGET_MAIN]: [field('f_main_no', '单号')],
  [TARGET_DETAIL]: [field('f_flow_qty', '数量')],
  [SRC_TABLE]: [field('f_cust_name', '客户名称')]
};

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => {
      if (templateId === TARGET_TEMPLATE_ID) return TARGET_TABLES;
      if (templateId === SRC_TEMPLATE_ID) return SRC_TABLES;
      return [];
    },
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
/** A 组：SourceTreePicker 打桩（只关心①段除它之外还渲不渲染别的东西），其余子组件同批既有惯例打桩。 */
const stubsWithPickerStub: Record<string, Component> = {
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
  JoinDesignerDialog: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};
/** B/C 组：不打桩 SourceTreePicker/ExpressionInput——要拿真实组件的 select emit 与 dockColumns prop。 */
const stubsWithRealPickerAndInput: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: ButtonStub,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  NRadioGroup: SlotPassthrough,
  NRadio: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  JoinDesignerDialog: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(
  initial: ExpressionModel,
  writeOperation: WriteOperation,
  stubs: Record<string, Component>,
  host: ExpressionHost = makeHost()
): Promise<{ wrapper: VueWrapper; editor: VueWrapper; current: () => ExpressionModel }> {
  const current = ref<ExpressionModel>(initial);
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
              writeOperation: writeOperation || undefined,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs } });
  await flushMounted();
  const editor = wrapper.findComponent(ExpressionEditor as any);
  return { wrapper, editor, current: () => current.value };
}

const CTX: V4ModelAdapterContext = {
  templateId: TARGET_TEMPLATE_ID,
  readableTextOf: (_id, tokenized) => tokenized,
  tableLabelOf: ({ data_table_id }) =>
    data_table_id === TARGET_MAIN ? '库存主表' : data_table_id === TARGET_DETAIL ? '库存流水' : undefined
};

describe('目标先行 A：①目标段只渲染一个数据表选择器，段名按操作三选一', () => {
  it.each([
    ['insert', '新增目标'],
    ['update', '修改目标'],
    ['delete', '删除目标']
  ] as const)('operation=%s：段名=%s，段内除选择器外无其它文字/chip/提示条', async (op, segTitle) => {
    const { wrapper } = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID), op, stubsWithPickerStub);
    try {
      const panel = wrapper.find('[data-testid="qb-write-target-panel"]');
      expect(panel.exists()).toBe(true);
      expect(panel.text()).toContain(segTitle);
      // 段名 + 选择器触发按钮文案（「选择写目标表」）之外不应再有任何文字——用总文本长度粗筛，
      // 再用具体旧措辞逐一反证（旧「写目标」段名/badge/父记录锚定/来源别名 NSelect 相关文案）。
      expect(panel.text()).not.toContain('写入目标');
      expect(panel.text()).not.toContain('父记录');
      expect(panel.text()).not.toContain('来源别名');
      expect(panel.find('[data-testid="expression-write-target-selected"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});

/**
 * 用户 2026-09-10 反馈：①目标段应与②来源段上下放置、宽度一致（同在左栏），把右栏空间留给
 * ③定位条件（左栏只留①删除目标②来源），左右栏比例与 insert/update 一致（不再走 qb-left-full）。
 */
describe('用户 09-10 反馈：①目标段与②来源段上下同宽同栏，右栏留给④填充字段', () => {
  it.each(['insert', 'update'] as const)(
    'operation=%s：目标段是左栏容器的第一个子段、与来源段同父；右栏不含目标段',
    async op => {
      const { wrapper } = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID), op, stubsWithPickerStub);
      try {
        const left = wrapper.find('[data-testid="qb-left"]');
        expect(left.exists()).toBe(true);
        const targetPanel = left.find('[data-testid="qb-write-target-panel"]');
        const sourcePanel = left.find('[data-testid="qb-source-panel"]');
        expect(targetPanel.exists()).toBe(true);
        expect(sourcePanel.exists()).toBe(true);
        // 同父：目标段与来源段都是 qb-left 的直接子元素（同栏、纵向排列）。
        expect(targetPanel.element.parentElement).toBe(left.element);
        expect(sourcePanel.element.parentElement).toBe(left.element);
        // 目标段是左栏容器的第一个子段（序号顺延 ①②③ 的视觉前提）。
        expect(left.element.children[0]).toBe(targetPanel.element);
        // 右栏（④填充字段）不含目标段——目标选择已收口在左栏，不再重复渲染。
        const right = wrapper.find('.qb-right');
        expect(right.exists()).toBe(true);
        expect(right.find('[data-testid="qb-write-target-panel"]').exists()).toBe(false);
      } finally {
        wrapper.unmount();
      }
    }
  );

  it('operation=delete：目标段仍在左栏第一位；左栏不含定位条件段，右栏改放定位条件（不再左栏铺满）', async () => {
    const { wrapper } = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID), 'delete', stubsWithPickerStub);
    try {
      const left = wrapper.find('[data-testid="qb-left"]');
      expect(left.exists()).toBe(true);
      expect(left.classes()).not.toContain('qb-left-full');
      const targetPanel = left.find('[data-testid="qb-write-target-panel"]');
      expect(targetPanel.exists()).toBe(true);
      expect(left.element.children[0]).toBe(targetPanel.element);
      // 左栏不再含定位条件段（②来源段之后没有第三个 qb-panel）。
      expect(left.find('[data-testid="qb-condition-panel"]').exists()).toBe(false);
      // 右栏渲染，且其内容就是定位条件段（③，同 qb-condition-panel 测试锚点）。
      const right = wrapper.find('.qb-right');
      expect(right.exists()).toBe(true);
      expect(right.find('[data-testid="qb-condition-panel"]').exists()).toBe(true);
      // 右栏不含④填充字段的自动匹配按钮（delete 无字段列表，未命中写字段分支）。
      expect(right.find('[data-testid="write-auto-match-btn"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('目标先行 B：选扩展表目标（insert→扩展表）后隐含来源恒在、候选池未引用不入源', () => {
  it('「目标」分组（dock/⊞ 快捷面板候选）含主表 + 扩展表；finalize() 后隐含来源（主表）恒在 sources，候选池（扩展表本身）未引用不入 sources', async () => {
    const { wrapper, editor, current } = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID), 'insert', stubsWithRealPickerAndInput);
    try {
      // ②来源面板自己也有一个（非 single）SourceTreePicker（"＋添加来源"）——①目标段的是
      // single=true 那一个，同 expressionEditorWriteTargetNoSiblingSeed.spec.ts 既有手法用 props 过滤。
      const pickers = editor.findAllComponents(SourceTreePicker as any);
      const picker = pickers.find(p => p.props('single') === true);
      expect(picker, '①目标段的 SourceTreePicker（single=true）应存在').toBeTruthy();
      // SourceTreePicker 的 select emit 携带的是**归一化**角色（'main'|'detail'，见其 TableRole
      // 类型），不是后端原始 table_role（'main'|'extension'）——onSelectWriteTarget 直接拿它当
      // target_table_role 用，须传归一化值。
      picker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_DETAIL, role: 'detail', name: '库存流水' }]);
      await flushMounted();

      expect(current().target.target_template_id).toBe(TARGET_TEMPLATE_ID);
      expect(current().target.target_data_table_id).toBe(TARGET_DETAIL);

      // 「目标」分组：取①字段行（写目标表自身字段）挂载的 ExpressionInput 的 dockColumns prop，
      // 断言其 sources 里存在一列 header=「目标」（editor.writeTargetGroupLabel 默认词表）、
      // 内含主表（隐含来源）与扩展表（目标本身，候选池）两张表。
      const rowInput = editor.findComponent(ExpressionInput as any);
      expect(rowInput.exists()).toBe(true);
      const dockColumns = rowInput.props('dockColumns') as { sources: { header: string; tables: { label: string }[] }[] };
      const targetGroup = dockColumns.sources.find(c => c.header === '目标');
      expect(targetGroup, `目标分组未找到，实际列头：${dockColumns.sources.map(c => c.header).join(',')}`).toBeTruthy();
      const labels = targetGroup!.tables.map(t => t.label);
      expect(labels.some(l => l.includes('库存主表'))).toBe(true);
      expect(labels.some(l => l.includes('库存流水'))).toBe(true);

      const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
      const writeTargetSources = finalized.source.tables.filter(t => t.is_write_target);
      // 隐含来源（目标模板主表）恒在——即便一个字段都没配、where 也没写。
      const implicit = writeTargetSources.find(t => t.data_table_id === TARGET_MAIN);
      expect(implicit).toBeTruthy();
      expect(implicit?.role).toBe('main');
      const pool = writeTargetSources.find(t => t.data_table_id === TARGET_DETAIL);
      expect(pool).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });
});

describe('目标先行 C：候选池表被引用后，reconcile 把它正式登记进 sources', () => {
  it('字段赋值原文引用候选池表（目标本身）的普通方括号引用后，该表带 is_write_target 标记正式入 sources', async () => {
    // 直接构造"已选中扩展表目标 + 一条字段赋值已引用候选池表自身字段"的模型（等价于用户在④段用
    // ⊞ 快捷面板点了候选池的字段后落盘的文本），验证 onMounted 迁移 reconcile 会把它正式登记。
    const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
    m.target = {
      target_template_id: TARGET_TEMPLATE_ID,
      target_data_table_id: TARGET_DETAIL,
      target_table_role: 'detail',
      operation: 'insert',
      outputs: [{ target_field_id: 'f_flow_qty', expression: { kind: 'raw', text: '[库存流水].[数量]' } }]
    };
    const { wrapper, current } = await mountEditor(m, 'insert', stubsWithRealPickerAndInput);
    try {
      const writeTargetSources = current().source.tables.filter(t => t.is_write_target);
      const pool = writeTargetSources.find(t => t.data_table_id === TARGET_DETAIL);
      expect(pool, `is_write_target 来源：${JSON.stringify(writeTargetSources)}`).toBeTruthy();
      expect(pool?.role).toBe('detail');
      // 隐含来源（主表）依旧恒在。
      expect(writeTargetSources.some(t => t.data_table_id === TARGET_MAIN)).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('目标先行 D：读兼容——存量 target.instance_id / parent 文档', () => {
  function makeLegacyUpdateDoc(): V4WriteNodeDocument {
    return {
      schema_version: 'kimpo.write-node/v4',
      syntax_profile: 'kimposql.mssql/v1',
      query: {
        sources: [
          { kind: 'catalog', instance_id: 'cat-inv-main', alias: '库存主表', template_id: TARGET_TEMPLATE_ID, data_table_id: TARGET_MAIN }
        ],
        joins: [],
        options: { distinct: false, business_timezone: 'UTC' },
        filter: { expression_id: 'filter', purpose: 'filter', source_text: '[库存主表].[单号] = 1', refs: [] }
      },
      operation: 'update',
      // 决议 ⑧ 之前的旧形状：target 只落 instance_id。
      target: { instance_id: 'cat-inv-main' },
      assignments: [{ target_field_id: 'f_main_no', expression: { expression_id: 'asg_f_main_no', purpose: 'output', source_text: "'X'", refs: [] } }]
    };
  }

  it('update 旧文档 target.instance_id 读入折算：编辑器打开即视为"已选目标"（④段渲染字段行，不显示未选目标提示）', async () => {
    const model = v4WriteDocToExpressionModel(makeLegacyUpdateDoc(), CTX);
    expect(model.target.target_template_id).toBe(TARGET_TEMPLATE_ID);
    expect(model.target.target_data_table_id).toBe(TARGET_MAIN);

    const { wrapper } = await mountEditor(model, 'update', stubsWithPickerStub);
    try {
      // 未选目标时④段渲染 NEmpty（桩为 SlotPassthrough，其 default slot 为空——用 write-rows 存在
      // 与否判定"已选目标"更直接：写字段行容器只在 writeTargetChosen 为真时渲染）。
      expect(wrapper.find('.write-rows').exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it.each([
    ['instance', { kind: 'instance' as const, instance_id: 'cat-inv-main' }],
    ['expression', { kind: 'expression' as const, expression: { expression_id: 'write_parent', purpose: 'output' as const, source_text: "'p'", refs: [] } }],
    ['current_form', { kind: 'current_form' as const }]
  ])('存量文档带 parent.kind=%s：编辑器不产出任何父记录锚定 UI；保存收口后 doc.parent 消失', async (_label, parent) => {
    const doc: V4WriteNodeDocument = { ...makeLegacyUpdateDoc(), parent };
    const model = v4WriteDocToExpressionModel(doc, CTX);
    expect(model.target.parent).toBeUndefined();

    const { wrapper, editor } = await mountEditor(model, 'update', stubsWithPickerStub);
    try {
      expect(wrapper.text()).not.toContain('父记录');
      const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
      const back = expressionModelToV4WriteDoc(finalized, doc, CTX);
      expect(back.parent).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });
});


/** ExpressionSqlEditor 桩（同 conditionFooterSyntaxStatus.spec.ts 既定手法）：只暴露
 *  focus/focusRange/insertAtCursor 三个实例方法（面板打开后会调 focus），真正的文本输入改经
 *  `editor.vm.$emit('update:modelValue', text)` 驱动，避免在 jsdom 里驱动真实 CodeMirror。 */
const SqlEditorStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { expose }) {
    expose({ focus() {}, focusRange() {}, insertAtCursor() {} });
    return () => h('div', { 'data-testid': 'sql-editor-stub' });
  }
});
/** G3 组：条件弹窗（ConditionEditorDialog→ExpressionDialogShell→AdvancedExpressionPanel）真实渲染，
 *  只把重依赖 ExpressionSqlEditor/OperatorFunctionBar/FieldTreeDock/ConditionTree 打桩——与
 *  stubsWithRealPickerAndInput 的差别只是不再桩 ConditionEditorDialog。 */
const stubsWithRealConditionDialog: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: ButtonStub,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  NRadioGroup: SlotPassthrough,
  NRadio: SlotPassthrough,
  JoinSettingsPanel: SlotPassthrough,
  JoinDesignerDialog: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough,
  OperatorFunctionBar: SlotPassthrough,
  ExpressionSqlEditor: SqlEditorStub
};

/** 文本里 `[表名].[字段]`（普通方括号引用，V4/brackets 语法）里的表名清单，按出现顺序去重
 *  ——足够本文件的假体宿主用来模拟"服务端只认作用域信封里已登记的表"这一判据，不追求覆盖
 *  本报表/暂存表前缀等其余语法形态（本文件场景不涉及）。 */
function bracketTableRefsInText(text: string): string[] {
  const names: string[] = [];
  const re = /\[([^[\]]+)\]\.\[[^[\]]+\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}
function makeDeadlockAwareHost(getModel: () => ExpressionModel): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async templateId => (templateId === TARGET_TEMPLATE_ID ? TARGET_TABLES : []),
    listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => {
      const known = new Set(
        getModel()
          .source.tables.filter(t => t.source_type === 'template')
          .map(t => TARGET_TABLES.find(x => x.data_table_id === t.data_table_id)?.table_name ?? t.data_table_id)
      );
      const missing = bracketTableRefsInText(req.text).find(name => !known.has(name));
      if (missing) {
        return {
          purpose: req.purpose,
          diagnostics: [
            { code: 'E_REF_NOT_FOUND', severity: 'error' as const, message: `找不到来源实例 "${missing}"`, start: 0, end: 0, rune_start: 0, rune_end: 0 }
          ]
        };
      }
      return {
        purpose: req.purpose,
        condition: req.purpose === 'where' ? { logic: 'and' as const, items: [] } : undefined,
        text_source: { text: req.text, pack_revision: 'test', digest: `d:${req.text}` },
        diagnostics: []
      };
    }
  };
}

function updateDetailTargetModel(): ExpressionModel {
  const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
  m.target = {
    target_template_id: TARGET_TEMPLATE_ID,
    target_data_table_id: TARGET_DETAIL,
    target_table_role: 'detail',
    operation: 'update',
    outputs: []
  };
  return m;
}

/** 打开②筛选条件弹窗、经 SqlEditorStub 灌入文本、点「确定」——三步共用手法，各用例只是断言点不同。
 *  返回值 confirmBtn 供调用方复核 disabled 态。 */
async function openConditionDialogAndType(wrapper: VueWrapper, text: string): Promise<{ confirmBtn: DOMWrapper<Element> }> {
  await wrapper.find('[data-testid="qb-condition-view"]').trigger('click');
  await flushMounted();
  const sqlEditor = wrapper.findComponent(SqlEditorStub as any);
  expect(sqlEditor.exists(), '条件弹窗应已渲染真实 AdvancedExpressionPanel/ExpressionSqlEditor 桩').toBe(true);
  sqlEditor.vm.$emit('update:modelValue', text);
  await flushMounted();
  const confirmBtnEl = document.body.querySelector('.exd-footer [data-kdlf="confirm"]');
  expect(confirmBtnEl, '确定按钮应已渲染（KDialog 传送到 document.body）').not.toBeNull();
  return { confirmBtn: new DOMWrapper(confirmBtnEl as Element) };
}

describe('候选池表「引用即入源」死锁——条件对话框引用后立即登记', () => {
  it('条件对话框引用候选池表（库存主表）→ 确认按钮不再被禁用、点确定成功；source.tables 出现该表且 is_write_target', async () => {
    // 假体 lowerText 要读"当前模型"，而"当前模型"读口（下面的 current）恰恰是 mountEditor 的
    // 返回值——host 参数又必须在调用 mountEditor 之前就传入。闭包内对 const current 的引用只在
    // lowerText 真正被调用（条件弹窗打开之后）那一刻才求值，晚于本条 const 语句本身执行完毕，
    // 不撞 TDZ（与递归箭头函数 `const f = () => f()` 同一惯例，非本文件独有写法）。
    const { wrapper, current } = await mountEditor(
      updateDetailTargetModel(),
      'update',
      stubsWithRealConditionDialog,
      makeDeadlockAwareHost(() => current())
    );
    try {
      const { confirmBtn } = await openConditionDialogAndType(wrapper, '[库存主表].[单号] = 1');
      // 判据不用"确定按钮 disabled 属性"——1.5s 防抖检查此刻还没跑完，disabled 在这一瞬间恒为
      // false，测不出死锁；真正权威的判据是点「确定」后 host.lowerText 是否真的解析成功：面板
      // confirm() 只在成功时才 emit confirmWhere（见其头注释①~④步），死锁复现时假体 lowerText
      // 会报「找不到来源实例」、面板不 emit、where_text_source 永远不会落到父级模型。
      await confirmBtn.trigger('click');
      await flushMounted();
      const writeTargetSources = current().source.tables.filter(t => t.is_write_target);
      const pool = writeTargetSources.find(t => t.data_table_id === TARGET_MAIN);
      expect(pool, `候选池表应已登记：${JSON.stringify(current().source.tables)}`).toBeTruthy();
      expect(pool?.role).toBe('main');
      // where 已确认落盘（条件弹窗确定成功的直接证据——若还在死锁中，确定会被服务端校验拦下，
      // where_text_source 不会出现）。
      expect(current().where_text_source?.text).toContain('库存主表');
    } finally {
      wrapper.unmount();
    }
  });

  it('确认后又把引用删掉（条件清空）：下正常 update() 会把投机登记的候选池表按"未引用"剔除', async () => {
    // 直接从"已引用"起手（等价于上一条用例确认后的状态），验证反向路径：引用消失后候选池表被剔除
    // ——与决议 ⑧ 既有 B 组用例（未引用不入 sources）同一收口判据，touch 回调不改变这条收口规则。
    const m = updateDetailTargetModel();
    m.where = { logic: 'and', items: [{ predicate: { left: { kind: 'raw', text: '[库存主表].[单号]' }, op: 'eq', right: { kind: 'const', value: 1 } } }] };
    m.where_text_source = { text: '[库存主表].[单号] = 1', pack_revision: 'test', digest: 'd0' };
    const { wrapper, current } = await mountEditor(m, 'update', stubsWithRealConditionDialog, makeDeadlockAwareHost(() => current()));
    try {
      expect(current().source.tables.some(t => t.is_write_target && t.data_table_id === TARGET_MAIN)).toBe(true);
      const { confirmBtn } = await openConditionDialogAndType(wrapper, '');
      await confirmBtn.trigger('click');
      await flushMounted();
      expect(current().where_text_source).toBeUndefined();
      expect(current().source.tables.some(t => t.data_table_id === TARGET_MAIN)).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('is_write_target 来源展示——虚线 chip、无删除按钮、无「未关联」', () => {
  it('候选池表登记后（G3 修法生效）隐含来源+候选池表天然 auto 关联：两行皆虚线、皆无删除按钮、皆不显示「未关联」', async () => {
    const m = updateDetailTargetModel();
    m.where = { logic: 'and', items: [{ predicate: { left: { kind: 'raw', text: '[库存主表].[单号]' }, op: 'eq', right: { kind: 'const', value: 1 } } }] };
    m.where_text_source = { text: '[库存主表].[单号] = 1', pack_revision: 'test', digest: 'd0' };
    const { wrapper, current } = await mountEditor(m, 'update', stubsWithRealConditionDialog, makeDeadlockAwareHost(() => current()));
    try {
      const writeTargetSources = current().source.tables.filter(t => t.is_write_target);
      expect(writeTargetSources.map(t => t.data_table_id).sort()).toEqual([TARGET_DETAIL, TARGET_MAIN].sort());
      // 两者同模板、主+明细两角色互补——reconcile ②自动 record_id 关联步骤会把它们判定为一对，
      // 不需要模板层特别处理 is_write_target 就天然落 'auto'（不落 'unlinked'）。
      const autoJoin = current().source.joins.find(
        j => j.auto_record_id && writeTargetSources.some(t => t.alias === j.left_alias) && writeTargetSources.some(t => t.alias === j.right_alias)
      );
      expect(autoJoin, `应有一条自动 record_id 关联覆盖两张 is_write_target 来源：${JSON.stringify(current().source.joins)}`).toBeTruthy();

      const rows = wrapper.findAll('[data-write-target="true"]');
      expect(rows.length, 'is_write_target 来源行数').toBe(2);
      for (const row of rows) {
        expect(row.classes()).toContain('qb-src-row-write-target');
        expect(row.find('.qb-src-remove').exists(), '不应有删除按钮').toBe(false);
        expect(row.find('.qb-join-badge-unlinked').exists(), '不应显示「未关联」').toBe(false);
      }
    } finally {
      wrapper.unmount();
    }
  });
});

describe('is_write_target 配对组与本报表来源共存时，隐藏关联覆盖每个来源', () => {
  const RPT_MAIN = 'dt_report_main';
  const REPORT_TABLES: TemplateDataTable[] = [table(RPT_MAIN, 'main', '出库单的主表')];
  const CTX_WITH_REPORT: V4ModelAdapterContext = {
    ...CTX,
    tableLabelOf: ({ data_table_id }) =>
      data_table_id === TARGET_MAIN
        ? '库存主表'
        : data_table_id === TARGET_DETAIL
          ? '库存流水'
          : data_table_id === RPT_MAIN
            ? '出库单的主表'
            : undefined
  };
  function makeHostWithReport(): ExpressionHost {
    return {
      listTemplates: async () => [],
      listTables: async templateId =>
        templateId === TARGET_TEMPLATE_ID ? TARGET_TABLES : templateId === REPORT_TEMPLATE_ID ? REPORT_TABLES : [],
      listFields: async (_templateId, dataTableId) => HOST_FIELDS[dataTableId] ?? (dataTableId === RPT_MAIN ? [field('f_order_no', '单据号')] : []),
      compilePreview: async () => ({ valid: true, arg_count: 0 }),
      loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
      lowerText: async req => ({ purpose: req.purpose, text_source: { text: req.text, pack_revision: 'test', digest: 'd' }, diagnostics: [] })
    };
  }
  function updateDetailWithReportRef(): ExpressionModel {
    const m = emptyExpressionModel(REPORT_TEMPLATE_ID);
    m.target = {
      target_template_id: TARGET_TEMPLATE_ID,
      target_data_table_id: TARGET_DETAIL,
      target_table_role: 'detail',
      operation: 'update',
      outputs: [{ target_field_id: 'f_flow_qty', expression: { kind: 'raw', text: "'已核对'" } }]
    };
    m.where_text_source = {
      text: "[库存主表].[单号] = 本报表.[出库单的主表].[单据号] 并且 [库存流水].[数量] > 0",
      pack_revision: 'test',
      digest: 'd0'
    };
    return m;
  }

  it('finalize() + expressionModelToV4WriteDoc：query.joins 覆盖每一条 sources（目标模板配对表不再是孤儿）', async () => {
    const { wrapper, editor, current } = await mountEditor(
      updateDetailWithReportRef(),
      'update',
      stubsWithRealPickerAndInput,
      makeHostWithReport()
    );
    try {
      // 前置：隐含来源（扩展表自身）+ 候选池（主表，已被条件引用）+ 本报表主表三者都已登记。
      const writeTargetSources = current().source.tables.filter(t => t.is_write_target);
      expect(writeTargetSources.map(t => t.data_table_id).sort()).toEqual([TARGET_DETAIL, TARGET_MAIN].sort());
      expect(current().source.tables.some(t => t.is_context)).toBe(true);

      const finalized = (editor.vm as unknown as { finalize: () => ExpressionModel }).finalize();
      const prevDoc: V4WriteNodeDocument = {
        schema_version: 'kimpo.write-node/v4',
        syntax_profile: 'kimposql.mssql/v1',
        query: {
          sources: [],
          joins: [],
          options: { distinct: false, business_timezone: 'UTC' },
          filter: { expression_id: 'filter', purpose: 'filter', source_text: '', refs: [] }
        },
        operation: 'update',
        target: {},
        assignments: []
      };
      const doc = expressionModelToV4WriteDoc(finalized, prevDoc, CTX_WITH_REPORT);

      const introduced = new Set(doc.query.joins.map(j => j.right_instance_id));
      const rootId = doc.query.sources[0]?.instance_id;
      const orphans = doc.query.sources.filter(s => s.instance_id !== rootId && !introduced.has(s.instance_id));
      expect(orphans, `孤儿来源（从未被任何 Join 引入）：${JSON.stringify(orphans)}`).toEqual([]);

      // 目标模板配对表之间仍是①段要求的记录身份关联（[明细].[parent_record_id] = [主表].[record_id]），
      // 不是恒真占位符——只有"配对组→其它来源"这一条才是隐藏的 1=1。
      const recordIdJoin = doc.query.joins.find(
        j => j.on.refs.some(r => r.field_id === 'sys:parent_record_id') && j.on.refs.some(r => r.field_id === 'sys:record_id')
      );
      expect(recordIdJoin, `应有一条目标模板主+明细的记录身份关联：${JSON.stringify(doc.query.joins)}`).toBeTruthy();
    } finally {
      wrapper.unmount();
    }
  });
});

describe('is_write_target 配对结构存在但候选池未引用的过渡态不判「未关联」', () => {
  it('insert→扩展表目标：刚选目标（候选池尚未引用）时隐含来源（主表）不显示「未关联」徽标、无删除按钮', async () => {
    const { wrapper, editor, current } = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID), 'insert', stubsWithRealPickerAndInput);
    try {
      const picker = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      expect(picker).toBeTruthy();
      picker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_DETAIL, role: 'detail', name: '库存流水' }]);
      await flushMounted();

      // 前置：候选池（扩展表自身）此刻确实还没被引用登记，只有隐含来源（主表）单张，且没有任何
      // auto_record_id 关联（两端都在场才会合成）——正是本条要钉住的过渡态。
      const writeTargetSources = current().source.tables.filter(t => t.is_write_target);
      expect(writeTargetSources.map(t => t.data_table_id)).toEqual([TARGET_MAIN]);
      expect(current().source.joins.some(j => j.auto_record_id)).toBe(false);

      const row = wrapper.find('[data-write-target="true"]');
      expect(row.exists()).toBe(true);
      expect(row.classes()).toContain('qb-src-row-write-target');
      // 核心断言（根因钉点）：不应展示「未关联」——它与其它来源之间恒是隐藏的恒真关联，
      // 不需要（也不该）用户手动去配一条关联。
      expect(row.find('.qb-join-badge-unlinked').exists(), '不应显示「未关联」').toBe(false);
      expect(row.find('.qb-src-remove').exists(), '不应有删除按钮').toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('候选池表引用清空后从 sources 移除（连同其隐藏关联）', () => {
  it('条件对话框引用候选池表（库存主表）确认后正式入源；重开条件对话框清空并确认后，候选池表被剔除', async () => {
    const { wrapper, current } = await mountEditor(
      updateDetailTargetModel(),
      'update',
      stubsWithRealConditionDialog,
      makeDeadlockAwareHost(() => current())
    );
    try {
      // ① 先引用候选池表并确认——正式入源。
      const { confirmBtn } = await openConditionDialogAndType(wrapper, '[库存主表].[单号] = 1');
      await confirmBtn.trigger('click');
      await flushMounted();
      const poolAfterConfirm = current().source.tables.find(t => t.is_write_target && t.data_table_id === TARGET_MAIN);
      expect(poolAfterConfirm, `候选池表应已登记：${JSON.stringify(current().source.tables)}`).toBeTruthy();
      const pairJoinAfterConfirm = current().source.joins.some(j => j.auto_record_id);
      expect(pairJoinAfterConfirm, '候选池表登记后应有配对记录身份关联').toBe(true);

      // ② 重新打开条件对话框，把文本清空并确认——候选池表不再被任何引用（条件文本、填充表达式、
      // 关联条件）覆盖，应从 sources 移除，其隐藏关联（① 与隐含来源的配对记录身份关联）随之清空。
      const { confirmBtn: confirmBtn2 } = await openConditionDialogAndType(wrapper, '');
      await confirmBtn2.trigger('click');
      await flushMounted();

      expect(current().where_text_source).toBeUndefined();
      const poolAfterClear = current().source.tables.some(t => t.data_table_id === TARGET_MAIN);
      expect(poolAfterClear, `候选池表应已移除：${JSON.stringify(current().source.tables)}`).toBe(false);
      // 隐含来源（目标表自身）仍恒在。
      expect(current().source.tables.some(t => t.is_write_target && t.data_table_id === TARGET_DETAIL)).toBe(true);
      // 配对记录身份关联须随候选池表一并清空——不留一条端点已不存在的悬空关联。
      expect(current().source.joins.some(j => j.auto_record_id)).toBe(false);
      expect(current().source.joins.some(j => j.left_alias === targetSourceAliasForTest(TARGET_MAIN) || j.right_alias === targetSourceAliasForTest(TARGET_MAIN))).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});

/** 供上方释放用例断言用：与 ExpressionEditor.vue 内部 targetSourceAlias 同一确定性派生
 *  （`tgt-<data_table_id>`），本文件不 import 生产内部函数，按已知常量形态直写。 */
function targetSourceAliasForTest(dataTableId: string): string {
  return `tgt-${dataTableId}`;
}

describe('①目标段按钮回显「模板名 · 表名」', () => {
  it('新选目标后按钮文案从「选择写目标表」变为「模板名 · 表名」', async () => {
    const { wrapper, editor, current } = await mountEditor(emptyExpressionModel(REPORT_TEMPLATE_ID), 'update', stubsWithRealPickerAndInput);
    try {
      const picker = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      expect(picker).toBeTruthy();
      expect(picker!.props('triggerLabel')).toBe('选择写目标表');
      picker!.vm.$emit('select', [{ templateId: TARGET_TEMPLATE_ID, dataTableId: TARGET_DETAIL, role: 'detail', name: '库存流水' }]);
      await flushMounted();
      expect(current().target.target_data_table_id).toBe(TARGET_DETAIL);
      const pickerAfter = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      expect(pickerAfter!.props('triggerLabel')).toContain('库存流水');
      expect(pickerAfter!.props('triggerLabel')).toContain('·');
    } finally {
      wrapper.unmount();
    }
  });

  it('打开存量文档（target.instance_id 折算路径）：按钮文案同样回显「模板名 · 表名」，不落回「选择写目标表」', async () => {
    const doc: V4WriteNodeDocument = {
      schema_version: 'kimpo.write-node/v4',
      syntax_profile: 'kimposql.mssql/v1',
      query: {
        sources: [{ kind: 'catalog', instance_id: 'cat-inv-main', alias: '库存主表', template_id: TARGET_TEMPLATE_ID, data_table_id: TARGET_MAIN }],
        joins: [],
        options: { distinct: false, business_timezone: 'UTC' },
        filter: { expression_id: 'filter', purpose: 'filter', source_text: '[库存主表].[单号] = 1', refs: [] }
      },
      operation: 'update',
      target: { instance_id: 'cat-inv-main' },
      assignments: []
    };
    const model = v4WriteDocToExpressionModel(doc, CTX);
    const { wrapper, editor } = await mountEditor(model, 'update', stubsWithRealPickerAndInput);
    try {
      const picker = editor.findAllComponents(SourceTreePicker as any).find(p => p.props('single') === true);
      expect(picker!.props('triggerLabel')).toContain('库存主表');
      expect(picker!.props('triggerLabel')).toContain('·');
      expect(picker!.props('triggerLabel')).not.toBe('选择写目标表');
    } finally {
      wrapper.unmount();
    }
  });
});

describe('E：写模式 dock 分组顺序——目标列挪到 sources 数组末尾', () => {
  it('sources 数组：用户手动加的来源表列在前，「目标」列在最后；current（本报表）独立于 sources 之外恒存在', async () => {
    const model = emptyExpressionModel(REPORT_TEMPLATE_ID);
    model.source.tables = [
      { alias: 't1', source_type: 'template', template_id: SRC_TEMPLATE_ID, data_table_id: SRC_TABLE, is_context: false, role: 'main' }
    ];
    model.target = {
      target_template_id: TARGET_TEMPLATE_ID,
      target_data_table_id: TARGET_DETAIL,
      target_table_role: 'detail',
      operation: 'insert',
      outputs: []
    };
    const { wrapper, editor } = await mountEditor(model, 'insert', stubsWithRealPickerAndInput);
    try {
      const rowInput = editor.findComponent(ExpressionInput as any);
      expect(rowInput.exists()).toBe(true);
      const dockColumns = rowInput.props('dockColumns') as { current: { header: string }; sources: { header: string }[] };
      // current（本报表列）恒独立存在——FieldTreeDock 渲染时恒放在最前，不受本轮改判影响。
      expect(dockColumns.current).toBeTruthy();
      expect(dockColumns.sources.length).toBeGreaterThan(1);
      const last = dockColumns.sources[dockColumns.sources.length - 1];
      expect(last.header, `sources 末列应为「目标」，实际列头：${dockColumns.sources.map(c => c.header).join(',')}`).toBe('目标');
      // 目标列之前不应再出现第二个「目标」列（目标分组唯一，且不在非末尾位置）。
      expect(dockColumns.sources.slice(0, -1).every(c => c.header !== '目标')).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});

describe('F：②来源选择器禁选写目标相关表（目标表 + 配对主/扩展表）', () => {
  it('insert→扩展表：②来源（非 single）SourceTreePicker 的 disabledTableIds 含隐含来源（主表）与候选池（扩展表本身）；disabledTableTitle 非空', async () => {
    const model = emptyExpressionModel(REPORT_TEMPLATE_ID);
    model.target = {
      target_template_id: TARGET_TEMPLATE_ID,
      target_data_table_id: TARGET_DETAIL,
      target_table_role: 'detail',
      operation: 'insert',
      outputs: []
    };
    const { wrapper, editor } = await mountEditor(model, 'insert', stubsWithRealPickerAndInput);
    try {
      const pickers = editor.findAllComponents(SourceTreePicker as any);
      // ②来源面板的「添加来源」选择器是 single!==true 那一个（①目标段的是 single=true，同批既有手法）。
      const sourcePicker = pickers.find(p => p.props('single') !== true);
      expect(sourcePicker, '②来源「添加来源」SourceTreePicker 应存在').toBeTruthy();
      const disabledIds = sourcePicker!.props('disabledTableIds') as string[];
      expect(disabledIds).toEqual(expect.arrayContaining([TARGET_MAIN, TARGET_DETAIL]));
      expect(sourcePicker!.props('disabledTableTitle')).toBeTruthy();
    } finally {
      wrapper.unmount();
    }
  });

  it('取数模式（无 writeOperation）：②来源选择器不禁选任何表（disabledTableIds 为空，disabledTableTitle 未传）', async () => {
    const model = emptyExpressionModel(REPORT_TEMPLATE_ID);
    const { wrapper, editor } = await mountEditor(model, '', stubsWithRealPickerAndInput);
    try {
      const pickers = editor.findAllComponents(SourceTreePicker as any);
      const sourcePicker = pickers.find(p => p.props('single') !== true);
      expect(sourcePicker, '②来源「添加来源」SourceTreePicker 应存在').toBeTruthy();
      expect(sourcePicker!.props('disabledTableIds')).toEqual([]);
      expect(sourcePicker!.props('disabledTableTitle')).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });
});
