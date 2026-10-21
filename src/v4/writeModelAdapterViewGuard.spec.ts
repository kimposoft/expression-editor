/**
 *
 * 覆盖两件事：① 视图可以正常作为写节点的**驱动来源**（定位条件/赋值表达式引用它，与目录来源
 * 一样参与查询，不受本次改造影响）；② 一旦模型的写目标身份（target_data_table_id）指向了某条
 * 视图来源，适配器必须具名拒绝、不静默转换或吞掉这个错误。
 */
import { describe, expect, it } from 'vitest';
import { v4WriteDocToExpressionModel, expressionModelToV4WriteDoc, WriteTargetCannotBeViewError } from './writeModelAdapter';
import type { V4ModelAdapterContext } from './expressionModelAdapter';
import type { V4WriteNodeDocument } from './writeNodeDocument';
import { emptyWriteNodeDocument } from './writeNodeDocument';

const CTX: V4ModelAdapterContext = {
  templateId: 'tpl-order',
  readableTextOf: (_id, tokenized) => tokenized,
  viewLabelOf: viewId => ({ vw_ar_summary: '应收汇总' })[viewId]
};

/** update 文档：目标是真实数据表，定位条件引用一个视图来源（驱动来源，不是写目标）。 */
function makeUpdateWithViewDriveSource(): V4WriteNodeDocument {
  return {
    schema_version: 'kimpo.write-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [
        { kind: 'catalog', instance_id: 'cat-order-b2', alias: '订单表', app_id: 'app-1', template_id: 'tpl-order', data_table_id: 'tbl-order' },
        { kind: 'view', instance_id: 'view-1', alias: '应收汇总', app_id: 'app_fin', view_id: 'vw_ar_summary' }
      ],
      joins: [],
      options: { distinct: false, business_timezone: 'UTC' },
      filter: { expression_id: 'filter', purpose: 'filter', source_text: '[订单表].[状态] = 1', refs: [] }
    },
    operation: 'update',
    target: { template_id: 'tpl-order', data_table_id: 'tbl-order' },
    assignments: [
      { target_field_id: 'fld-amt', expression: { expression_id: 'asg_fld-amt', purpose: 'output', source_text: '999', refs: [] } }
    ]
  };
}

describe('writeModelAdapter：视图作为驱动来源（正常，不受写目标闸影响）', () => {
  it('往返保真：视图只是驱动来源（不是写目标）时正常翻译，不抛错', () => {
    const doc = makeUpdateWithViewDriveSource();
    const model = v4WriteDocToExpressionModel(doc, CTX);
    expect(model.source.tables.find(t => t.source_type === 'view')).toMatchObject({ view_id: 'vw_ar_summary' });
    expect(() => expressionModelToV4WriteDoc(model, doc, CTX)).not.toThrow();
    const back = expressionModelToV4WriteDoc(model, doc, CTX);
    expect(back.query.sources.find(s => s.kind === 'view')).toEqual(doc.query.sources[1]);
  });
});

describe('writeModelAdapter：写目标不能是视图（具名拒绝）', () => {
  it('target_data_table_id 命中某条视图来源的 view_id ⇒ 抛 WriteTargetCannotBeViewError', () => {
    const prev = emptyWriteNodeDocument('update');
    const model = v4WriteDocToExpressionModel(prev, CTX);
    model.source.tables = [
      ...model.source.tables,
      { alias: 't1', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_ar_summary', is_context: false }
    ];
    // 误把视图的 view_id 当成写目标的 data_table_id（正常 UI 路径不会产生这种模型，见类头注释——
    // 这里模拟直接构造 ExpressionModel 的调用方误用）。
    model.target.target_data_table_id = 'vw_ar_summary';
    model.target.target_template_id = '';
    expect(() => expressionModelToV4WriteDoc(model, prev, CTX)).toThrow(WriteTargetCannotBeViewError);
    expect(() => expressionModelToV4WriteDoc(model, prev, CTX)).toThrow(/写目标不能是视图/);
  });

  it('具名错误带稳定 code，供调用方按 code 而非文案匹配', () => {
    const prev = emptyWriteNodeDocument('insert');
    const model = v4WriteDocToExpressionModel(prev, CTX);
    model.source.tables = [
      { alias: 't1', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_x', is_context: false }
    ];
    model.target.target_data_table_id = 'vw_x';
    try {
      expressionModelToV4WriteDoc(model, prev, CTX);
      expect.unreachable('应抛出 WriteTargetCannotBeViewError');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteTargetCannotBeViewError);
      expect((e as WriteTargetCannotBeViewError).code).toBe('WRITE_TARGET_CANNOT_BE_VIEW');
    }
  });

  it('未选目标（target_data_table_id 为空串）时不误报，即便来源里存在视图', () => {
    const prev = emptyWriteNodeDocument('insert');
    const model = v4WriteDocToExpressionModel(prev, CTX);
    model.source.tables = [
      { alias: 't1', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_x', is_context: false }
    ];
    // target_data_table_id 保持初始空串——"还没选目标"的正常中间态。
    expect(model.target.target_data_table_id).toBe('');
    expect(() => expressionModelToV4WriteDoc(model, prev, CTX)).not.toThrow();
  });

  it('正常写目标（数据表）不受影响，即便来源里还有一条视图', () => {
    const doc = makeUpdateWithViewDriveSource();
    const model = v4WriteDocToExpressionModel(doc, CTX);
    expect(() => expressionModelToV4WriteDoc(model, doc, CTX)).not.toThrow();
  });
});
