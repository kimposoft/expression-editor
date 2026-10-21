import { describe, expect, it } from 'vitest';
import { checkExpressionSyntax } from './syntaxCheck';

// 测试用「已知字段目录」：与真实 isKnownLabel（由 sources/forms 反解出的可读标签）解耦，
// 用固定集合模拟——调用方真实实现见 rawSerialize.ts 的 resolveLabel。
const knownLabels = new Set(['数量', '单价', 'a', 'b', 'c', '本表 · 字段']);
const isKnownLabel = (label: string) => knownLabels.has(label);
const opts = { isKnownLabel };

describe('checkExpressionSyntax / 空文本', () => {
  it('空字符串放行（不能把"还没输入"当错误，否则会锁死确定按钮）', () => {
    expect(checkExpressionSyntax('', opts)).toEqual({ ok: true });
  });

  it('纯空白也放行（用户还没开始真正输入）', () => {
    expect(checkExpressionSyntax('   \n\t  ', opts)).toEqual({ ok: true });
  });
});

describe('checkExpressionSyntax / 括号配对', () => {
  it('配对正例：算术分组', () => {
    expect(checkExpressionSyntax('({a} + {b}) * {c}', opts)).toEqual({ ok: true });
  });

  it('配对正例：嵌套多层', () => {
    expect(checkExpressionSyntax('(({a} + {b}) * ({c} - {a}))', opts)).toEqual({ ok: true });
  });

  it('反例：有 ( 未闭合，报 unclosedParen 定位到最早那个未闭合的左括号', () => {
    const r = checkExpressionSyntax('({a} + {b}', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'unclosedParen', index: 0 });
  });

  it('反例：嵌套未闭合时定位到外层（最早出现、仍未被消掉的那个）', () => {
    // "((a)" —— 内层 ( 被随后的 ) 配掉，外层 ( 才是真正悬空的那个
    const r = checkExpressionSyntax('(({a})', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'unclosedParen', index: 0 });
  });

  it('反例：多余的右括号，报 unexpectedParen 定位到该括号本身', () => {
    const r = checkExpressionSyntax('{a} + {b})', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'unexpectedParen', index: 9 });
  });

  it('字符串字面量内的括号不计入配对（单引号，SQL 风格 \'\' 转义）', () => {
    // 字符串 "it's (a)" 里的 ( 若被误计入，会导致外层括号"多出一个左括号"从而误判 unclosedParen
    expect(checkExpressionSyntax("({a} + 'it''s (a)')", opts)).toEqual({ ok: true });
  });
});

describe('checkExpressionSyntax / [] 与注释不再是本地黑盒', () => {
  it('[] 内的括号照常参与配对：表达式引擎把 [label] 当标识符引用语法，不是正则黑盒', () => {
    // 旧检查器把 "[)]" 整段跳过；现在 ) 多出一个 → unexpectedParen（服务端同样会报语法错）
    const r = checkExpressionSyntax('{a}[)]{b}', opts);
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('unexpectedParen');
  });

  it('[] 内的 {…} 照常按字段标记解析（不再被黑盒吞掉）', () => {
    const r = checkExpressionSyntax('[{fake}]{a}', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'unknownField', index: 1, detail: 'fake' });
  });

  it('-- 行注释不再跳过：注释里的未闭合括号照报（服务端 COMMENT_FORBIDDEN 本就拒绝注释）', () => {
    const r = checkExpressionSyntax('{a} -- (', opts);
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('unclosedParen');
  });
});

describe('checkExpressionSyntax / 字段标记', () => {
  it('空标记 {} 报 emptyToken，定位到左花括号', () => {
    const r = checkExpressionSyntax('{a} + {}', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'emptyToken', index: 6 });
  });

  it('只含空白的标记同样判空（{ }），与 {} 同一判据', () => {
    const r = checkExpressionSyntax('{   }', opts);
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('emptyToken');
  });

  it('未知字段报 unknownField，detail 携带标记文本，index 定位到左花括号', () => {
    const r = checkExpressionSyntax('{a} + {不存在的字段}', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'unknownField', index: 6, detail: '不存在的字段' });
  });

  it('标记内容两侧多余空白会先 trim 再查目录（与 rawSerialize.resolveLabel 的 trim 口径一致）', () => {
    const seen: string[] = [];
    const r = checkExpressionSyntax('{ a }', { isKnownLabel: l => (seen.push(l), knownLabels.has(l)) });
    expect(r).toEqual({ ok: true });
    expect(seen).toEqual(['a']);
  });

  it('未闭合的 { 报 unclosedToken', () => {
    const r = checkExpressionSyntax('{a', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'unclosedToken', index: 0 });
  });

  it('连续两个 { 时外层视为未闭合，只有内层可能配出合法标记（与 FIELD_TOKEN 正则同一语义）', () => {
    const r = checkExpressionSyntax('{{a}', opts);
    expect(r.ok).toBe(false);
    expect(r.issue).toEqual({ code: 'unclosedToken', index: 0 });
  });
});

describe('checkExpressionSyntax / 运算符与关键字一律不判（交给服务端 lower-text）', () => {
  it('中英文关键字形态都放行（并且/或者/不/为 空值 与 AND/OR/NOT 本地一视同仁）', () => {
    expect(checkExpressionSyntax("{a} > 1 并且 {b} 为 空值 或者 不 ({c} = 'x')", opts)).toEqual({ ok: true });
    expect(checkExpressionSyntax("CASE WHEN {a} > 1 THEN '高' ELSE '低' END", opts)).toEqual({ ok: true });
  });

  it('一元负号 / 函数名后的 ( / 中文函数别名 不误报', () => {
    expect(checkExpressionSyntax('-{a} + -{b}', opts)).toEqual({ ok: true });
    expect(checkExpressionSyntax('合计({a}) + 年份({b})', opts)).toEqual({ ok: true });
  });

  it('运算符缺操作数**不再**由本地判定（trailing/leading/连续运算符全部放行，服务端 ALICE_SYNTAX_* 负责）', () => {
    expect(checkExpressionSyntax('{a} +', opts)).toEqual({ ok: true });
    expect(checkExpressionSyntax('* {a}', opts)).toEqual({ ok: true });
    expect(checkExpressionSyntax('{a} + * {b}', opts)).toEqual({ ok: true });
  });
});

describe('checkExpressionSyntax / 只报第一个错误', () => {
  it('同时存在多种问题时，按字符下标取最靠前的一个', () => {
    // index 0 是 unknownField（{不存在}），index 靠后的是 unexpectedParen —— 应报前者
    const r = checkExpressionSyntax('{不存在} )', opts);
    expect(r.ok).toBe(false);
    expect(r.issue?.code).toBe('unknownField');
    expect(r.issue?.index).toBe(0);
  });
});
