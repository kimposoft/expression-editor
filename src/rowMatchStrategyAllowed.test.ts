import { describe, expect, it } from 'vitest';
import { rowMatchStrategyAllowed } from './types';

/**
 * rowMatchStrategyAllowed 单测：填充策略「按行列匹配」是否对某目标可选。
 * 抽成纯函数供 ExpressionEditor.strategyOptionsFor 复用——挂载类单测覆盖 naive-ui 下拉弹层交互
 * 成本高（需真实渲染 NSelect 并解析下拉项），改测这条纯判定，风格同 matchKeyExtract.ts 抽离先例。
 * ①主表恒不可选（不论 auto_row_match 取值）——主表全局唯一一行，不存在"该写哪一行"；
 */
describe('rowMatchStrategyAllowed', () => {
  it('主表：无论 auto_row_match 是否为真，恒不可选', () => {
    expect(rowMatchStrategyAllowed('main', false)).toBe(false);
    expect(rowMatchStrategyAllowed('main', true)).toBe(false);
    expect(rowMatchStrategyAllowed('main', undefined)).toBe(false);
  });

  it('扩展表：手动模式（auto_row_match 为假/未设置）可选', () => {
    expect(rowMatchStrategyAllowed('detail', false)).toBe(true);
    expect(rowMatchStrategyAllowed('detail', undefined)).toBe(true);
  });

  it('扩展表：自动模式（auto_row_match=true）不可选——匹配键改由条件段自动提取', () => {
    expect(rowMatchStrategyAllowed('detail', true)).toBe(false);
  });
});
