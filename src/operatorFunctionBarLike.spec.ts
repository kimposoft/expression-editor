/**
 * OperatorFunctionBar 运算符行（2026-09-08 起算术/逻辑两行合并为单行）：
 * ① 模糊匹配三分 chip（包含 / 开头是 / 结尾是）只插入关键字本身
 *    （2026-09-07 二轮改判：`字段 包含 '内容'`，通配符由服务端降 IR 时自动补）；
 *    能力位 fail-closed：like 未下发时三条一并不显示，下发后都在。
 * ② 定稿清单十七项的顺序与内容，退役项不得回潮；
 *    并且/或者 是逻辑连接词，无能力位，任何能力面下都显示。
 * ③ `()` / `''` 是成对包裹条目：点击发 wrap 而不是 insert（选区包裹由消费方 ExpressionSqlEditor 实现）。
 */
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import OperatorFunctionBar from './OperatorFunctionBar.vue';
import { publicExpressionCapabilities } from './useExpressionContext';

/** 模块初值即 fail-closed（无 like）；用例改完后复原。 */
const INITIAL = { ...publicExpressionCapabilities.value };
const withPredicates = () =>
  ({ ...INITIAL, compare_operators: ['eq', 'like', 'is_null', 'is_not_null'] }) as typeof INITIAL;

function chip(wrapper: ReturnType<typeof mount>, key: string) {
  return wrapper.find(`.op-chip[data-keyword="${key}"]`);
}

afterEach(() => {
  publicExpressionCapabilities.value = { ...INITIAL };
});

describe('OperatorFunctionBar：合并后的运算符行', () => {
  it('like 能力位未下发时不显示模糊匹配三条；下发后都显示', async () => {
    const wrapper = mount(OperatorFunctionBar, { props: { showFunctions: false } });
    for (const key of ['contains', 'starts_with', 'ends_with']) expect(chip(wrapper, key).exists()).toBe(false);
    publicExpressionCapabilities.value = withPredicates();
    await wrapper.vm.$nextTick();
    for (const key of ['contains', 'starts_with', 'ends_with']) expect(chip(wrapper, key).exists()).toBe(true);
  });

  it('并且/或者 不受能力位门控：like 等谓词位全缺时仍显示', () => {
    const wrapper = mount(OperatorFunctionBar, { props: { showFunctions: false } });
    expect(chip(wrapper, 'and').exists()).toBe(true);
    expect(chip(wrapper, 'or').exists()).toBe(true);
  });

  it('清单与顺序即定稿的十七项，退役 chip 不再出现', async () => {
    publicExpressionCapabilities.value = withPredicates();
    const wrapper = mount(OperatorFunctionBar, { props: { showFunctions: false } });
    await wrapper.vm.$nextTick();
    const keys = wrapper.findAll('.op-chip').map(el => el.attributes('data-keyword'));
    expect(keys).toEqual([
      'plus',
      'minus',
      'times',
      'divide',
      'paren',
      'quote',
      'lt',
      'gt',
      'eq',
      'ne',
      'contains',
      'starts_with',
      'ends_with',
      'is_null',
      'is_not_null',
      'and',
      'or'
    ]);
    // 合并时退役：比较符四项与 NOT、不包含、属于/不属于、介于/不介于（AND/OR 二轮补回，不在此列）
    for (const gone of ['not', 'not_contains', 'in', 'not_in', 'between', 'not_between']) {
      expect(chip(wrapper, gone).exists()).toBe(false);
    }
    expect(wrapper.findAll('.op-chip').map(el => el.text())).not.toContain('<=');
  });

  it('符号/关键字 chip 插入两侧留空格的文本，不带通配片段', async () => {
    publicExpressionCapabilities.value = withPredicates();
    const wrapper = mount(OperatorFunctionBar, { props: { showFunctions: false } });
    await wrapper.vm.$nextTick();
    for (const key of ['plus', 'lt', 'gt', 'eq', 'ne', 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null', 'and', 'or']) {
      await chip(wrapper, key).trigger('click');
    }
    // 未注入宿主时 textPackLangOf(undefined) 回落英文包（中文关键字由 functionCatalog.test 钉）
    expect(wrapper.emitted('insert')).toEqual([
      [' + '],
      [' < '],
      [' > '],
      [' = '],
      [' <> '],
      [' CONTAINS '],
      [' STARTS_WITH '],
      [' ENDS_WITH '],
      [' IS NULL '],
      [' IS NOT NULL '],
      [' AND '],
      [' OR ']
    ]);
  });

  it("`()` / `''` 走 wrap 事件（左右符号分开传），不发 insert", async () => {
    const wrapper = mount(OperatorFunctionBar, { props: { showFunctions: false } });
    expect(chip(wrapper, 'paren').text()).toBe('()');
    expect(chip(wrapper, 'quote').text()).toBe("''");
    await chip(wrapper, 'paren').trigger('click');
    await chip(wrapper, 'quote').trigger('click');
    expect(wrapper.emitted('wrap')).toEqual([
      ['(', ')'],
      ["'", "'"]
    ]);
    expect(wrapper.emitted('insert')).toBeUndefined();
  });
});
