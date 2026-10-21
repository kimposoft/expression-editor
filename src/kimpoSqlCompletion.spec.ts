/**
 * 函数补全判定判据。
 *   ① 取词正则 ASCII-only ⇒ 中文函数别名（`合计`）永远匹配不到「正在打标识符」；
 *   ② 只按业务展示名（`求和`）过滤 ⇒ 用户照着表达式里看到的别名（`合计`）打字一条也匹配不到。
 */

import { describe, expect, it } from 'vitest';
import {
  COMPLETION_IDENT,
  aliasOf,
  insideStringLiteral,
  matchFunctionCandidates,
  type CompletionFunctionItem
} from './kimpoSqlCompletion';

const CATALOG: CompletionFunctionItem[] = [
  { snip: '合计()', label: '求和', detail: '对所选字段求和，忽略空值。' },
  { snip: '计数()', label: '计数', detail: '统计行数。' },
  { snip: '连接文本()', label: '字符串拼接', detail: '把多个值按顺序拼成一个字符串。' },
  { snip: '分支 当  则  否则  结束', label: '条件分支', detail: 'CASE WHEN 结构。' },
  { snip: 'SUM(', label: 'Sum', detail: '英文包形态：片段以单括号结尾。' }
];

describe('COMPLETION_IDENT 取词字符集', () => {
  it('🔴 必须能取到中文标识符——否则中文界面下补全永不触发（首版即此错）', () => {
    expect('合计'.match(new RegExp('^' + COMPLETION_IDENT.source))?.[0]).toBe('合计');
    expect('连接文本'.match(new RegExp('^' + COMPLETION_IDENT.source))?.[0]).toBe('连接文本');
  });

  it('ASCII 标识符照旧', () => {
    expect('SUM'.match(new RegExp('^' + COMPLETION_IDENT.source))?.[0]).toBe('SUM');
    expect('a1_b'.match(new RegExp('^' + COMPLETION_IDENT.source))?.[0]).toBe('a1_b');
  });

  it('不以标识符开头的文本取不到词', () => {
    expect(new RegExp('^' + COMPLETION_IDENT.source).test('1abc')).toBe(false);
    expect(new RegExp('^' + COMPLETION_IDENT.source).test('[表]')).toBe(false);
  });
});

describe('aliasOf', () => {
  it('双括号片段去掉括号', () => expect(aliasOf('合计()')).toBe('合计'));
  it('单括号片段（英文包）同样去掉', () => expect(aliasOf('SUM(')).toBe('SUM'));
  it('关键字构造取开头一串——多词片段也要有个短别名可匹配', () => {
    expect(aliasOf('分支 当  则  否则  结束')).toBe('分支');
  });
});

describe('insideStringLiteral', () => {
  it('奇数个单引号 ⇒ 在字符串内，不该弹补全', () => {
    expect(insideStringLiteral("合计([a].[b]) + '")).toBe(true);
  });
  it('偶数个单引号 ⇒ 在字符串外', () => {
    expect(insideStringLiteral("'x' + ")).toBe(false);
  });
  it("'' 是转义的单引号，成对抵消不改变内外判定", () => {
    expect(insideStringLiteral("'it''s' + ")).toBe(false);
    expect(insideStringLiteral("'it''s")).toBe(true);
  });
});

describe('matchFunctionCandidates 双向匹配', () => {
  it('🔴 按插入别名前缀命中（用户照着表达式里看到的字打）', () => {
    expect(matchFunctionCandidates('合', CATALOG).map(c => c.label)).toEqual(['合计']);
    expect(matchFunctionCandidates('连接', CATALOG).map(c => c.label)).toEqual(['连接文本']);
  });

  it('🔴 按业务展示名前缀同样命中（用户照着函数条上看到的字打）', () => {
    expect(matchFunctionCandidates('求和', CATALOG).map(c => c.label)).toEqual(['合计']);
    expect(matchFunctionCandidates('字符串', CATALOG).map(c => c.label)).toEqual(['连接文本']);
    expect(matchFunctionCandidates('条件', CATALOG).map(c => c.label)).toEqual(['分支']);
  });

  it('英文匹配大小写不敏感', () => {
    expect(matchFunctionCandidates('su', CATALOG).map(c => c.label)).toEqual(['SUM']);
  });

  it('空前缀（显式唤起）列全量目录', () => {
    expect(matchFunctionCandidates('', CATALOG)).toHaveLength(CATALOG.length);
  });

  it('无命中返回空数组——调用方据此不弹面板', () => {
    expect(matchFunctionCandidates('zzz', CATALOG)).toEqual([]);
  });

  it('候选带齐展示三段与光标回退量：别名/展示名/说明 + back', () => {
    const [sum] = matchFunctionCandidates('合', CATALOG);
    expect(sum).toEqual({
      label: '合计',
      detail: '求和',
      info: '对所选字段求和，忽略空值。',
      snip: '合计()',
      back: 1
    });
  });

  it('🔴 不以 "()" 结尾的片段 back=0——光标停在片段末尾，与既有 insertAtCursor 口径一致', () => {
    expect(matchFunctionCandidates('分支', CATALOG)[0].back).toBe(0);
    expect(matchFunctionCandidates('SUM', CATALOG)[0].back).toBe(0);
  });
});

describe('常驻英文匹配键', () => {
  const ZH_WITH_EN: CompletionFunctionItem[] = [
    { snip: '合计()', label: '求和', detail: '对所选字段求和。', aliases: ['SUM'] },
    { snip: '连接文本()', label: '字符串拼接', detail: '拼接。', aliases: ['CONCAT'] },
    { snip: '行数()', label: '行数', detail: '统计行数。', aliases: ['ROW_COUNT'] }
  ];

  it('中文界面下打英文前缀也能命中：插入仍是中文别名，右侧并列英文名', () => {
    const hits = matchFunctionCandidates('su', ZH_WITH_EN);
    expect(hits.map(h => h.label)).toEqual(['合计']);
    expect(hits[0].snip).toBe('合计()');
    expect(hits[0].detail).toBe('求和 · SUM');
    expect(matchFunctionCandidates('row_', ZH_WITH_EN).map(h => h.snip)).toEqual(['行数()']);
  });

  it('中文前缀照旧命中，且 detail 同样并列英文名', () => {
    const hits = matchFunctionCandidates('合', ZH_WITH_EN);
    expect(hits.map(h => h.label)).toEqual(['合计']);
    expect(hits[0].detail).toBe('求和 · SUM');
  });

  it('英文界面下英文名本身就是别名：不重复并列', () => {
    const en: CompletionFunctionItem[] = [{ snip: 'SUM()', label: 'Sum', detail: 'Sum values.', aliases: ['SUM'] }];
    const hits = matchFunctionCandidates('su', en);
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toBe('Sum');
  });
});
