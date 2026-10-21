/**
 * bracketText 判据：V4（brackets 语法）下「点一下就落定」的结构化拾取值必须能
 * 写成 KimpoSQL 文本，且**三态不得坍缩**。
 */

import { describe, expect, it } from 'vitest';
import { bracketFieldToken, pickedRefForSyntax, valueRefToBracketText } from './bracketText';
import type { ValueRef } from './types';

// SourceTableLite 的真实形状：alias / dataTableId / name / fields（见 rawSerialize.ts）。
const sources = [
  {
    alias: 't1',
    dataTableId: 'tbl_src',
    name: '入库流水',
    fields: [{ field_id: 'fld_code', field_name: '物料编码' }]
  }
] as any;
const forms = [
  {
    alias: 'bt0',
    table: { data_table_id: 'tbl_form', table_name: '采购明细' },
    fields: [{ field_id: 'fld_qty', field_name: '数量' }]
  }
] as any;
const systemVars = [{ var_id: 'now', label: '当前时间' }] as any;

const toText = (ref: ValueRef | null | undefined) => valueRefToBracketText(ref, sources, forms, systemVars);

describe('bracketFieldToken', () => {
  it('按最后一个点拆成 [表].[字段]', () => {
    expect(bracketFieldToken('入库流水.物料编码')).toBe('[入库流水].[物料编码]');
  });

  it('剥掉「本报表.」前缀——V4 侧本报表各表就是普通来源，没有这个前缀', () => {
    expect(bracketFieldToken('本报表.采购明细.数量')).toBe('[采购明细].[数量]');
  });

  it('不含点的标签整段包一层方括号', () => {
    expect(bracketFieldToken('当前时间')).toBe('[当前时间]');
  });

  it('「暂存表.」前缀原样保留（与本报表刻意相反）——服务端只认保留形态 暂存表.[列]', () => {
    expect(bracketFieldToken('暂存表.物料名称')).toBe('暂存表.[物料名称]');
  });
});

describe('暂存来源（Phase B 动作暂存区，dataTableId==="__staging__"）2026-09-07', () => {
  // 别名两种形态都要覆盖（见任务背景）：t1 是新加时的编辑器别名，stg-* 是 V4 文档往返回来的别名——
  // 两者都不是 isReportContextAlias（不以 bt/rpt- 开头），此前都会误落进显式来源分支拼错文本。
  const stagingSourcesByAlias = (alias: string) =>
    [
      {
        alias,
        dataTableId: '__staging__',
        name: '上一步暂存区（提取数据）',
        fields: [{ field_id: 'col_material', field_name: '物料名称' }]
      }
    ] as any;

  it('别名 t1（新加时的编辑器别名）：不落进显式来源分支拼 [产出名].[列]，而是保留前缀 暂存表.[列]', () => {
    const sourcesT1 = stagingSourcesByAlias('t1');
    expect(
      valueRefToBracketText({ kind: 'source_field', alias: 't1', field_id: 'col_material' }, sourcesT1, forms, systemVars)
    ).toBe('暂存表.[物料名称]');
  });

  it('别名 stg-node-p1-a1b2c3（V4 文档往返回来的别名）：同样落 暂存表.[列]', () => {
    const alias = 'stg-node-p1-a1b2c3';
    const sourcesStg = stagingSourcesByAlias(alias);
    expect(valueRefToBracketText({ kind: 'source_field', alias, field_id: 'col_material' }, sourcesStg, forms, systemVars)).toBe(
      '暂存表.[物料名称]'
    );
  });

  it('pickedRefForSyntax：brackets 语法下暂存列拾取同样落 raw 文本 暂存表.[列]', () => {
    const sourcesT1 = stagingSourcesByAlias('t1');
    const picked = pickedRefForSyntax(
      { kind: 'source_field', alias: 't1', field_id: 'col_material' },
      'brackets',
      sourcesT1,
      forms,
      systemVars
    );
    expect(picked).toEqual({ kind: 'raw', text: '暂存表.[物料名称]' });
  });
});

describe('valueRefToBracketText 三态区分（不得坍缩）', () => {
  // 🔴 这三条是本文件的核心：`{kind:'const'}`（不填充）/ `value:null`（填 NULL）/ `value:''`
  // （填空串）是三种不同的业务语义，压平成同一个空串就等于把「这个字段本次不动」和
  // 「把这个字段清成空」混为一谈。
  it('value 缺省 = 不填充 ⇒ 返回 undefined，调用方保持占位态', () => {
    expect(toText({ kind: 'const' })).toBeUndefined();
  });

  it('value===null = 填 NULL ⇒ NULL', () => {
    expect(toText({ kind: 'const', value: null })).toBe('NULL');
  });

  it("value==='' = 填空串 ⇒ '' 而不是 undefined", () => {
    expect(toText({ kind: 'const', value: '' })).toBe("''");
  });
});

