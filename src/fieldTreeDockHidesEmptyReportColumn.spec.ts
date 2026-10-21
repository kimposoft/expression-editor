/**
 * 「本报表」列（当前模板列）在本报表压根没有可引用字段时整列隐藏。
 *
 * 背景：树坞的第一列恒由编辑器按 templateId/formTables 自动垫上，而数据源列是用户显式「添加来源」
 * 才有的。视图设计器这类无本报表上下文的调用域里，第一列会顶着一张「无字段」空卡片占一格宽度，
 * 属纯噪音——用户要求这种情况直接不渲染该卡片。规则只作用于当前模板列：数据源列是用户自己加的，
 * 空着也要留着让他看得见。
 *
 * 本文件直接挂载 FieldTreeDock.vue（表达式编辑器弹窗与筛选条件编辑器弹窗共用同一棵树坞：两者
 * 都经 ExpressionDialogShell → AdvancedExpressionPanel 挂载本组件，故一处判据覆盖两个编辑器）。
 */
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import FieldTreeDock from './FieldTreeDock.vue';
import zhCN from './locales/zh-CN';
import type { DockColumn, TemplateField } from './types';

function field(fieldId: string, name: string): TemplateField {
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

const REPORT_HEADER = '本报表';
const SOURCE_COLUMNS: DockColumn[] = [
  { header: 'V-201 全渠道库存流水', tables: [{ alias: 't1', label: 'V-201 全渠道库存流水', fields: [field('f_no', '单据号')] }] }
];

function mountDock(currentColumn: DockColumn, sourceColumns: DockColumn[] = SOURCE_COLUMNS): VueWrapper {
  return mount(FieldTreeDock, { props: { currentColumn, sourceColumns } });
}

/** 数据表列的列头文案清单（排除恒在最右的「变量与函数」列——它不是数据表列，与本规则无关）。 */
function tableColumnHeaders(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.ftd-col:not(.ftd-col-vars) .ftd-col-header').map(h => h.text());
}

describe('FieldTreeDock：没有本报表就隐藏「本报表」卡片', () => {
  it('本报表列一张表都没有：整列不渲染，只剩数据源列（+ 变量与函数列）', () => {
    const wrapper = mountDock({ header: REPORT_HEADER, tables: [] });
    expect(tableColumnHeaders(wrapper)).toEqual(['V-201 全渠道库存流水']);
    // 「无字段」空态也随之消失——它此前正是那张空卡片里唯一的内容。
    expect(wrapper.text()).not.toContain(zhCN['drawer.noFields']);
  });

  it('本报表列有表但表里零字段：同样整列不渲染（判据是"有无字段"，不是"有无表"）', () => {
    const wrapper = mountDock({ header: REPORT_HEADER, tables: [{ alias: 'bt0', label: '采购入库', fields: [] }] });
    expect(tableColumnHeaders(wrapper)).toEqual(['V-201 全渠道库存流水']);
  });

  it('本报表列有字段：照旧渲染在最前，字段可点选', async () => {
    const wrapper = mountDock({
      header: REPORT_HEADER,
      tables: [{ alias: 'bt0', label: '采购入库', fields: [field('f_amt', '金额')] }]
    });
    expect(tableColumnHeaders(wrapper)).toEqual([REPORT_HEADER, 'V-201 全渠道库存流水']);
    const row = wrapper.findAll('.ftd-field:not(.ftd-var)').find(r => r.text() === '金额');
    await row!.trigger('click');
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 'bt0', field_id: 'f_amt' }]);
  });

  it('本报表有字段但当前搜索没命中：仍渲染该列并走「无匹配」占位（隐藏判据不掺搜索态，避免边打字边整列消失）', async () => {
    const wrapper = mountDock({
      header: REPORT_HEADER,
      tables: [{ alias: 'bt0', label: '采购入库', fields: [field('f_amt', '金额')] }]
    });
    await wrapper.find('.ftd-search input').setValue('查无此字段');
    expect(tableColumnHeaders(wrapper)).toEqual([REPORT_HEADER, 'V-201 全渠道库存流水']);
    expect(wrapper.text()).toContain(zhCN['editor.dockNoMatch']);
  });

  it('本报表列无字段但带降级提示标记（视图字段暂不支持）：仍渲染——那条提示文案就是它要展示的内容', () => {
    const wrapper = mountDock({
      header: REPORT_HEADER,
      tables: [{ alias: 'bt0', label: '视图来源', fields: [], viewFieldsUnsupported: true }]
    });
    expect(tableColumnHeaders(wrapper)).toEqual([REPORT_HEADER, 'V-201 全渠道库存流水']);
    expect(wrapper.text()).toContain(zhCN['drawer.viewFieldsUnsupported']);
  });

  it('规则只管本报表列：用户显式添加的空数据源列照旧渲染并显示「无字段」', () => {
    const wrapper = mountDock({ header: REPORT_HEADER, tables: [] }, [
      { header: '物料主数据的主表', tables: [{ alias: 't1', label: '物料主数据的主表', fields: [] }] }
    ]);
    expect(tableColumnHeaders(wrapper)).toEqual(['物料主数据的主表']);
    expect(wrapper.text()).toContain(zhCN['drawer.noFields']);
  });
});
