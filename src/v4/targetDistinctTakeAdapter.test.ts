import { describe, expect, it } from 'vitest';
import { expressionModelToV4Doc, v4DocToExpressionModel, type V4ModelAdapterContext } from './expressionModelAdapter';
import { emptyExtractNodeDocument } from './emptyNodeDocument';
import type { V4ExtractNodeDocument } from './nodeDocument';

/**
 *  - 正向：排除重复未提供按产品默认 true、前 N 条未提供回退 query.options.take；提供了则用目标级。
 *  - 反向：distinct 恒显式写回（缺省 true）；take 只写 >=1 的整数，其余省略键。
 *  - 查询级 options.distinct/take 仍原样往返（存量回退 + 图表/暂存共享值），编辑器不再改它。
 */

const CTX: V4ModelAdapterContext = { templateId: 'tpl-1', readableTextOf: (_id, tokenized) => tokenized };

function docWithTargets(): V4ExtractNodeDocument {
  const doc = emptyExtractNodeDocument();
  doc.query.options = { distinct: false, take: 7, business_timezone: 'UTC' };
  doc.targets = [
    {
      target_id: 'tgt-a',
      target_data_table_id: 'tbl-a',
      table_role: 'detail',
      outputs: [{ target_field_id: 'f1', expression: { expression_id: 'out:tbl-a:f1', purpose: 'output', source_text: '1', refs: [] }, fill_strategy: 'overwrite' }]
      // 未提供 distinct/take → 回退查询级
    },
    {
      target_id: 'tgt-b',
      target_data_table_id: 'tbl-b',
      table_role: 'detail',
      distinct: true,
      take: 3,
      outputs: [{ target_field_id: 'f2', expression: { expression_id: 'out:tbl-b:f2', purpose: 'output', source_text: '2', refs: [] }, fill_strategy: 'overwrite' }]
    }
  ];
  return doc;
}

describe('适配层：逐目标 distinct/take', () => {
  it('正向：排除重复未提供按产品默认 true（不回退查询级 false）；前 N 条未提供回退 query.options.take；提供了用目标级', () => {
    const model = v4DocToExpressionModel(docWithTargets(), CTX);
    const a = model.targets!.find(t => t.target_data_table_id === 'tbl-a')!;
    const b = model.targets!.find(t => t.target_data_table_id === 'tbl-b')!;
    expect(a.distinct).toBe(true);
    expect(a.take).toBe(7);
    expect(b.distinct).toBe(true);
    expect(b.take).toBe(3);
    // 查询级仍映射到 3.4 顶层（存量口径）
    expect(model.distinct).toBe(false);
    expect(model.limit).toBe(7);
  });

  it('反向：distinct 恒显式写回（缺省 true），take 写 >=1 整数、不限/非法写显式 0；查询级原样保留', () => {
    const prev = docWithTargets();
    const model = v4DocToExpressionModel(prev, CTX);
    const a = model.targets!.find(t => t.target_data_table_id === 'tbl-a')!;
    const b = model.targets!.find(t => t.target_data_table_id === 'tbl-b')!;
    delete a.distinct; // 模拟编辑器未写（缺省）
    a.take = 0; // 非法 → 省略
    b.take = 4.6; // 向下取整
    const out = expressionModelToV4Doc(model, prev, CTX);
    const oa = out.targets.find(t => t.target_data_table_id === 'tbl-a')!;
    const ob = out.targets.find(t => t.target_data_table_id === 'tbl-b')!;
    expect(oa.distinct).toBe(true);
    expect(oa.take).toBe(0); // 3.4 侧「不限」→ V4 显式 0，不能省略键（否则回退到查询级的 7）
    expect(ob.distinct).toBe(true);
    expect(ob.take).toBe(4);
    expect(out.query.options.distinct).toBe(false);
    expect(out.query.options.take).toBe(7);
  });

  it('往返幂等：目标级已显式的文档正反一次后 distinct/take 不变', () => {
    const prev = docWithTargets();
    const out = expressionModelToV4Doc(v4DocToExpressionModel(prev, CTX), prev, CTX);
    const ob = out.targets.find(t => t.target_data_table_id === 'tbl-b')!;
    expect(ob.distinct).toBe(true);
    expect(ob.take).toBe(3);
    // 未提供的目标经一次往返被物化为有效值（排除重复=产品默认 true、前 N 条=查询级 7；此后不再依赖回退）
    const oa = out.targets.find(t => t.target_data_table_id === 'tbl-a')!;
    expect(oa.distinct).toBe(true);
    expect(oa.take).toBe(7);
  });

  it('正向：显式 0 读成 3.4 的「不限」（undefined），不是 0', () => {
    const doc = docWithTargets();
    doc.targets[1].take = 0;
    const model = v4DocToExpressionModel(doc, CTX);
    expect(model.targets!.find(t => t.target_data_table_id === 'tbl-b')!.take).toBeUndefined();
  });
});
