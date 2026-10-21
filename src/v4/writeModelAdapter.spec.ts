/**
 *
 * 判据与 expressionModelAdapter.test.ts 的取数节点往返测试同一原则：**往返之后文档不变**——
 * `expressionModelToV4WriteDoc(v4WriteDocToExpressionModel(doc, CTX), doc, CTX)` 应逐字等于 doc
 * （不带 parent 的新形状文档）。来源/关联/筛选段直接复用取数节点已验证的
 * v4QueryToModelSource/modelToV4Query（见该文件同名单测），本文件只钉写节点专属的目标段
 * （operation/target/assignments/dedupe）三种操作各一例，外加两组读兼容单测：
 * ① 存量 `target.instance_id`（决议 ⑧ 之前 update/delete 的寻址方式）读入折算成
 *   target_template_id/target_data_table_id，保存收口后改写成 {template_id,data_table_id}；
 * ② 存量带 `parent`（三态）的文档读入后模型不产出 target.parent，保存收口后 doc.parent 消失。
 */
import { describe, expect, it, vi } from 'vitest';
import { v4WriteDocToExpressionModel, expressionModelToV4WriteDoc } from './writeModelAdapter';
import { reportInstanceId, type V4ModelAdapterContext } from './expressionModelAdapter';
import type { V4WriteNodeDocument } from './writeNodeDocument';
import type { V4QueryDefinition } from './nodeDocument';
import { emptyWriteNodeDocument } from './writeNodeDocument';
import type { ExpressionModel, SourceTable } from '../types';

const CTX: V4ModelAdapterContext = {
  templateId: 'tpl-order',
  readableTextOf: (_id, tokenized) => tokenized
};

function emptyQuery(overrides: Partial<V4QueryDefinition> = {}): V4QueryDefinition {
  return {
    sources: [],
    joins: [],
    options: { distinct: false, business_timezone: 'UTC' },
    ...overrides
  };
}

/** insert→扩展表：目标先行（决议 ⑧）直接给 template_id/data_table_id；dedupe 同批覆盖。 */
function makeInsertDoc(): V4WriteNodeDocument {
  return {
    schema_version: 'kimpo.write-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: emptyQuery({
      sources: [
        { kind: 'catalog', instance_id: 'cat-main-a1', alias: '主表', app_id: 'app-1', template_id: 'tpl-order', data_table_id: 'tbl-main' }
      ]
    }),
    operation: 'insert',
    target: { template_id: 'tpl-order', data_table_id: 'tbl-detail' },
    assignments: [
      { target_field_id: 'fld-amt', expression: { expression_id: 'asg_fld-amt', purpose: 'output', source_text: '100', refs: [] } },
      { target_field_id: 'fld-name', expression: { expression_id: 'asg_fld-name', purpose: 'output', source_text: "'货品'", refs: [] } }
    ],
    dedupe: { field_ids: ['fld-amt'], scope: 'parent' }
  };
}

/** update：目标先行（决议 ⑧）直接给 template_id/data_table_id（不再落 instance_id），
 *  定位条件落在 query.filter。 */
function makeUpdateDoc(): V4WriteNodeDocument {
  return {
    schema_version: 'kimpo.write-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: emptyQuery({
      sources: [
        { kind: 'catalog', instance_id: 'cat-order-b2', alias: '订单表', app_id: 'app-1', template_id: 'tpl-order', data_table_id: 'tbl-order' }
      ],
      filter: { expression_id: 'filter', purpose: 'filter', source_text: '[订单表].[状态] = 1', refs: [] }
    }),
    operation: 'update',
    target: { template_id: 'tpl-order', data_table_id: 'tbl-order' },
    assignments: [
      { target_field_id: 'fld-amt', expression: { expression_id: 'asg_fld-amt', purpose: 'output', source_text: '999', refs: [] } }
    ]
  };
}

/** delete：无字段映射（assignments 恒空），仅按 query.filter 定位待删记录；目标同样直接给
 *  template_id/data_table_id。 */
function makeDeleteDoc(): V4WriteNodeDocument {
  return {
    schema_version: 'kimpo.write-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: emptyQuery({
      sources: [
        { kind: 'catalog', instance_id: 'cat-order-b2', alias: '订单表', app_id: 'app-1', template_id: 'tpl-order', data_table_id: 'tbl-order' }
      ],
      filter: { expression_id: 'filter', purpose: 'filter', source_text: '[订单表].[已作废] = 1', refs: [] }
    }),
    operation: 'delete',
    target: { template_id: 'tpl-order', data_table_id: 'tbl-order' },
    assignments: []
  };
}

function roundTrip(doc: V4WriteNodeDocument): V4WriteNodeDocument {
  return expressionModelToV4WriteDoc(v4WriteDocToExpressionModel(doc, CTX), doc, CTX);
}

