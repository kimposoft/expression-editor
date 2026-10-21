/**
 *
 * 相比原来的 5 条 DOM 用例，这里多覆盖了 brackets（V4 `[表].[字段]`）——原实现只处理 braces，
 * V4 侧一直在一个字一个字啃长字段名。
 */
import { describe, expect, it } from 'vitest';
import { tokenBoundaryAfter, tokenBoundaryBefore } from './tokenDelete';

describe('Backspace：光标之前是完整标记才整段删', () => {
  it('braces：紧邻 {表.字段} 之后 → 返回标记起点', () => {
    const t = '前置文字{客户表.姓名}';
    expect(tokenBoundaryBefore(t, t.length)).toBe('前置文字'.length);
  });

  it('brackets：紧邻 [表].[字段] 之后 → 整个引用一起删（V4 新增覆盖）', () => {
    const t = '前置[客户表].[姓名]';
    expect(tokenBoundaryBefore(t, t.length)).toBe('前置'.length);
  });

  it('brackets 单段 [标签] 同样整段删', () => {
    const t = 'A + [当前时间]';
    expect(tokenBoundaryBefore(t, t.length)).toBe('A + '.length);
  });

  it('【反向】光标在普通文本之后 → null（交回默认单字符删除）', () => {
    const t = '前置文字{客户表.姓名}后缀ABC';
    expect(tokenBoundaryBefore(t, t.length)).toBeNull();
  });

  it('【反向】光标在标记内部 → null', () => {
    const t = '前置{客户表.姓名}';
    expect(tokenBoundaryBefore(t, t.length - 1)).toBeNull();
  });

  it('【反向】空标记 {} 也按普通处理（无内容可整段删）', () => {
    const t = '前置{}后缀';
    // 光标紧邻 '}' 时仍能识别出 '{' 起点——空标记也是完整标记，整段删掉是合理行为。
    expect(tokenBoundaryBefore(t, '前置{}'.length)).toBe('前置'.length);
  });

  it('文首、不闭合的标记 → null', () => {
    expect(tokenBoundaryBefore('', 0)).toBeNull();
    expect(tokenBoundaryBefore('客户表.姓名}', '客户表.姓名}'.length)).toBeNull();
  });
});

describe('Delete：光标之后是完整标记才整段删', () => {
  it('braces：紧邻 { 之前 → 返回标记终点', () => {
    const t = '{客户表.姓名}后缀';
    expect(tokenBoundaryAfter(t, 0)).toBe('{客户表.姓名}'.length);
  });

  it('brackets：紧邻 [ 之前 → 整个引用一起删', () => {
    const t = '[客户表].[姓名] + 1';
    expect(tokenBoundaryAfter(t, 0)).toBe('[客户表].[姓名]'.length);
  });

  it('【反向】光标之后是普通文本 → null', () => {
    expect(tokenBoundaryAfter('后缀{客户表.姓名}', 0)).toBeNull();
  });

  it('【反向】不闭合的标记 → null', () => {
    expect(tokenBoundaryAfter('{客户表.姓名', 0)).toBeNull();
  });
});
