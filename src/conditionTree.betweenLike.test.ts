import { describe, expect, it } from 'vitest';
import { applyPredicateOp, isBetweenOp, type Predicate } from './types';

describe('applyPredicateOp：between/not_between（E10）与 like 通配模式（E11）落地规则', () => {
  it('①切到 between：right2 缺失时补一个空 const（不猜测复制 right 的形状）', () => {
    const p: Predicate = { left: { kind: 'const', value: 'x' }, op: 'eq', right: { kind: 'const', value: '100' } };
    const next = applyPredicateOp(p, 'between');
    expect(next.op).toBe('between');
    expect(next.right).toEqual({ kind: 'const', value: '100' }); // 已有 right 原样保留
    expect(next.right2).toEqual({ kind: 'const', value: '' });
  });

  it('①b 已有 right2 时 between↔not_between 互切不丢已填值', () => {
    const p: Predicate = {
      left: { kind: 'const', value: 'x' },
      op: 'between',
      right: { kind: 'const', value: '100' },
      right2: { kind: 'const', value: '200' }
    };
    const next = applyPredicateOp(p, 'not_between');
    expect(next.right2).toEqual({ kind: 'const', value: '200' });
  });

  it('②切离 between（→eq）：删除 right2', () => {
    const p: Predicate = {
      left: { kind: 'const', value: 'x' },
      op: 'between',
      right: { kind: 'const', value: '100' },
      right2: { kind: 'const', value: '200' }
    };
    const next = applyPredicateOp(p, 'eq');
    expect(next).not.toHaveProperty('right2');
    expect('right2' in next).toBe(false);
  });

  it('③切到 like：right 是常量文本时预填前后通配 %text% 并写 like_mode=pattern', () => {
    const p: Predicate = { left: { kind: 'const', value: 'x' }, op: 'eq', right: { kind: 'const', value: 'abc' } };
    const next = applyPredicateOp(p, 'like');
    expect(next.right).toEqual({ kind: 'const', value: '%abc%' });
    expect(next.like_mode).toBe('pattern');
  });

  it('③b 已含通配的不重复包（用户已手动删一侧 % 时，切走再切回不会被二次包裹）', () => {
    // 用户在 like 编辑器里手动把 %abc% 删成前缀匹配 abc%。
    const trimmed: Predicate = { left: { kind: 'const', value: 'x' }, op: 'like', right: { kind: 'const', value: 'abc%' }, like_mode: 'pattern' };
    // 切到别的算子再切回 like（模拟用户误触算子下拉又切回）。
    const away = applyPredicateOp(trimmed, 'eq');
    const back = applyPredicateOp(away, 'like');
    expect(back.right).toEqual({ kind: 'const', value: 'abc%' }); // 未被二次包成 %abc%%
    expect(back.like_mode).toBe('pattern');
  });

  it('③c 右值非常量文本（字段引用）时不猜测包裹，like_mode 保持缺省（=contains，交给运行期动态包 %…%）', () => {
    const p: Predicate = { left: { kind: 'const', value: 'x' }, op: 'eq', right: { kind: 'source_field', alias: 't1', field_id: 'f1' } };
    const next = applyPredicateOp(p, 'like');
    expect(next.right).toEqual({ kind: 'source_field', alias: 't1', field_id: 'f1' }); // 原样保留，未被强行改写
    expect(next).not.toHaveProperty('like_mode');
  });

  it('③d 已含通配符的常量文本（如用户直接填 %abc）不重复包，仍写 like_mode=pattern', () => {
    const p: Predicate = { left: { kind: 'const', value: 'x' }, op: 'eq', right: { kind: 'const', value: '%abc' } };
    const next = applyPredicateOp(p, 'like');
    expect(next.right).toEqual({ kind: 'const', value: '%abc' });
    expect(next.like_mode).toBe('pattern');
  });

  it('④切离 like（→eq）：删除 like_mode', () => {
    const p: Predicate = { left: { kind: 'const', value: 'x' }, op: 'like', right: { kind: 'const', value: '%abc%' }, like_mode: 'pattern' };
    const next = applyPredicateOp(p, 'eq');
    expect(next).not.toHaveProperty('like_mode');
    expect('like_mode' in next).toBe(false);
  });

  it('序列化不带多余字段：非 between/like 算子的 JSON 输出不含 right2/like_mode 键', () => {
    const p: Predicate = {
      left: { kind: 'const', value: 'x' },
      op: 'between',
      right: { kind: 'const', value: '100' },
      right2: { kind: 'const', value: '200' }
    };
    const next = applyPredicateOp(p, 'eq');
    const json = JSON.parse(JSON.stringify(next));
    expect(json).not.toHaveProperty('right2');
    expect(json).not.toHaveProperty('like_mode');
    expect(json).toEqual({ left: { kind: 'const', value: 'x' }, op: 'eq', right: { kind: 'const', value: '100' } });
  });

  it('isBetweenOp：仅 between/not_between 为真', () => {
    expect(isBetweenOp('between')).toBe(true);
    expect(isBetweenOp('not_between')).toBe(true);
    expect(isBetweenOp('eq')).toBe(false);
    expect(isBetweenOp('like')).toBe(false);
    expect(isBetweenOp('is_null')).toBe(false);
  });

  it('判空算子(is_null)优先级最高：即便原本是 between/like，切到判空也会清掉 right/right2/like_mode', () => {
    const p: Predicate = {
      left: { kind: 'const', value: 'x' },
      op: 'between',
      right: { kind: 'const', value: '100' },
      right2: { kind: 'const', value: '200' }
    };
    const next = applyPredicateOp(p, 'is_null');
    expect(next).not.toHaveProperty('right');
    expect(next).not.toHaveProperty('right2');
    expect(next).not.toHaveProperty('like_mode');
  });
});
