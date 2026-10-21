import { describe, expect, it } from 'vitest';
import { computed, defineComponent, h, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import QuickFieldPicker from './QuickFieldPicker.vue';
import FieldTreeDock from './FieldTreeDock.vue';
import FieldTreePanel from './FieldTreePanel.vue';
import { provideExpressionEditorScopeOptions } from './host';
import zhCN from './locales/zh-CN';
import type { TemplateField } from './types';
import type { SourceTableLite } from './rawSerialize';

/**
 *
 * 本文件直接挂载真实消费方 QuickFieldPicker.vue / FieldTreeDock.vue，用一个只做 provide 的
 * Harness 包装组件模拟"挂在 ExpressionEditor 子树内"，钉死它们确实读到了 inject 到的作用域选项。
 */

function field(fieldId: string, name: string, dataType: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: fieldId,
    field_name: name,
    data_type: dataType,
    display_style: 'text',
    sort_no: 0,
    is_searchable: true,
    is_filterable: true,
    is_sortable: true,
    is_list_visible: true
  };
}

const FIELDS: TemplateField[] = [field('f1', '编码', 'text'), field('f2', '验收单附件', 'attachment')];

/** 只做 provide 的包装组件：模拟"挂在 ExpressionEditor 子树内"的作用域注入环境——
 *  ExpressionEditor.vue 自身正是用同一手法（computed 包一层 props）调用
 *  provideExpressionEditorScopeOptions，这里照抄以贴近真实接线，而不是直接 mock inject。
 *  不传 opts 的字段即等价于该 prop 未传（缺省 false / 空数组），与 ExpressionEditor.vue 的
 *  `computed(() => !!props.disableSystemVariables)` / `computed(() => props.unsupportedFieldTypes ?? [])`
 *  同一归一化口径。 */
function withScope(
  opts: { disableSystemVariables?: boolean; unsupportedFieldTypes?: string[] },
  renderChild: () => ReturnType<typeof h>
): Component {
  return defineComponent({
    name: 'ScopeHarness',
    setup() {
      provideExpressionEditorScopeOptions({
        disableSystemVariables: computed(() => !!opts.disableSystemVariables),
        unsupportedFieldTypes: computed(() => opts.unsupportedFieldTypes ?? [])
      });
      return () => renderChild();
    }
  });
}

