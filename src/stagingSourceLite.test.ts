/**
 * stagingSourceLite 判据：独立调用方合成的暂存来源必须与 ExpressionEditor.vue
 * sourceTablesForInput 的 staging 分支同一口径——alias/dataTableId 恒 '__staging__'，且产出的
 * SourceTableLite 要能被 bracketText.valueRefToBracketText 的既有暂存分支正确识别、落出
 * `暂存表.[列]` 保留前缀文本（不是按显式来源拼 `[产出名].[列]`）。
 */
import { describe, expect, it } from 'vitest';
import { stagingSourceToSourceTableLite, type StagingSourceLite } from './stagingSourceLite';
import { valueRefToBracketText } from './bracketText';
import type { ValueRef } from './types';

const staging: StagingSourceLite = {
  producerLabel: '上一步暂存区(提取订单明细)',
  columns: [
    { code: 'col_1', name: '订单号', type: 'text' },
    { code: 'col_2', name: '金额', type: 'number' },
    { code: 'col_3', name: '未知类型列', type: 'unknown-type' },
    { code: 'col_4', name: '缺类型列' }
  ]
};

describe('stagingSourceToSourceTableLite', () => {
  it('alias/dataTableId 恒 __staging__，name=producerLabel', () => {
    const lite = stagingSourceToSourceTableLite(staging);
    expect(lite.alias).toBe('__staging__');
    expect(lite.dataTableId).toBe('__staging__');
    expect(lite.name).toBe('上一步暂存区(提取订单明细)');
  });

  it('columns 经 stagingColumnToTemplateField 适配，未知/缺失类型回落 text', () => {
    const lite = stagingSourceToSourceTableLite(staging);
    expect(lite.fields.map(f => f.data_type)).toEqual(['text', 'number', 'text', 'text']);
    expect(lite.fields[0]).toMatchObject({ field_id: 'col_1', field_code: 'col_1', field_name: '订单号' });
  });

  it('source_field 引用落 暂存表.[列名]（与 bracketText.stagingBracketToken 同一字面量，不是显式来源写法）', () => {
    const lite = stagingSourceToSourceTableLite(staging);
    const ref: ValueRef = { kind: 'source_field', alias: '__staging__', field_id: 'col_1' };
    expect(valueRefToBracketText(ref, [lite], [], [])).toBe('暂存表.[订单号]');
  });
});
