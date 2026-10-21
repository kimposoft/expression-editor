import { describe, expect, it } from 'vitest';
import { serializeToText } from './rawSerialize';

describe('serializeToText 对 const 四态的反渲染', () => {
  it('不填充（value 缺省）→ 空文本，不是带引号的空串', () => {
    expect(serializeToText({ kind: 'const' }, [], [])).toBe('');
  });
  it("主动填空串 → ''（两个引号）", () => {
    expect(serializeToText({ kind: 'const', value: '' }, [], [])).toBe("''");
  });
  it('空值 → NULL 关键字', () => {
    expect(serializeToText({ kind: 'const', value: null }, [], [])).toBe('NULL');
  });
  it('数字 0 → 0（不加引号）', () => {
    expect(serializeToText({ kind: 'const', value: 0 }, [], [])).toBe('0');
  });
});
