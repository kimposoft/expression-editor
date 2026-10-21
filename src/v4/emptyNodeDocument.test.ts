import { describe, expect, it } from 'vitest';
import { emptyExtractNodeDocument, isExtractNodeDocument } from './emptyNodeDocument';

/**
 * ①壳侧首次挂载 V4 配置面（旧节点尚无 params.extract_v4）时兜底出的空文档形状；
 * ②草稿值形状判定（合法 V4 文档 / 非对象 / 缺字段 / 3.4 旧 expression 结构一律判否）。
 */
describe('emptyExtractNodeDocument', () => {
  it('产出的空文档形状完整且 schema_version 正确', () => {
    const doc = emptyExtractNodeDocument();
    expect(doc.schema_version).toBe('kimpo.extract-node/v4');
    expect(doc.syntax_profile).toBe('kimposql.mssql/v1');
    expect(doc.query).toEqual({
      sources: [],
      joins: [],
      options: { distinct: false, business_timezone: 'UTC' }
    });
    expect(doc.targets).toEqual([]);
  });

  it('产出的空文档能通过 isExtractNodeDocument 守卫', () => {
    expect(isExtractNodeDocument(emptyExtractNodeDocument())).toBe(true);
  });
});

describe('isExtractNodeDocument', () => {
  it('接受结构完整的 V4 文档（含非空 sources/targets）', () => {
    const doc = {
      schema_version: 'kimpo.extract-node/v4',
      syntax_profile: 'kimposql.mssql/v1',
      query: { sources: [{ alias: 't1' }], joins: [], options: { distinct: false, business_timezone: 'UTC' } },
      targets: [{ target_id: 'tg1', target_data_table_id: 'tbl-1', table_role: 'main', outputs: [] }]
    };
    expect(isExtractNodeDocument(doc)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['字符串', 'not-a-document'],
    ['空对象', {}],
    ['schema_version 错误', { schema_version: 'alice.extract/v4', query: {}, targets: [] }],
    ['缺 query', { schema_version: 'kimpo.extract-node/v4', targets: [] }],
    ['targets 非数组', { schema_version: 'kimpo.extract-node/v4', query: {}, targets: {} }],
    // 3.4 旧 expression 中间模型结构——must not 被误判为 V4 文档。
    ['3.4 legacy expression 结构', { schema_version: 1, source: { tables: [], joins: [] }, target: { target_data_table_id: 'x', outputs: [] } }]
  ])('拒绝非法形状：%s', (_label, value) => {
    expect(isExtractNodeDocument(value)).toBe(false);
  });
});