describe('QuickFieldPicker：disableSystemVariables + unsupportedFieldTypes', () => {
  const sourceTables: SourceTableLite[] = [{ alias: 't1', dataTableId: 'dt1', name: '物料', fields: FIELDS }];

  // 🔴 stub key 必须是 'Popover' 而非 'NPopover'——naive-ui NPopover 内部注册名与其对外具名导出不同，
  // 按名 stub 走的是"实例自身声明的 name"这条兜底路径，同 quickFieldPickerFollowsPointer.spec.ts
  // 头注释钉过的既有坑，这里沿用同一 stub 手法，让 popover 内容无条件渲染以便断言列表项。
  const PopoverPassthrough = defineComponent({
    name: 'PopoverPassthroughStub',
    setup(_props, { slots }) {
      return () => h('div', [slots.trigger?.(), slots.default?.()]);
    }
  });
  function mountPicker(opts: { disableSystemVariables?: boolean; unsupportedFieldTypes?: string[] } = {}) {
    const Harness = withScope(opts, () => h(QuickFieldPicker, { show: true, sourceTables, formTables: [] }));
    const wrapper = mount(Harness, { global: { stubs: { Popover: PopoverPassthrough } } });
    return { wrapper, picker: wrapper.findComponent(QuickFieldPicker as any) };
  }

  it("unsupportedFieldTypes=['attachment']：附件字段行置灰 + 「暂不支持」提示，点击不 emit pick；文本字段不受影响", async () => {
    const { picker } = mountPicker({ unsupportedFieldTypes: ['attachment'] });

    const attachRow = picker.find('[data-field-id="f2"]');
    expect(attachRow.exists()).toBe(true);
    expect(attachRow.classes()).toContain('qfp-item--unsupported');
    expect(attachRow.attributes('title')).toBe(zhCN['drawer.fieldTypeUnsupported']);
    await attachRow.trigger('click');
    expect(picker.emitted('pick')).toBeUndefined();

    const textRow = picker.find('[data-field-id="f1"]');
    expect(textRow.classes()).not.toContain('qfp-item--unsupported');
    expect(textRow.attributes('title')).toBeUndefined();
    await textRow.trigger('click');
    expect(picker.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'f1' }]);
  });

  it('未挂在作用域内（无 Harness，直接裸挂载）：回落缺省值，附件字段维持既有可选行为', async () => {
    // 不经 withScope，直接 mount QuickFieldPicker——等价于 useExpressionEditorScopeOptions()
    // 的 inject 落空，验证"未 provide 时"缺省不禁用、不置灰的既有行为。
    const wrapper = mount(QuickFieldPicker, {
      props: { show: true, sourceTables, formTables: [] },
      global: { stubs: { Popover: PopoverPassthrough } }
    });
    const attachRow = wrapper.find('[data-field-id="f2"]');
    expect(attachRow.classes()).not.toContain('qfp-item--unsupported');
    await attachRow.trigger('click');
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'f2' }]);
  });

  it('disableSystemVariables=true：不出现「变量」分组', () => {
    const { picker } = mountPicker({ disableSystemVariables: true });
    const groupTitles = picker.findAll('.qfp-group-title').map(el => el.text());
    expect(groupTitles).not.toContain(zhCN['drawer.tabVars']);
  });

  it('不传（默认不禁用）：「变量」分组正常出现', () => {
    const { picker } = mountPicker();
    const groupTitles = picker.findAll('.qfp-group-title').map(el => el.text());
    expect(groupTitles).toContain(zhCN['drawer.tabVars']);
  });

  it('两个编辑器实例一个开 disableSystemVariables 一个不开，同时存活也互不影响（钉死不再是模块单例）', () => {
    const disabled = mountPicker({ disableSystemVariables: true });
    const enabled = mountPicker({ disableSystemVariables: false });

    // 两者同时挂载期间互相查询，任一方都不应受另一方影响。
    expect(disabled.picker.findAll('.qfp-group-title').map(el => el.text())).not.toContain(zhCN['drawer.tabVars']);
    expect(enabled.picker.findAll('.qfp-group-title').map(el => el.text())).toContain(zhCN['drawer.tabVars']);

    // 反向再查一遍（防御顺序偏差）：确认上面两条断言不是巧合。
    expect(enabled.picker.findAll('.qfp-group-title').map(el => el.text())).toContain(zhCN['drawer.tabVars']);
    expect(disabled.picker.findAll('.qfp-group-title').map(el => el.text())).not.toContain(zhCN['drawer.tabVars']);
  });

  it('编辑器卸载后不留全局状态：卸载 disableSystemVariables=true 的实例后，新挂载的裸实例仍正常显示变量', () => {
    const { wrapper } = mountPicker({ disableSystemVariables: true });
    wrapper.unmount();

    // 卸载后新挂载一个完全独立、未 provide 任何作用域的裸实例——若曾经用模块单例实现，
    // 忘记在 onBeforeUnmount 里复位就会让这个新实例也看不到变量；provide/inject 天然不会有
    // 这个问题（provide 的值随组件实例一起被回收），此用例钉死这一点。
    const freshWrapper = mount(QuickFieldPicker, {
      props: { show: true, sourceTables, formTables: [] },
      global: { stubs: { Popover: PopoverPassthrough } }
    });
    const groupTitles = freshWrapper.findAll('.qfp-group-title').map(el => el.text());
    expect(groupTitles).toContain(zhCN['drawer.tabVars']);
  });
});