describe('writeModelAdapter 往返', () => {
  it('insert + dedupe：往返一次后等价（target 直接给 template_id/data_table_id，不带 parent）', () => {
    const doc = makeInsertDoc();
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('update：往返一次后等价（target 直接给 template_id/data_table_id，assignments 保真）', () => {
    const doc = makeUpdateDoc();
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('delete：往返一次后等价（assignments 恒空，仅 query.filter 定位条件保真）', () => {
    const doc = makeDeleteDoc();
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('往返两次稳定（第二圈不再产生任何变化，同 expressionModelAdapter 往返测试同一防副作用判据）', () => {
    const doc = makeInsertDoc();
    const once = roundTrip(doc);
    const twice = expressionModelToV4WriteDoc(v4WriteDocToExpressionModel(once, CTX), once, CTX);
    expect(twice).toEqual(once);
  });

  it('parent 缺省（无 parent 键的新形状文档）：正向不产出 target.parent，反向不产出 doc.parent', () => {
    const doc = makeUpdateDoc();
    const model = v4WriteDocToExpressionModel(doc, CTX);
    expect(model.target.parent).toBeUndefined();
    const back = expressionModelToV4WriteDoc(model, doc, CTX);
    expect(back.parent).toBeUndefined();
  });

  it('max_affected_rows：适配器不参与翻译，原样保留 prev 的值', () => {
    const doc: V4WriteNodeDocument = { ...makeUpdateDoc(), max_affected_rows: 500 };
    const back = roundTrip(doc);
    expect(back.max_affected_rows).toBe(500);
  });

  it('来源/关联/筛选段与取数适配器行为一致：update 的 query.filter 原文经 where_text_source 往返保真', () => {
    const doc = makeUpdateDoc();
    const model = v4WriteDocToExpressionModel(doc, CTX);
    expect(model.where_text_source?.text).toBe('[订单表].[状态] = 1');
    expect(model.where).toBeUndefined(); // V4 无引导式条件，只产出文本 sidecar，同取数节点口径
    const back = expressionModelToV4WriteDoc(model, doc, CTX);
    expect(back.query.filter).toEqual(doc.query.filter);
  });
});

describe('writeModelAdapter 读兼容（之前的旧文档）', () => {
  it('update 存量文档只落 target.instance_id：读入按来源段该实例折算成 template_id/data_table_id；保存收口后改写成新形状（不再落 instance_id）', () => {
    const doc = makeUpdateDoc();
    // 模拟决议 ⑧ 之前的旧文档形状：target 只落 instance_id，不落 template_id/data_table_id。
    const legacyDoc: V4WriteNodeDocument = { ...doc, target: { instance_id: 'cat-order-b2' } };
    const model = v4WriteDocToExpressionModel(legacyDoc, CTX);
    expect(model.target.target_template_id).toBe('tpl-order');
    expect(model.target.target_data_table_id).toBe('tbl-order');
    expect(model.target.target_alias).toBeUndefined(); // target_alias 不再被本适配器产出

    const back = expressionModelToV4WriteDoc(model, legacyDoc, CTX);
    expect(back.target).toEqual({ template_id: 'tpl-order', data_table_id: 'tbl-order' });
  });

  it.each([
    ['instance', { kind: 'instance' as const, instance_id: 'cat-main-a1' }],
    ['expression', { kind: 'expression' as const, expression: { expression_id: 'write_parent', purpose: 'output' as const, source_text: "'rec-123'", refs: [] } }],
    ['current_form', { kind: 'current_form' as const }]
  ])('存量文档带 parent.kind=%s：读入后 model 不产出 target.parent；保存收口后 doc.parent 消失', (_label, parent) => {
    const doc = makeInsertDoc();
    const legacyDoc: V4WriteNodeDocument = { ...doc, parent };
    const model = v4WriteDocToExpressionModel(legacyDoc, CTX);
    expect(model.target.parent).toBeUndefined();

    const back = expressionModelToV4WriteDoc(model, legacyDoc, CTX);
    expect(back.parent).toBeUndefined();
    // 其余字段（target/assignments/dedupe）不受 parent 剔除影响，仍与不带 parent 的原文档一致。
    expect(back.target).toEqual(doc.target);
    expect(back.assignments).toEqual(doc.assignments);
    expect(back.dedupe).toEqual(doc.dedupe);
  });
});

describe('writeModelAdapter A1：本报表主表+扩展表来源，往返不产生重复 instance_id', () => {
  const ORDER_TEMPLATE_ID = 'tpl-order';
  const MAIN_TABLE_ID = 'tbl-order-main';
  const DETAIL_TABLE_ID = 'tbl-order-detail';

  const A1_CTX: V4ModelAdapterContext = {
    templateId: ORDER_TEMPLATE_ID,
    readableTextOf: (_id, tokenized) => tokenized,
    tableLabelOf: ({ data_table_id }) =>
      data_table_id === MAIN_TABLE_ID ? '出库单的主表' : data_table_id === DETAIL_TABLE_ID ? '出库明细' : undefined
  };

  /** 与截图一致的 3.4 模型：来源段两条本报表表（bt0 主表 + bt1 扩展表，均 is_context），insert 写目标
   *  是另一模板的表（库存流水，不在来源段），③四条赋值分别引用两张本报表表字段。 */
  function makeInsertModelWithReportSources(): ExpressionModel {
    const tables: SourceTable[] = [
      { alias: 'bt0', source_type: 'template', template_id: ORDER_TEMPLATE_ID, data_table_id: MAIN_TABLE_ID, is_context: true, role: 'main' },
      { alias: 'bt1', source_type: 'template', template_id: ORDER_TEMPLATE_ID, data_table_id: DETAIL_TABLE_ID, is_context: true, role: 'detail' }
    ];
    return {
      schema_version: 2,
      source: { tables, joins: [] },
      target: {
        target_template_id: 'tpl-inventory',
        target_data_table_id: 'tbl-inventory-flow',
        outputs: [
          { target_field_id: 'fld-flow-no', expression: { kind: 'raw', text: "'FLOW-001'" } },
          { target_field_id: 'fld-flow-qty', expression: { kind: 'raw', text: '本报表.[出库明细].[数量]' } },
          { target_field_id: 'fld-flow-order-no', expression: { kind: 'raw', text: '本报表.[出库单的主表].[单号]' } },
          { target_field_id: 'fld-flow-material', expression: { kind: 'raw', text: '本报表.[出库明细].[物料编码]' } }
        ],
        operation: 'insert'
      }
    };
  }

  it('doc1（首次保存）：query.sources 恰两条且 instance_id 唯一', () => {
    const model = makeInsertModelWithReportSources();
    const doc1 = expressionModelToV4WriteDoc(model, emptyWriteNodeDocument('insert'), A1_CTX);
    expect(doc1.query.sources).toHaveLength(2);
    const ids1 = doc1.query.sources.map(s => s.instance_id);
    expect(new Set(ids1).size).toBe(2);
    expect(ids1.every(id => id.startsWith('rpt-'))).toBe(true);
  });

  it('doc1 → model2 → doc2（往返一圈）：query.sources 仍恰两条且 instance_id 唯一（纯适配器层本身不产生重复）', () => {
    const model = makeInsertModelWithReportSources();
    const doc1 = expressionModelToV4WriteDoc(model, emptyWriteNodeDocument('insert'), A1_CTX);
    const model2 = v4WriteDocToExpressionModel(doc1, A1_CTX);
    expect(model2.source.tables.filter(t => t.is_context).every(t => t.alias.startsWith('rpt-'))).toBe(true);
    const doc2 = expressionModelToV4WriteDoc(model2, doc1, A1_CTX);
    expect(doc2.query.sources).toHaveLength(2);
    const ids2 = doc2.query.sources.map(s => s.instance_id);
    expect(new Set(ids2).size).toBe(2);
    // 两圈往返得到的 instance_id 集合应与首次保存一致（确定性派生，见 reportInstanceId）。
    expect(new Set(ids2)).toEqual(new Set(doc1.query.sources.map(s => s.instance_id)));
  });
});

describe('writeModelAdapter 出口防御：query.sources 按 instance_id 去重', () => {
  const ORDER_TEMPLATE_ID = 'tpl-order';
  const MAIN_TABLE_ID = 'tbl-order-main';
  const DETAIL_TABLE_ID = 'tbl-order-detail';
  const A1_CTX: V4ModelAdapterContext = { templateId: ORDER_TEMPLATE_ID, readableTextOf: (_id, tokenized) => tokenized };

  it('模型里混入同 data_table_id、不同别名的重复本报表 context 表（模拟 reconcile 误产出）：出口按 instance_id 去重、保留首条并 console.warn', () => {
    const existingMainAlias = reportInstanceId({ alias: 'placeholder', data_table_id: MAIN_TABLE_ID });
    const existingDetailAlias = reportInstanceId({ alias: 'placeholder', data_table_id: DETAIL_TABLE_ID });
    const tables: SourceTable[] = [
      { alias: existingDetailAlias, source_type: 'template', template_id: ORDER_TEMPLATE_ID, data_table_id: DETAIL_TABLE_ID, is_context: true, role: 'detail' },
      { alias: existingMainAlias, source_type: 'template', template_id: ORDER_TEMPLATE_ID, data_table_id: MAIN_TABLE_ID, is_context: true, role: 'main' },
      // 重复：同 data_table_id=MAIN_TABLE_ID，别名换成 bt0（reconcile 锚点段修复前的错误产出）。
      { alias: 'bt0', source_type: 'template', template_id: ORDER_TEMPLATE_ID, data_table_id: MAIN_TABLE_ID, is_context: true, role: 'main' }
    ];
    const model: ExpressionModel = {
      schema_version: 2,
      source: { tables, joins: [] },
      target: {
        target_template_id: 'tpl-inventory',
        target_data_table_id: 'tbl-inventory-flow',
        outputs: [{ target_field_id: 'fld-flow-qty', expression: { kind: 'raw', text: '本报表.[出库明细].[数量]' } }],
        operation: 'insert'
      }
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const doc = expressionModelToV4WriteDoc(model, emptyWriteNodeDocument('insert'), A1_CTX);
      expect(doc.query.sources).toHaveLength(2);
      const ids = doc.query.sources.map(s => s.instance_id);
      expect(new Set(ids).size).toBe(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('query.sources 存在重复 instance_id');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
