import { describe, expect, it } from 'vitest';
import { isConditionGroupEffectivelyEmpty, writeWhereMissing } from './writeWhereGuard';
import { emptyExpressionModel } from './types';
import type { ConditionGroup, Predicate, TextSource, ValueRef } from './types';


/** 一条最小合法谓词（f = 1），仅用于占位"这里有一条真实谓词"，具体字段/值与判空逻辑无关。 */
function samplePredicate(): Predicate {
  return { left: { kind: 'const', value: 1 }, op: 'eq', right: { kind: 'const', value: 1 } };
}

describe('isConditionGroupEffectivelyEmpty', () => {
  it('undefined → 空', () => {
    expect(isConditionGroupEffectivelyEmpty(undefined)).toBe(true);
  });

  it('null → 空', () => {
    expect(isConditionGroupEffectivelyEmpty(null)).toBe(true);
  });

  it('items 为空数组 → 空', () => {
    const g: ConditionGroup = { logic: 'and', items: [] };
    expect(isConditionGroupEffectivelyEmpty(g)).toBe(true);
  });

  it('仅含一个空子组 → 空（不能只挡"完全不填"这一种形状）', () => {
    const g: ConditionGroup = { logic: 'and', items: [{ group: { logic: 'and', items: [] } }] };
    expect(isConditionGroupEffectivelyEmpty(g)).toBe(true);
  });

  it('嵌套两层空子组 → 空（递归判空，不因嵌套层数漏判）', () => {
    const g: ConditionGroup = {
      logic: 'and',
      items: [
        {
          group: {
            logic: 'or',
            items: [{ group: { logic: 'and', items: [] } }]
          }
        }
      ]
    };
    expect(isConditionGroupEffectivelyEmpty(g)).toBe(true);
  });

  it('深层嵌套里有一条真实谓词 → 非空（无论嵌套多深，出现一条真实谓词即非空）', () => {
    const g: ConditionGroup = {
      logic: 'and',
      items: [
        {
          group: {
            logic: 'or',
            items: [
              { group: { logic: 'and', items: [] } }, // 同层一个空子组
              { group: { logic: 'and', items: [{ predicate: samplePredicate() }] } } // 深层一条真实谓词
            ]
          }
        }
      ]
    };
    expect(isConditionGroupEffectivelyEmpty(g)).toBe(false);
  });

  it('顶层直接一条谓词 → 非空', () => {
    const g: ConditionGroup = { logic: 'and', items: [{ predicate: samplePredicate() }] };
    expect(isConditionGroupEffectivelyEmpty(g)).toBe(false);
  });
});

describe('writeWhereMissing', () => {
  /** 写模式（update/delete）最小骨架：target.operation 由各用例覆盖，where 由各用例设置。 */
  function writeModel(operation: '' | 'insert' | 'update' | 'delete', overrides: { where?: ConditionGroup; where_expr?: ValueRef } = {}) {
    const m = emptyExpressionModel('tpl_x');
    m.target.operation = operation;
    if (overrides.where) m.where = overrides.where;
    if (overrides.where_expr) m.where_expr = overrides.where_expr;
    return m;
  }

  it('update + where 未设置（undefined）→ 空条件不阻断', () => {
    expect(writeWhereMissing(writeModel('update'))).toBe(false);
  });

  it('delete + where 只含空子组 → 空条件不阻断', () => {
    const where: ConditionGroup = { logic: 'and', items: [{ group: { logic: 'and', items: [] } }] };
    expect(writeWhereMissing(writeModel('delete', { where }))).toBe(false);
  });

  it('update + where 含一条真实谓词 → 不缺失，不拦截', () => {
    const where: ConditionGroup = { logic: 'and', items: [{ predicate: samplePredicate() }] };
    expect(writeWhereMissing(writeModel('update', { where }))).toBe(false);
  });

  it('insert + where 未设置 → 不拦（新增操作不使用定位条件）', () => {
    expect(writeWhereMissing(writeModel('insert'))).toBe(false);
  });

  it('fill（operation 为空串）+ where 未设置 → 不拦（取数回填不是写动作）', () => {
    expect(writeWhereMissing(writeModel(''))).toBe(false);
  });

  it('update + where 为空但携带 where_expr → 不拦', () => {
    const m = writeModel('update');
    m.where_expr = { kind: 'const', value: 1 };
    expect(writeWhereMissing(m)).toBe(false);
  });

  function sampleTextSource(text: string): TextSource {
    return { text, pack_revision: 'alice-v4', digest: '' };
  }

  it('update + 无结构化 where + where_text_source.text 非空白（V4 路线）→ 不拦', () => {
    const m = writeModel('update');
    m.where_text_source = sampleTextSource('[单号] = [来源].[单号]');
    expect(writeWhereMissing(m)).toBe(false);
  });

  it('delete + where_text_source.text 全是空白（trim 后为空）→ 空条件不阻断', () => {
    const m = writeModel('delete');
    m.where_text_source = sampleTextSource('   ');
    expect(writeWhereMissing(m)).toBe(false);
  });

  it('update + 未设置 where_text_source（字段整个缺席）→ 空条件不阻断（同未设置 where 的既有用例）', () => {
    const m = writeModel('update');
    expect(m.where_text_source).toBeUndefined();
    expect(writeWhereMissing(m)).toBe(false);
  });
});
