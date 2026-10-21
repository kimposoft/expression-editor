import { describe, expect, it } from 'vitest';
import { reportTableNamesInText } from './reportTextRefs';

describe('reportTableNamesInText（V4 文本里的本报表引用）', () => {
  it('识别 本报表.[表].[字段]，按出现顺序去重', () => {
    expect(reportTableNamesInText('本报表.[采购明细].[数量] * 本报表.[采购订单的主表].[单价] + 本报表.[采购明细].[金额]'))
      .toEqual(['采购明细', '采购订单的主表']);
  });

  it('引号铁律：字符串字面量里的同形文本不算', () => {
    expect(reportTableNamesInText("'本报表.[采购明细].[数量]' + [入库流水].[数量]")).toEqual([]);
  });

  it('没有 本报表 前缀的 [表].[字段] 是显式来源，不算本报表', () => {
    expect(reportTableNamesInText('[入库流水].[数量] + 1')).toEqual([]);
  });

  it('前缀与点号之间允许空白', () => {
    expect(reportTableNamesInText('本报表 . [采购明细].[数量]')).toEqual(['采购明细']);
  });
});
