import { describe, expect, it } from 'vitest';
import { buildLowerTextRefs, derivedStableId, refOfStableId, restoreTextFromSource, runeToUtf16Index } from './textSource';
import type { FormTableLite, SourceTableLite } from './rawSerialize';
import type { SystemVariableDef } from './useExpressionContext';
import type { TextSource } from './types';

const SOURCES: SourceTableLite[] = [
  {
    alias: 't1',
    dataTableId: 'dt-order',
    name: '订单',
    fields: [
      { field_id: 'f-amount', field_name: '金额' },
      { field_id: 'f-status', field_name: '状态' }
    ] as SourceTableLite['fields']
  }
];
const FORMS: FormTableLite[] = [
  {
    alias: 'bt0',
    table: { data_table_id: 'dt-main', table_name: '主表', table_role: 'main', sort_no: 0 },
    fields: [{ field_id: 'f-qty', field_name: '数量' }]
  } as unknown as FormTableLite
];
const VARS: SystemVariableDef[] = [{ var_id: 'today', label: '今天', type: 'datetime' }];

describe('derivedStableId（与后端 textmodel.derivedStableID 逐字一致）', () => {
  it('四种可绑定目标的派生格式', () => {
    expect(derivedStableId({ kind: 'source_field', alias: 't1', field_id: 'f-amount' })).toBe('source_field:t1:f-amount');
    expect(derivedStableId({ kind: 'form_field', table_id: 'dt-main', field_id: 'f-qty' })).toBe('form_field:dt-main:f-qty');
    expect(derivedStableId({ kind: 'system_var', var_id: 'today' })).toBe('system_var:today');
    // const 的 Go 实现是 string(RawMessage)——紧凑 JSON 字面量：字符串带引号、数字裸写。
    expect(derivedStableId({ kind: 'const', value: 'abc' })).toBe('const:"abc"');
    expect(derivedStableId({ kind: 'const', value: 5 })).toBe('const:5');
  });

  it('refOfStableId 是 derivedStableId 的反函数（三种引用），const/未知返回 null', () => {
    expect(refOfStableId('source_field:t1:f-amount')).toEqual({ kind: 'source_field', alias: 't1', field_id: 'f-amount' });
    expect(refOfStableId('form_field:dt-main:f-qty')).toEqual({ kind: 'form_field', table_id: 'dt-main', field_id: 'f-qty' });
    expect(refOfStableId('system_var:today')).toEqual({ kind: 'system_var', var_id: 'today' });
    expect(refOfStableId('const:"abc"')).toBeNull();
    expect(refOfStableId('garbage')).toBeNull();
  });
});

describe('buildLowerTextRefs（{…} 按出现顺序绑定 refs[]）', () => {
  it('按出现顺序产出 label + stable_id + target；同一字段出现两次产出两条（服务端按稳定 ID 去重）', () => {
    const { refs, unresolved } = buildLowerTextRefs('{订单.金额} > 100 并且 {数量} > 0 或者 {订单.金额} < 0', SOURCES, FORMS, VARS);
    expect(unresolved).toEqual([]);
    expect(refs.map(r => r.stable_id)).toEqual(['source_field:t1:f-amount', 'source_field:bt0:f-qty', 'source_field:t1:f-amount']);
    expect(refs[0]).toEqual({ label: '订单.金额', stable_id: 'source_field:t1:f-amount', target: { kind: 'source_field', alias: 't1', field_id: 'f-amount' } });
  });

  it('系统变量按目录标签解析成 system_var 目标（文本里不再用 @var_id）', () => {
    const { refs, unresolved } = buildLowerTextRefs('{订单.金额} > 0 并且 {今天} > {订单.状态}', SOURCES, FORMS, VARS);
    expect(unresolved).toEqual([]);
    expect(refs[1]).toEqual({ label: '今天', stable_id: 'system_var:today', target: { kind: 'system_var', var_id: 'today' } });
  });

  it('解析不到的标签进 unresolved，不产出 ref', () => {
    const { refs, unresolved } = buildLowerTextRefs('{订单.金额} + {不存在}', SOURCES, FORMS, VARS);
    expect(refs).toHaveLength(1);
    expect(unresolved).toEqual(['不存在']);
  });
});

describe('restoreTextFromSource（重开：按稳定 ID 重绘字段名）', () => {
  const source: TextSource = {
    text: '{订单.金额} > 100 并且 {今天} > {订单.状态}',
    pack_revision: 'alice-locale-zh-CN/v4',
    digest: 'd',
    refs: [
      { stable_id: 'source_field:t1:f-amount', label: '订单.金额' },
      { stable_id: 'system_var:today', label: '今天' },
      { stable_id: 'source_field:t1:f-status', label: '订单.状态' }
    ]
  };

  it('字段改名后原文标签按当前字段名重绘（改名同步）', () => {
    const renamed: SourceTableLite[] = [{ ...SOURCES[0], fields: [{ field_id: 'f-amount', field_name: '合同金额' }, { field_id: 'f-status', field_name: '状态' }] as SourceTableLite['fields'] }];
    expect(restoreTextFromSource(source, renamed, FORMS, VARS)).toBe('{订单.合同金额} > 100 并且 {今天} > {订单.状态}');
  });

  it('系统变量标签随目录刷新', () => {
    expect(restoreTextFromSource(source, SOURCES, FORMS, [{ var_id: 'today', label: '当前日期', type: 'datetime' }])).toBe('{订单.金额} > 100 并且 {当前日期} > {订单.状态}');
  });

  it('来源表已被移除（反查不到）时保留原标签，不退化成裸 field_id', () => {
    expect(restoreTextFromSource(source, [], FORMS, VARS)).toBe('{订单.金额} > 100 并且 {今天} > {订单.状态}');
  });

  it('refs 里没有登记的标签（裸手写）原样保留', () => {
    const s: TextSource = { ...source, text: '{订单.金额} > {未登记}', refs: source.refs!.slice(0, 1) };
    expect(restoreTextFromSource(s, SOURCES, FORMS, VARS)).toBe('{订单.金额} > {未登记}');
  });
});

describe('runeToUtf16Index（服务端 rune 偏移 → textarea 下标）', () => {
  it('BMP 内字符两者相等（中文也是单码元）', () => {
    expect(runeToUtf16Index('{金额} > 100', 4)).toBe(4);
  });
  it('增补平面字符（emoji）占两个码元，偏移随之放大', () => {
    expect(runeToUtf16Index('😀{a} > 1', 1)).toBe(2);
    expect(runeToUtf16Index('😀{a} > 1', 4)).toBe(5);
  });
  it('越界钳到文本末尾、负数钳到 0', () => {
    expect(runeToUtf16Index('abc', 10)).toBe(3);
    expect(runeToUtf16Index('abc', -1)).toBe(0);
  });
});
