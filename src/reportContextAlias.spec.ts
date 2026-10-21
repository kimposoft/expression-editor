import { describe, expect, it } from 'vitest';
import { valueRefToBracketText } from './bracketText';
import { buildReferenceCandidates } from './kimpoSqlRefCompletion';
import { instanceSuffix, isReportContextAlias, labelOfRef } from './rawSerialize';

const fields = [{ field_id: 'fld_price', field_name: '单价' }] as any;
/** 目录来源 t1 与往返回来的本报表上下文表 rpt-* 指向同一张表 tbl_ext（用户场景：本模板历史数据作来源）。 */
const sources = [
  { alias: 't1', dataTableId: 'tbl_ext', name: '采购入库的扩展表', fields },
  { alias: 'rpt-tbl_ext-1a2b3c', dataTableId: 'tbl_ext', name: '采购入库的扩展表', fields }
] as any;
const forms = [] as any;
const systemVars = [] as any;

describe('isReportContextAlias', () => {
  it('bt* 与 rpt-* 都是本报表上下文表；显式来源 t1 不是', () => {
    expect(isReportContextAlias('bt0')).toBe(true);
    expect(isReportContextAlias('rpt-tbl_ext-1a2b3c')).toBe(true);
    expect(isReportContextAlias('t1')).toBe(false);
    expect(isReportContextAlias(undefined)).toBe(false);
  });
});

describe('instanceSuffix（同表多实例序号）', () => {
  it('往返回来的 rpt-* 上下文表不参与同表计数：唯一的目录来源不带 (1)', () => {
    expect(instanceSuffix('t1', 'tbl_ext', sources)).toBe('');
  });
  it('bt* 上下文表同样不参与计数（既有口径不变）', () => {
    const withBt = [sources[0], { alias: 'bt1', dataTableId: 'tbl_ext', name: '采购入库的扩展表', fields }] as any;
    expect(instanceSuffix('t1', 'tbl_ext', withBt)).toBe('');
  });
  it('两个显式来源指向同一张表时仍按加入顺序编号 (1)(2)', () => {
    const twoExplicit = [sources[0], { alias: 't2', dataTableId: 'tbl_ext', name: '采购入库的扩展表', fields }, sources[1]] as any;
    expect(instanceSuffix('t1', 'tbl_ext', twoExplicit)).toBe('(1)');
    expect(instanceSuffix('t2', 'tbl_ext', twoExplicit)).toBe('(2)');
  });
});

describe('valueRefToBracketText（V4 括号语法插入文本）', () => {
  it('目录来源插入 `[表].[字段]`，别名与 catalogSourceAlias 同源、不带 (1)', () => {
    expect(valueRefToBracketText({ kind: 'source_field', alias: 't1', field_id: 'fld_price' }, sources, forms, systemVars)).toBe(
      '[采购入库的扩展表].[单价]'
    );
  });
  it('rpt-* 上下文表插入 3 段保留形态 `本报表.[表].[字段]`，不能当显式来源写', () => {
    expect(
      valueRefToBracketText({ kind: 'source_field', alias: 'rpt-tbl_ext-1a2b3c', field_id: 'fld_price' }, sources, forms, systemVars)
    ).toBe('本报表.[采购入库的扩展表].[单价]');
  });
});

describe('labelOfRef（3.4 可读标签）', () => {
  it('rpt-* 上下文表按本报表标签规则显示，不追加同表序号', () => {
    const label = labelOfRef({ kind: 'source_field', alias: 'rpt-tbl_ext-1a2b3c', field_id: 'fld_price' }, sources, forms);
    expect(label).not.toContain('(1)');
    expect(label).not.toContain('(2)');
  });
});

describe('buildReferenceCandidates（引用补全）', () => {
  it('混在 sources 里的 rpt-* 上下文表不产出显式来源候选', () => {
    const labels = { source: '来源', report: '本报表', variable: '变量' } as any;
    const out = buildReferenceCandidates('brackets', sources, forms, systemVars, labels);
    const sourceSnips = out.filter(c => c.kind === 'source').map(c => c.snip);
    expect(sourceSnips).toEqual(['[采购入库的扩展表].[单价]']);
  });
});
