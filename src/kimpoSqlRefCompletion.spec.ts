/**
 * 引用补全纯逻辑判据：候选片段与 ⊞/ƒ 拾取同一份口径、四种触发形态、子串匹配与表内筛选。
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceCandidates, matchReferenceCandidates, referenceCompletionContext } from './kimpoSqlRefCompletion';

const sources = [
  { alias: 't1', dataTableId: 'tbl_src', name: '入库流水', fields: [{ field_id: 'f_code', field_name: '物料编码' }, { field_id: 'f_qty', field_name: '数量' }] }
] as any;
const forms = [
  { alias: 'bt0', table: { data_table_id: 'tbl_main', table_name: '采购订单的主表', table_role: 'main' }, fields: [{ field_id: 'f_no', field_name: '单号' }] },
  { alias: 'bt1', table: { data_table_id: 'tbl_detail', table_name: '采购明细', table_role: 'detail' }, fields: [{ field_id: 'f_dqty', field_name: '数量' }] }
] as any;
const systemVars = [{ var_id: 'now', label: '当前时间', type: 'datetime' }] as any;
const labels = { source: '来源', report: '本报表', variable: '系统变量' };
const brackets = () =>
  buildReferenceCandidates('brackets', sources, forms, systemVars, labels, {
    systemVariableToken: id => (id === 'now' ? '系统变量.当前时间' : undefined)
  });

const stagingSources = [
  ...sources,
  { alias: 't2', dataTableId: '__staging__', name: '上一步暂存区（提取数据）', fields: [{ field_id: 'col_qty', field_name: '数量合计' }] }
] as any;
const stagingBrackets = () =>
  buildReferenceCandidates('brackets', stagingSources, forms, systemVars, labels, {
    systemVariableToken: id => (id === 'now' ? '系统变量.当前时间' : undefined)
  });

describe('buildReferenceCandidates（候选片段与拾取同一口径）', () => {
  it('brackets：显式来源 [来源].[字段]、本报表 本报表.[表].[字段]、系统变量走解析口', () => {
    const snips = brackets().map(c => c.snip);
    expect(snips).toEqual([
      '[入库流水].[物料编码]',
      '[入库流水].[数量]',
      '本报表.[采购订单的主表].[单号]',
      '本报表.[采购明细].[数量]',
      '系统变量.当前时间'
    ]);
    expect(brackets().map(c => c.detail)).toEqual(['来源 · 入库流水', '来源 · 入库流水', '本报表 · 采购订单的主表', '本报表 · 采购明细', '系统变量']);
  });

  it('braces（3.4）：候选是 {可读标签}', () => {
    const snips = buildReferenceCandidates('braces', sources, forms, systemVars, labels).map(c => c.snip);
    expect(snips[0]).toBe('{入库流水.物料编码}');
    expect(snips[2]).toBe('{单号}'); // 本报表主表裸字段名
    expect(snips[4]).toBe('{当前时间}');
  });

  it('brackets：暂存来源候选 kind=staging，snip 是保留前缀写法 暂存表.[列]——不落成 [产出名].[列]', () => {
    const stagingCands = stagingBrackets().filter(c => c.kind === 'staging');
    expect(stagingCands.map(c => c.snip)).toEqual(['暂存表.[数量合计]']);
    // detail 沿用「来源」分组文案展示（最小改动，不新增分组 i18n key）。
    expect(stagingCands[0].detail).toBe('来源 · 上一步暂存区（提取数据）');
  });
});

describe('referenceCompletionContext（触发形态）', () => {
  it('`[xx` ⇒ token 模式，替换起点在 `[`', () => {
    expect(referenceCompletionContext('1 + [数')).toEqual({ mode: 'token', from: 4, typed: '数', reportOnly: false });
    expect(referenceCompletionContext('[')).toEqual({ mode: 'token', from: 0, typed: '', reportOnly: false });
  });

  it('标识符前缀（含 CJK）⇒ token 模式；空前缀只在显式唤起时开', () => {
    expect(referenceCompletionContext('合计(数量')).toEqual({ mode: 'token', from: 3, typed: '数量', reportOnly: false });
    expect(referenceCompletionContext('1 + ')).toBeNull();
    expect(referenceCompletionContext('1 + ', true)).toEqual({ mode: 'token', from: 4, typed: '', reportOnly: false });
  });

  it('`本报表.[xx` / `本报表.xx` ⇒ 只列本报表，且替换从 本报表 起（不落成 本报表.本报表.[…]）', () => {
    expect(referenceCompletionContext('1 + 本报表.[采')).toEqual({ mode: 'token', from: 4, typed: '采', reportOnly: true });
    expect(referenceCompletionContext('本报表.采')).toEqual({ mode: 'token', from: 0, typed: '采', reportOnly: true });
  });

  it('`暂存表.[xx` / `暂存表.xx` ⇒ 只列暂存列，且替换从 暂存表 起（同款 本报表 前缀判据）', () => {
    expect(referenceCompletionContext('1 + 暂存表.[数')).toEqual({ mode: 'token', from: 4, typed: '数', reportOnly: false, stagingOnly: true });
    expect(referenceCompletionContext('暂存表.数')).toEqual({ mode: 'token', from: 0, typed: '数', reportOnly: false, stagingOnly: true });
  });

  it('`[表].[xx` / `本报表.[表].[xx` ⇒ field 模式，只补该表字段', () => {
    expect(referenceCompletionContext('[入库流水].[数')).toEqual({ mode: 'field', from: 7, typed: '数', table: '入库流水', report: false });
    expect(referenceCompletionContext('本报表.[采购明细].[')).toEqual({ mode: 'field', from: 11, typed: '', table: '采购明细', report: true });
  });

  it('引号铁律：字符串字面量内不弹', () => {
    expect(referenceCompletionContext("'[数")).toBeNull();
    expect(referenceCompletionContext("'a' + [数")).not.toBeNull();
  });
});

describe('matchReferenceCandidates（筛选）', () => {
  const cands = brackets();

  it('token：子串命中字段名 / 表名 / 片段，大小写不敏感；空前缀列全量', () => {
    const byQty = matchReferenceCandidates({ mode: 'token', from: 0, typed: '数量', reportOnly: false }, cands);
    expect(byQty.map(o => o.insert)).toEqual(['[入库流水].[数量]', '本报表.[采购明细].[数量]']);
    const byTable = matchReferenceCandidates({ mode: 'token', from: 0, typed: '入库', reportOnly: false }, cands);
    expect(byTable).toHaveLength(2);
    const byPrefix = matchReferenceCandidates({ mode: 'token', from: 0, typed: '本报', reportOnly: false }, cands);
    expect(byPrefix.map(o => o.candidate.kind)).toEqual(['report', 'report']);
    expect(matchReferenceCandidates({ mode: 'token', from: 0, typed: '', reportOnly: false }, cands)).toHaveLength(5);
  });

  it('token + reportOnly：只剩本报表候选', () => {
    const only = matchReferenceCandidates({ mode: 'token', from: 0, typed: '', reportOnly: true }, cands);
    expect(only.map(o => o.candidate.kind)).toEqual(['report', 'report']);
  });

  it('token + stagingOnly：只剩暂存列候选，插入片段保留前缀写法', () => {
    const stagingCands = stagingBrackets();
    const only = matchReferenceCandidates({ mode: 'token', from: 0, typed: '', reportOnly: false, stagingOnly: true }, stagingCands);
    expect(only.map(o => o.candidate.kind)).toEqual(['staging']);
    expect(only[0].insert).toBe('暂存表.[数量合计]');
  });

  it('field：只补该表字段、种类对得上，插入 `[字段]`', () => {
    const src = matchReferenceCandidates({ mode: 'field', from: 7, typed: '', table: '入库流水', report: false }, cands);
    expect(src.map(o => o.insert)).toEqual(['[物料编码]', '[数量]']);
    expect(src[0].from).toBe(7);
    const rpt = matchReferenceCandidates({ mode: 'field', from: 10, typed: '数', table: '采购明细', report: true }, cands);
    expect(rpt.map(o => o.insert)).toEqual(['[数量]']);
    // 没带 本报表 前缀却写了本报表表名 ⇒ 不补（服务端也不会认 `[采购明细].[数量]`）
    expect(matchReferenceCandidates({ mode: 'field', from: 0, typed: '', table: '采购明细', report: false }, cands)).toEqual([]);
  });
});
