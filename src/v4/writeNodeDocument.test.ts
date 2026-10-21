import { describe, expect, it } from 'vitest';
import { emptyWriteNodeDocument, isWriteNodeDocument } from './writeNodeDocument';

/**
 * emptyWriteNodeDocument / isWriteNodeDocument 单测，覆盖与取数节点
 * emptyNodeDocument.test.ts 同一颗粒度的两个场景：①壳侧首次挂载 V4 写目标配置面时兜底出的空文档
 * 形状；②草稿值形状判定（合法 V4 写节点文档 / 非对象 / 缺字段 / operation 非法值一律判否）。
 */
describe('emptyWriteNodeDocument', () => {
  it.each((['insert', 'update', 'delete'] as const))('产出的空文档形状完整且 operation=%s', op => {
    const doc = emptyWriteNodeDocument(op);
    expect(doc.schema_version).toBe('kimpo.write-node/v4');
    expect(doc.syntax_profile).toBe('kimposql.mssql/v1');
    expect(doc.query).toEqual({
      sources: [],
      joins: [],
      options: { distinct: false, business_timezone: 'UTC' }
    });
    expect(doc.operation).toBe(op);
    expect(doc.target).toEqual({});
    expect(doc.assignments).toEqual([]);
    expect(doc.parent).toBeUndefined();
    expect(doc.dedupe).toBeUndefined();
  });

  it('产出的空文档能通过 isWriteNodeDocument 守卫', () => {
    expect(isWriteNodeDocument(emptyWriteNodeDocument('insert'))).toBe(true);
  });
});

describe('isWriteNodeDocument', () => {
  it('接受结构完整的 V4 写节点文档（含 parent/dedupe）', () => {
    const doc = {
      schema_version: 'kimpo.write-node/v4',
      syntax_profile: 'kimposql.mssql/v1',
      query: { sources: [], joins: [], options: { distinct: false, business_timezone: 'UTC' } },
      operation: 'insert',
      target: { data_table_id: 'tbl-1', template_id: 'tpl-1' },
      assignments: [{ target_field_id: 'f1', expression: { expression_id: 'e1', purpose: 'output', source_text: '1', refs: [] } }],
      parent: { kind: 'current_form' },
      dedupe: { field_ids: ['f1'], scope: 'all' }
    };
    expect(isWriteNodeDocument(doc)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['字符串', 'not-a-document'],
    ['空对象', {}],
    ['schema_version 错误（误传取数节点常量）', { schema_version: 'kimpo.extract-node/v4', query: {}, operation: 'insert' }],
    ['缺 query', { schema_version: 'kimpo.write-node/v4', operation: 'insert' }],
    ['operation 非法值', { schema_version: 'kimpo.write-node/v4', query: {}, operation: 'fill' }],
    // 3.4 旧 expression 中间模型结构——must not 被误判为 V4 写节点文档。
    ['3.4 legacy expression 结构', { schema_version: 1, source: { tables: [], joins: [] }, target: { target_data_table_id: 'x', outputs: [] } }]
  ])('拒绝非法形状：%s', (_label, value) => {
    expect(isWriteNodeDocument(value)).toBe(false);
  });
});
