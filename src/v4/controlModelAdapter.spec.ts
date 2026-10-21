/**
 * controlModelAdapter 往返保真单测。
 *
 * 判据与 writeModelAdapter.spec.ts 同一原则：**往返之后文档不变**——
 * `expressionModelToV4ControlDoc(v4ControlDocToExpressionModel(doc, CTX), doc, CTX)` 逐字等于 doc。
 * 来源 / 关联 / 筛选段复用取数节点已验证的 v4QueryToModelSource / modelToV4Query，本文件只钉控件专属段：
 * 输出列（暂存形态目标）、排序、去重 / 限量、search / cascade 的保留与悬空引用清理。
 */
import { describe, expect, it } from 'vitest';
import { v4ControlDocToExpressionModel, expressionModelToV4ControlDoc } from './controlModelAdapter';
import { reportInstanceId, type V4ModelAdapterContext } from './expressionModelAdapter';
import { emptyControlQueryDocument, isControlQueryDocument, type V4ControlQueryDocument } from './controlNodeDocument';
import type { ExpressionModel } from '../types';

const CTX: V4ModelAdapterContext = {
  templateId: 'tpl-order',
  appId: 'app-1',
  readableTextOf: (_id, tokenized) => tokenized
};

function makeSelectDoc(): V4ControlQueryDocument {
  return {
    schema_version: 'kimpo.control-query/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [
        { kind: 'catalog', instance_id: 'cat-sup-a1', alias: '供应商档案', app_id: 'app-1', template_id: 'tpl-sup', data_table_id: 'tbl-sup' }
      ],
      joins: [],
      filter: {
        expression_id: 'flt',
        purpose: 'filter',
        source_text: "[状态]#{r1} = '启用'",
        refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-sup-a1', table_id: 'tbl-sup', field_id: 'fld-status', last_label: '[供应商档案].[状态]' }]
      },
      options: { distinct: true, take: 200, business_timezone: 'UTC' }
    },
    columns: [
      {
        column_id: 'value',
        name: '供应商名称',
        expression: {
          expression_id: 'col:value',
          purpose: 'output',
          source_text: '[供应商名称]#{r1}',
          refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-sup-a1', table_id: 'tbl-sup', field_id: 'fld-name', last_label: '[供应商档案].[供应商名称]' }]
        }
      },
      {
        column_id: 'code',
        name: '编码',
        expression: {
          expression_id: 'col:code',
          purpose: 'output',
          source_text: '[供应商编码]#{r1}',
          refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-sup-a1', table_id: 'tbl-sup', field_id: 'fld-code', last_label: '[供应商档案].[供应商编码]' }]
        }
      }
    ],
    order_by: [{ target_field_id: 'code', direction: 'asc' }],
    search: { columns: ['value', 'code'], keyword_slots: 3 }
  };
}

describe('controlModelAdapter', () => {
  it('往返逐字保真（select：两列 + 排序 + 搜索 + 去重限量）', () => {
    const doc = makeSelectDoc();
    const model = v4ControlDocToExpressionModel(doc, CTX);
    expect(model.target.target_kind).toBe('staging');
    expect(model.target.outputs.map(o => o.target_field_id)).toEqual(['value', 'code']);
    expect(model.target.outputs[0]?.target_field_label).toBe('供应商名称');
    expect(model.target.order_by).toEqual([{ target_field_id: 'code', direction: 'asc' }]);
    expect(model.distinct).toBe(true);
    expect(model.limit).toBe(200);
    expect(model.where_text_source?.text).toBe("[状态]#{r1} = '启用'");
    const back = expressionModelToV4ControlDoc(model, doc, CTX);
    expect(back).toEqual(doc);
  });

  it('删除一列后：排序与 search.columns 里的悬空引用被剔除，cascade 原样保留', () => {
    const doc = makeSelectDoc();
    doc.cascade = { mode: 'columns', level_columns: ['value', 'code'] };
    const model = v4ControlDocToExpressionModel(doc, CTX);
    model.target.outputs = model.target.outputs.filter(o => o.target_field_id !== 'code');
    model.targets = [model.target];
    const back = expressionModelToV4ControlDoc(model, doc, CTX);
    expect(back.columns.map(c => c.column_id)).toEqual(['value']);
    expect(back.order_by).toBeUndefined();
    expect(back.search).toEqual({ columns: ['value'], keyword_slots: 3 });
    expect(back.cascade).toEqual(doc.cascade);
  });

  it('新增列：表达式 ID 按 column_id 派生、显示名缺省回落 column_id、限量 0 视为不限', () => {
    const doc = emptyControlQueryDocument();
    const model: ExpressionModel = {
      schema_version: 2,
      source: { tables: [{ alias: 'cat-x', name: '表X', source_type: 'template', template_id: 'tpl-x', data_table_id: 'tbl-x' } as never], joins: [] },
      target: {
        target_template_id: '',
        target_data_table_id: '',
        target_kind: 'staging',
        outputs: [{ target_field_id: 'col_1a2b3c4d', expression: { kind: 'literal', value: 1 } as never }],
        take: 0
      },
      distinct: false
    };
    const back = expressionModelToV4ControlDoc(model, doc, CTX);
    expect(back.columns).toHaveLength(1);
    expect(back.columns[0]?.name).toBe('col_1a2b3c4d');
    expect(back.columns[0]?.expression.expression_id).toBe('col:col_1a2b3c4d');
    expect(back.query.options.distinct).toBe(false);
    expect(back.query.options.take).toBeUndefined();
    expect(isControlQueryDocument(back)).toBe(true);
  });

  it('本报表来源经取数同一条路径：rpt-* 实例与隐藏关联往返保留', () => {
    const doc = makeSelectDoc();
    const rpt = reportInstanceId({ alias: '主表', data_table_id: 'tbl-main' });
    doc.query.sources.push({ kind: 'report', instance_id: rpt, alias: '主表', table_id: 'tbl-main', table_role: 'main' } as never);
    doc.query.joins.push({
      join_id: `j-${rpt}`,
      sequence: 1,
      left_instance_id: 'cat-sup-a1',
      right_instance_id: rpt,
      join_type: 'left',
      on: { expression_id: `j-${rpt}/on`, purpose: 'join_on', source_text: '1 = 1', refs: [] }
    } as never);
    const model = v4ControlDocToExpressionModel(doc, CTX);
    // 隐式本报表关联不进设计态模型。
    expect(model.source.joins).toHaveLength(0);
    const back = expressionModelToV4ControlDoc(model, doc, CTX);
    expect(back.query.sources.map(s => s.instance_id)).toEqual(doc.query.sources.map(s => s.instance_id));
    expect(back.query.joins).toHaveLength(1);
  });
});
