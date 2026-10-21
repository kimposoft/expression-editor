import { describe, expect, it } from 'vitest';
import { buildDockColumnsFromLite } from './dockColumns';
import type { SourceTableLite, FormTableLite } from './rawSerialize';
import type { TemplateField, TemplateDataTable } from './types';

/**
 * buildDockColumnsFromLite 单测：覆盖 AdvancedExpressionDialog.vue 无模型上下文（拿不到 template_id）
 * 时的降级构造口径——同表多实例 (N) 后缀、空来源、formTables 为空、降级恒一表一列。
 * 判据对齐 ExpressionEditor.vue:465-499 sourceColumnsForDock「拿不到模板归属」分支与 rawSerialize.ts
 * instanceSuffix 的既有惯例，不另造一套。
 */

/** 最小 TemplateField 夹具，只填断言用到的字段，其余走类型要求的占位默认值。 */
function field(fieldId: string, name: string): TemplateField {
  return {
    field_id: fieldId,
    field_code: fieldId,
    field_name: name,
    data_type: 'string',
    display_style: 'text',
    sort_no: 0,
    is_searchable: false,
    is_filterable: false,
    is_sortable: false,
    is_list_visible: true
  };
}

/** 最小 TemplateDataTable 夹具。 */
function table(dataTableId: string, name: string): TemplateDataTable {
  return {
    data_table_id: dataTableId,
    table_code: dataTableId,
    table_name: name,
    physical_table_name: `t_${dataTableId}`,
    sort_no: 0,
    field_count: 0,
    version_no: 1
  };
}

function sourceTable(alias: string, dataTableId: string, name: string, fields: TemplateField[] = []): SourceTableLite {
  return { alias, dataTableId, name, fields };
}

function formTable(alias: string, dataTableId: string, name: string, fields: TemplateField[] = []): FormTableLite {
  return { table: table(dataTableId, name), fields, alias };
}

describe('buildDockColumnsFromLite', () => {
  it('同一数据表被加入多次时，列头与表标签追加 (N) 序号（沿用 instanceSuffix 既有惯例）', () => {
    const sources: SourceTableLite[] = [
      sourceTable('t1', 'dt-order', '订单', [field('f1', '订单号')]),
      sourceTable('t2', 'dt-order', '订单', [field('f1', '订单号')])
    ];
    const { sources: cols } = buildDockColumnsFromLite(sources, [], '本报表');

    expect(cols).toHaveLength(2);
    expect(cols[0].header).toBe('订单(1)');
    expect(cols[1].header).toBe('订单(2)');
    // 表标签与列头同一份文案（降级口径：列内唯一表复用列头，不重复计算）。
    expect(cols[0].tables[0].label).toBe('订单(1)');
    expect(cols[1].tables[0].label).toBe('订单(2)');
  });

  it('同一数据表只出现一次时，不追加序号', () => {
    const sources: SourceTableLite[] = [sourceTable('t1', 'dt-order', '订单', [field('f1', '订单号')])];
    const { sources: cols } = buildDockColumnsFromLite(sources, [], '本报表');

    expect(cols).toHaveLength(1);
    expect(cols[0].header).toBe('订单');
    expect(cols[0].tables[0].label).toBe('订单');
  });

  it('sourceTables 为空时，数据源列清单为空数组', () => {
    const { sources: cols } = buildDockColumnsFromLite([], [formTable('bt0', 'dt-main', '主表')], '本报表');
    expect(cols).toEqual([]);
  });

  it('formTables 为空时，当前模板列列头仍保留、tables 为空数组', () => {
    const { current } = buildDockColumnsFromLite([sourceTable('t1', 'dt-order', '订单')], [], '本报表');
    expect(current.header).toBe('本报表');
    expect(current.tables).toEqual([]);
  });

  it('降级恒一表一列：多张互不相干的显式来源表各自独立成列，字段原样透传，不按任何维度合并', () => {
    const f1 = field('f1', '订单号');
    const f2 = field('f2', '客户名');
    const sources: SourceTableLite[] = [
      sourceTable('t1', 'dt-order', '订单', [f1]),
      sourceTable('t2', 'dt-customer', '客户', [f2])
    ];
    const { sources: cols } = buildDockColumnsFromLite(sources, [], '本报表');

    expect(cols).toHaveLength(2);
    // 每列只有一张表——即便真实模板归属相同（Lite 形态没有 template_id 可用于分组判定），
    // 降级口径也不会误合并。
    cols.forEach(col => expect(col.tables).toHaveLength(1));
    expect(cols[0].tables[0].fields).toEqual([f1]);
    expect(cols[1].tables[0].fields).toEqual([f2]);
    expect(cols[0].tables[0].alias).toBe('t1');
    expect(cols[1].tables[0].alias).toBe('t2');
  });

  it('当前模板列：formTables 按别名直接映射，字段原样透传，不追加序号（本报表各表天然不重复）', () => {
    const f1 = field('f1', '姓名');
    const forms: FormTableLite[] = [formTable('bt0', 'dt-main', '主表', [f1]), formTable('bt1', 'dt-detail', '明细表')];
    const { current } = buildDockColumnsFromLite([], forms, '销售订单');

    expect(current.header).toBe('销售订单');
    expect(current.tables).toHaveLength(2);
    expect(current.tables[0]).toEqual({ alias: 'bt0', label: '主表', fields: [f1] });
    expect(current.tables[1]).toEqual({ alias: 'bt1', label: '明细表', fields: [] });
  });
});
