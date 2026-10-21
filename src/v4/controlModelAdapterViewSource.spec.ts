/**
 * controlModelAdapter 视图来源往返单测。
 *
 * controlModelAdapter 的来源/关联/筛选段直接复用 expressionModelAdapter.ts 的
 * v4QueryToModelSource/modelToV4Query（见该文件头注释），一旦那两个纯函数补上 view 分支，
 * 控件候选查询天然获得"来源可以是视图"的能力，无需在 controlModelAdapter.ts 内另写代码。
 * 本文件只钉住这条"继承免费获得"的性质：控件候选查询文档以视图为来源时往返保真。
 */
import { describe, expect, it } from 'vitest';
import { v4ControlDocToExpressionModel, expressionModelToV4ControlDoc } from './controlModelAdapter';
import type { V4ModelAdapterContext } from './expressionModelAdapter';
import type { V4ControlQueryDocument } from './controlNodeDocument';

const CTX: V4ModelAdapterContext = {
  templateId: 'tpl-order',
  readableTextOf: (_id, tokenized) => tokenized,
  viewLabelOf: viewId => ({ vw_ar_summary: '应收汇总' })[viewId]
};

function makeViewSourcedDoc(): V4ControlQueryDocument {
  return {
    schema_version: 'kimpo.control-query/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [{ kind: 'view', instance_id: 'view-1', alias: '应收汇总', app_id: 'app_fin', view_id: 'vw_ar_summary' }],
      joins: [],
      options: { distinct: true, business_timezone: 'UTC' }
    },
    columns: [
      {
        column_id: 'value',
        name: '客户名称',
        expression: {
          expression_id: 'col:value',
          purpose: 'output',
          source_text: '[客户名称]#{r1}',
          refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'view-1', field_id: 'fld-customer', last_label: '[应收汇总].[客户名称]' }]
        }
      }
    ]
  };
}

describe('controlModelAdapter 视图来源（继承 expressionModelAdapter 的 view 分支）', () => {
  it('正向：视图来源落成 source_type=view，字段不丢', () => {
    const doc = makeViewSourcedDoc();
    const model = v4ControlDocToExpressionModel(doc, CTX);
    expect(model.source.tables).toEqual([
      { alias: 'view-1', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_ar_summary', app_id: 'app_fin', is_context: false }
    ]);
    expect(model.target.outputs[0]?.expression.text_source?.text).toBe('[客户名称]#{r1}');
  });

  it('往返逐字保真：视图来源的控件候选查询文档往返不变', () => {
    const doc = makeViewSourcedDoc();
    const back = expressionModelToV4ControlDoc(v4ControlDocToExpressionModel(doc, CTX), doc, CTX);
    expect(back).toEqual(doc);
  });
});