describe('valueRefToBracketText 各形态', () => {
  it('来源字段 ⇒ [表].[字段]', () => {
    expect(toText({ kind: 'source_field', alias: 't1', field_id: 'fld_code' })).toBe('[入库流水].[物料编码]');
  });

  it('本报表主表/明细字段 ⇒ 服务端唯一认可的 3 段保留形态 本报表.[表].[字段]（不是 3.4 的显示标签）', () => {
    // 3.4 显示标签：主表裸字段名 `数量`、明细 `采购明细 · 数量`——两者服务端都解析不到，V4 文本必须走保留前缀。
    expect(toText({ kind: 'source_field', alias: 'bt0', field_id: 'fld_qty' })).toBe('本报表.[采购明细].[数量]');
    expect(toText({ kind: 'form_field', table_id: 'tbl_form', field_id: 'fld_qty' })).toBe('本报表.[采购明细].[数量]');
  });

  it('系统变量：优先按 V4 目录解析口给的无引号点路径；目录缺席时拼可见的 系统变量.<显示名>（绝不压成空串）', () => {
    expect(
      valueRefToBracketText({ kind: 'system_var', var_id: 'now' }, sources, forms, systemVars, {
        systemVariableToken: id => (id === 'now' ? '系统变量.当前时间' : undefined)
      })
    ).toBe('系统变量.当前时间');
    expect(toText({ kind: 'system_var', var_id: 'now' })).toBe('系统变量.当前时间');
  });

  it('同表多实例的显式来源带序号：[表(2)].[字段]——与适配层 catalogSourceAlias 同一规则', () => {
    const twice = [
      { alias: 't1', dataTableId: 'tbl_src', name: '入库流水', fields: [{ field_id: 'f', field_name: '物料编码' }] },
      { alias: 't2', dataTableId: 'tbl_src', name: '入库流水', fields: [{ field_id: 'f', field_name: '物料编码' }] }
    ] as any;
    expect(valueRefToBracketText({ kind: 'source_field', alias: 't2', field_id: 'f' }, twice, forms, systemVars)).toBe('[入库流水(2)].[物料编码]');
  });

  it('字符串常量单引号包裹，内部单引号翻倍转义', () => {
    expect(toText({ kind: 'const', value: "it's" })).toBe("'it''s'");
  });

  it('数值/布尔常量裸写，不加引号', () => {
    expect(toText({ kind: 'const', value: 42 })).toBe('42');
    expect(toText({ kind: 'const', value: true })).toBe('true');
  });

  it('空输入与转不出文本的形态一律 undefined——绝不兜底成空串', () => {
    expect(toText(null)).toBeUndefined();
    expect(toText(undefined)).toBeUndefined();
    // func 等结构化形态在 V4 首版「仅表达式输入」边界下不由拾取入口产出，遇到时保持原值。
    expect(toText({ kind: 'func', name: 'sum', args: [] } as ValueRef)).toBeUndefined();
  });
});

describe('pickedRefForSyntax 语法分支（接线语义）', () => {
  const pick = (ref: ValueRef | null, syntax: 'braces' | 'brackets') =>
    pickedRefForSyntax(ref, syntax, sources, forms, systemVars);
  const fieldRef: ValueRef = { kind: 'source_field', alias: 't1', field_id: 'fld_code' };

  it('brackets（V4）：结构化拾取值转成 raw 文本节点', () => {
    expect(pick(fieldRef, 'brackets')).toEqual({ kind: 'raw', text: '[入库流水].[物料编码]' });
    expect(pick({ kind: 'const', value: null }, 'brackets')).toEqual({ kind: 'raw', text: 'NULL' });
  });

  it('braces（3.4）：原样返回——存量路径行为逐字不变', () => {
    expect(pick(fieldRef, 'braces')).toBe(fieldRef);
    const nullRef: ValueRef = { kind: 'const', value: null };
    expect(pick(nullRef, 'braces')).toBe(nullRef);
  });

  it('已经是 raw、或转不出文本的形态，两种语法下都原样返回', () => {
    const raw: ValueRef = { kind: 'raw', text: "[a].[b] + 1" };
    expect(pick(raw, 'brackets')).toBe(raw);
    // 「不填充」占位态必须原样保留，让 finalize 去剔除——转成空串会把三态压平。
    const placeholder: ValueRef = { kind: 'const' };
    expect(pick(placeholder, 'brackets')).toBe(placeholder);
    expect(pick(null, 'brackets')).toBeNull();
  });
});