describe('FieldTreeDock：disableSystemVariables + unsupportedFieldTypes', () => {
  const currentColumn = { header: '本报表', tables: [] };
  const sourceColumns = [{ header: '物料', tables: [{ alias: 't1', label: '物料', fields: FIELDS }] }];

  function mountDock(opts: { disableSystemVariables?: boolean; unsupportedFieldTypes?: string[] } = {}) {
    const Harness = withScope(opts, () => h(FieldTreeDock, { currentColumn, sourceColumns }));
    const wrapper = mount(Harness);
    return { wrapper, dock: wrapper.findComponent(FieldTreeDock as any) };
  }

  it("unsupportedFieldTypes=['attachment']：附件字段行置灰 + 「暂不支持」提示，点击不 emit pick", async () => {
    const { dock } = mountDock({ unsupportedFieldTypes: ['attachment'] });

    const rows = dock.findAll('.ftd-field:not(.ftd-var)');
    const attachRow = rows.find(r => r.text() === '验收单附件');
    expect(attachRow, '附件字段行应仍然渲染（不再整体隐藏）').toBeTruthy();
    expect(attachRow!.classes()).toContain('ftd-field--unsupported');
    expect(attachRow!.attributes('title')).toBe(zhCN['drawer.fieldTypeUnsupported']);
    await attachRow!.trigger('click');
    expect(dock.emitted('pick')).toBeUndefined();

    const textRow = rows.find(r => r.text() === '编码');
    expect(textRow!.classes()).not.toContain('ftd-field--unsupported');
    await textRow!.trigger('click');
    expect(dock.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'f1' }]);
  });

  it('未挂在作用域内（无 Harness，直接裸挂载）：回落缺省值，附件字段维持既有可选行为', async () => {
    const wrapper = mount(FieldTreeDock, { props: { currentColumn, sourceColumns } });
    const attachRow = wrapper.findAll('.ftd-field').find(r => r.text() === '验收单附件');
    expect(attachRow!.classes()).not.toContain('ftd-field--unsupported');
    await attachRow!.trigger('click');
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'f2' }]);
  });

  it('disableSystemVariables=true：「变量与函数」列不出现任何变量条目', () => {
    const { dock } = mountDock({ disableSystemVariables: true });
    expect(dock.find('.ftd-var').exists()).toBe(false);
  });

  it('不传（默认不禁用）：「变量与函数」列正常出现变量条目', () => {
    const { dock } = mountDock();
    expect(dock.findAll('.ftd-var').length).toBeGreaterThan(0);
  });

  it('两个编辑器实例一个传 unsupportedFieldTypes 一个不传，同时存活也互不影响（钉死不再是模块单例）', () => {
    const restricted = mountDock({ unsupportedFieldTypes: ['attachment'] });
    const normal = mountDock();

    const restrictedAttachRow = restricted.dock.findAll('.ftd-field').find(r => r.text() === '验收单附件');
    const normalAttachRow = normal.dock.findAll('.ftd-field').find(r => r.text() === '验收单附件');
    expect(restrictedAttachRow!.classes()).toContain('ftd-field--unsupported');
    expect(normalAttachRow!.classes()).not.toContain('ftd-field--unsupported');
  });

  it('编辑器卸载后不留全局状态：卸载 unsupportedFieldTypes 实例后，新挂载的裸实例附件字段仍可选', async () => {
    const { wrapper } = mountDock({ unsupportedFieldTypes: ['attachment'] });
    wrapper.unmount();

    const freshWrapper = mount(FieldTreeDock, { props: { currentColumn, sourceColumns } });
    const attachRow = freshWrapper.findAll('.ftd-field').find(r => r.text() === '验收单附件');
    expect(attachRow!.classes()).not.toContain('ftd-field--unsupported');
    await attachRow!.trigger('click');
    expect(freshWrapper.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'f2' }]);
  });
});

describe('FieldTreePanel：disableSystemVariables + unsupportedFieldTypes（B4，作用域注入）', () => {
  const sourceTables = [{ alias: 't1', dataTableId: 'dt1', name: '物料', fields: FIELDS }];

  function mountPanel(opts: { disableSystemVariables?: boolean; unsupportedFieldTypes?: string[] } = {}) {
    const Harness = withScope(opts, () => h(FieldTreePanel, { sourceTables, formTables: [] }));
    const wrapper = mount(Harness);
    return { wrapper, panel: wrapper.findComponent(FieldTreePanel as any) };
  }

  it("unsupportedFieldTypes=['attachment']：附件字段行置灰 + 「暂不支持」提示，点击不 emit pick", async () => {
    const { panel } = mountPanel({ unsupportedFieldTypes: ['attachment'] });

    const rows = panel.findAll('.ft-field:not(.ft-var)');
    const attachRow = rows.find(r => r.text() === '验收单附件');
    expect(attachRow, '附件字段行应仍然渲染（不再整体隐藏）').toBeTruthy();
    expect(attachRow!.classes()).toContain('ft-field--unsupported');
    expect(attachRow!.attributes('title')).toBe(zhCN['drawer.fieldTypeUnsupported']);
    await attachRow!.trigger('click');
    expect(panel.emitted('pick')).toBeUndefined();

    const textRow = rows.find(r => r.text() === '编码');
    expect(textRow!.classes()).not.toContain('ft-field--unsupported');
    await textRow!.trigger('click');
    expect(panel.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'f1' }]);
  });

  it('未挂在作用域内（无 Harness，直接裸挂载）：回落缺省值，附件字段维持既有可选行为', async () => {
    const wrapper = mount(FieldTreePanel, { props: { sourceTables, formTables: [] } });
    const attachRow = wrapper.findAll('.ft-field').find(r => r.text() === '验收单附件');
    expect(attachRow!.classes()).not.toContain('ft-field--unsupported');
    await attachRow!.trigger('click');
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'f2' }]);
  });

  it('两个实例一个传 unsupportedFieldTypes 一个不传，同时存活也互不影响', () => {
    const restricted = mountPanel({ unsupportedFieldTypes: ['attachment'] });
    const normal = mountPanel();

    const restrictedAttachRow = restricted.panel.findAll('.ft-field').find(r => r.text() === '验收单附件');
    const normalAttachRow = normal.panel.findAll('.ft-field').find(r => r.text() === '验收单附件');
    expect(restrictedAttachRow!.classes()).toContain('ft-field--unsupported');
    expect(normalAttachRow!.classes()).not.toContain('ft-field--unsupported');
  });
});
