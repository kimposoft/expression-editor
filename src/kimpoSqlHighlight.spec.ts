import { describe, expect, it } from 'vitest';
import { buildRefKindMap, scanKimpoSql } from './kimpoSqlHighlight';

describe('scanKimpoSql：方括号引用切段', () => {
  it('`[表].[字段]` → ref-table（带表名）+ 字段段；refKinds 按整段/末段细分字段段', () => {
    const text = '[入库流水].[数量] > 0';
    const kinds = buildRefKindMap([{ kind: 'source_field', last_label: '[入库流水].[数量]' }]);
    expect(scanKimpoSql(text, kinds)).toEqual([
      { from: 0, to: 6, kind: 'ref-table', table: '入库流水', report: false },
      { from: 7, to: 11, kind: 'ref-source' },
      { from: 14, to: 15, kind: 'number' }
    ]);
    expect(text.slice(0, 6)).toBe('[入库流水]');
    expect(text.slice(7, 11)).toBe('[数量]');
  });

  it('`本报表.[表].[字段]`：前缀并入表段（report=true），字段段 ref-report', () => {
    const text = 'SUM(本报表.[采购明细].[金额])';
    const toks = scanKimpoSql(text);
    expect(toks).toEqual([
      { from: 0, to: 3, kind: 'func' },
      { from: 4, to: 14, kind: 'ref-table', table: '采购明细', report: true },
      { from: 15, to: 19, kind: 'ref-report' }
    ]);
    expect(text.slice(4, 14)).toBe('本报表.[采购明细]');
  });

  it('`暂存表.[列]`：前缀并入 token（staging=true）——暂存表是虚拟单表，没有独立 [表] 分段，整条一枚 ref-table', () => {
    const text = '暂存表.[物料名称] > 0';
    const toks = scanKimpoSql(text);
    expect(toks).toEqual([
      { from: 0, to: 10, kind: 'ref-table', table: '物料名称', staging: true },
      { from: 13, to: 14, kind: 'number' }
    ]);
    expect(text.slice(0, 10)).toBe('暂存表.[物料名称]');
  });

  it('单段 `[x]` 仍是一枚通用/变量引用；字符串字面量里的方括号不切', () => {
    expect(scanKimpoSql('[当前用户] = 1', buildRefKindMap([{ kind: 'system_var', last_label: '[当前用户]' }]))).toEqual([
      { from: 0, to: 6, kind: 'ref-var' },
      { from: 9, to: 10, kind: 'number' }
    ]);
    expect(scanKimpoSql("'[a].[b]'")).toEqual([{ from: 0, to: 9, kind: 'string' }]);
  });
});

describe('scanKimpoSql：模糊匹配三分关键字（英文包）按关键字着色', () => {
  it('CONTAINS / STARTS_WITH / ENDS_WITH 是 keyword token；中文关键字不进英文关键字表（按标识符不着色）', () => {
    expect(scanKimpoSql("[a].[b] CONTAINS 'x'")).toEqual([
      { from: 0, to: 3, kind: 'ref-table', table: 'a', report: false },
      { from: 4, to: 7, kind: 'ref' },
      { from: 8, to: 16, kind: 'keyword' },
      { from: 17, to: 20, kind: 'string' }
    ]);
    expect(scanKimpoSql('x STARTS_WITH y').some(t => t.kind === 'keyword' && t.from === 2 && t.to === 13)).toBe(true);
    expect(scanKimpoSql('x ENDS_WITH y').some(t => t.kind === 'keyword')).toBe(true);
  });
});
