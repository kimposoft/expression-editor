import { describe, expect, it } from 'vitest';
import { TEXT_KEYWORDS, textFunctionAliasOf, textFunctionCatalog, textPackLangOf } from './functionCatalog';

describe('textPackLangOf（显示语言 → 别名语言包）', () => {
  it('任何 zh-* 落中文包（zh-TW 服务端回落 zh-CN），其余落英文包（ja-JP 服务端回落 en-US）', () => {
    expect(textPackLangOf('zh-CN')).toBe('zh');
    expect(textPackLangOf('zh-TW')).toBe('zh');
    expect(textPackLangOf('zh-HK')).toBe('zh');
    expect(textPackLangOf('en-US')).toBe('en');
    expect(textPackLangOf('ja-JP')).toBe('en');
    expect(textPackLangOf(undefined)).toBe('en');
  });
});

describe('textFunctionCatalog（按 textmodel 口径裁剪）', () => {
  it('OVER 仍去掉（WINDOW_UNSUPPORTED 具名拒绝）；ROUND 已注册回函数注册表，不再排除', () => {
    for (const lang of ['zh', 'en'] as const) {
      const keys = textFunctionCatalog(lang).map(i => i.key);
      expect(keys).toContain('round');
      expect(keys).not.toContain('over');
      const snips = textFunctionCatalog(lang).map(i => i.snip).join(' ');
      // ROUND 现在是合法片段，不能再断言 snips 不含 ROUND；只断言开窗相关片段仍不存在。
      expect(snips).not.toMatch(/OVER|PARTITION/);
    }
  });

  it('覆盖服务端认的全部函数：聚合 5 + 行数 + coalesce/concat + 注册表标量 17 + 本批 8 个标量 + 2 个规范构造（nullif/iif）+ CASE 片段', () => {
    const keys = textFunctionCatalog('en').map(i => i.key);
    expect(keys).toEqual([
      'sum', 'count', 'count_star', 'count_distinct', 'avg', 'min', 'max', 'concat', 'coalesce',
      'abs', 'charindex', 'datediff', 'dateadd', 'year', 'month', 'year_month', 'year_month_day',
      'month_start', 'quarter_start', 'year_start', 'week_start', 'round', 'len', 'left', 'right', 'replace', 'trim',
      'upper', 'lower', 'ltrim', 'rtrim', 'substring', 'floor', 'ceiling', 'day', 'nullif', 'iif', 'case'
    ]);
  });

  it('每个函数都带稳定类型，供条件弹窗「更多」按聚合/数值/文本/日期时间/条件分组', () => {
    const grouped = textFunctionCatalog('zh').reduce<Record<string, string[]>>((result, item) => {
      (result[item.category] ??= []).push(item.key);
      return result;
    }, {});
    expect(grouped).toEqual({
      aggregate: ['sum', 'count', 'count_star', 'count_distinct', 'avg', 'min', 'max'],
      text: ['concat', 'charindex', 'len', 'left', 'right', 'replace', 'trim', 'upper', 'lower', 'ltrim', 'rtrim', 'substring'],
      conditional: ['coalesce', 'nullif', 'iif', 'case'],
      numeric: ['abs', 'round', 'floor', 'ceiling'],
      dateTime: ['datediff', 'dateadd', 'year', 'month', 'year_month', 'year_month_day', 'month_start', 'quarter_start', 'year_start', 'week_start', 'day']
    });
  });

  it('zh 包插中文主别名（年份( / 合计( / 空值替换(），en 包插英文（YEAR( / SUM( / COALESCE(）', () => {
    const zh = Object.fromEntries(textFunctionCatalog('zh').map(i => [i.key, i.snip]));
    const en = Object.fromEntries(textFunctionCatalog('en').map(i => [i.key, i.snip]));
    expect(zh.year).toBe('年份()');
    expect(zh.sum).toBe('合计()');
    expect(zh.coalesce).toBe('空值替换()');
    expect(zh.concat).toBe('连接文本()');
    expect(zh.count_star).toBe('行数()');
    expect(zh.case).toBe('分支 当  则  否则  结束');
    expect(en.year).toBe('YEAR()');
    expect(en.sum).toBe('SUM()');
    expect(en.coalesce).toBe('COALESCE()');
    expect(en.count_star).toBe('ROW_COUNT()');
    expect(en.case).toBe('CASE WHEN  THEN  ELSE  END');
  });

  it('函数片段恒以 "()" 结尾，CASE 片段除外', () => {
    for (const item of textFunctionCatalog('zh')) {
      if (item.key === 'case') continue;
      expect(item.snip.endsWith('()')).toBe(true);
    }
  });

  it('六个新标量函数 snip 与服务端可移植函数别名表 别名逐字对拍', () => {
    const backendAlias: Record<string, { zh: string; en: string }> = {
      round: { zh: '四舍五入', en: 'ROUND' },
      len: { zh: '长度', en: 'LEN' },
      left: { zh: '左截取', en: 'LEFT' },
      right: { zh: '右截取', en: 'RIGHT' },
      replace: { zh: '替换', en: 'REPLACE' },
      trim: { zh: '去空格', en: 'TRIM' }
    };
    const zh = Object.fromEntries(textFunctionCatalog('zh').map(i => [i.key, i.snip]));
    const en = Object.fromEntries(textFunctionCatalog('en').map(i => [i.key, i.snip]));
    for (const [key, alias] of Object.entries(backendAlias)) {
      expect(zh[key]).toBe(`${alias.zh}()`);
      expect(en[key]).toBe(`${alias.en}()`);
    }
  });

  it('去重计数 / 周初 snip 与服务端可移植函数别名表 逐字对拍', () => {
    const backendAlias: Record<string, { zh: string; en: string }> = {
      count_distinct: { zh: '去重计数', en: 'COUNT_DISTINCT' },
      week_start: { zh: '周初', en: 'WEEK_START' }
    };
    const zh = Object.fromEntries(textFunctionCatalog('zh').map(i => [i.key, i.snip]));
    const en = Object.fromEntries(textFunctionCatalog('en').map(i => [i.key, i.snip]));
    for (const [key, alias] of Object.entries(backendAlias)) {
      expect(zh[key]).toBe(`${alias.zh}()`);
      expect(en[key]).toBe(`${alias.en}()`);
    }
    // 反写别名：count_distinct 不能被普通 count 抢走，week_start 按语义 ID 反查。
    expect(textFunctionAliasOf('count_distinct', 'zh')).toBe('去重计数');
    expect(textFunctionAliasOf('count', 'en')).toBe('COUNT');
    expect(textFunctionAliasOf('fn.week_start', 'en')).toBe('WEEK_START');
  });

  it('本 wave 10 个新函数（8 标量 + nullif/iif）snip 与服务端可移植函数别名表 逐字对拍', () => {
    const backendAlias: Record<string, { zh: string; en: string }> = {
      upper: { zh: '大写', en: 'UPPER' },
      lower: { zh: '小写', en: 'LOWER' },
      ltrim: { zh: '左去空格', en: 'LTRIM' },
      rtrim: { zh: '右去空格', en: 'RTRIM' },
      substring: { zh: '截取', en: 'SUBSTRING' },
      floor: { zh: '向下取整', en: 'FLOOR' },
      ceiling: { zh: '向上取整', en: 'CEILING' },
      day: { zh: '日', en: 'DAY' },
      nullif: { zh: '相等置空', en: 'NULLIF' },
      iif: { zh: '条件取值', en: 'IIF' }
    };
    const zh = Object.fromEntries(textFunctionCatalog('zh').map(i => [i.key, i.snip]));
    const en = Object.fromEntries(textFunctionCatalog('en').map(i => [i.key, i.snip]));
    for (const [key, alias] of Object.entries(backendAlias)) {
      expect(zh[key]).toBe(`${alias.zh}()`);
      expect(en[key]).toBe(`${alias.en}()`);
    }
  });
});

describe('textFunctionAliasOf（降级函数名 → 别名，结构反写用）', () => {
  it('V1 短名与 fn.* 语义 ID 都能反查', () => {
    expect(textFunctionAliasOf('sum', 'zh')).toBe('合计');
    expect(textFunctionAliasOf('SUM', 'en')).toBe('SUM');
    expect(textFunctionAliasOf('fn.year', 'zh')).toBe('年份');
    expect(textFunctionAliasOf('fn.year', 'en')).toBe('YEAR');
    expect(textFunctionAliasOf('count', 'zh')).toBe('计数'); // count 与 count_star 同名，优先带参形态
    expect(textFunctionAliasOf('round', 'zh')).toBeNull();
  });

  it('六个新标量函数的 loweredName 均为 fn.* 语义 ID（同 fn.abs/fn.year 既有口径），非 V1 短名裸词', () => {
    expect(textFunctionAliasOf('fn.round', 'zh')).toBe('四舍五入');
    expect(textFunctionAliasOf('fn.round', 'en')).toBe('ROUND');
    expect(textFunctionAliasOf('fn.len', 'zh')).toBe('长度');
    expect(textFunctionAliasOf('fn.len', 'en')).toBe('LEN');
    expect(textFunctionAliasOf('fn.left', 'zh')).toBe('左截取');
    expect(textFunctionAliasOf('fn.right', 'zh')).toBe('右截取');
    expect(textFunctionAliasOf('fn.replace', 'zh')).toBe('替换');
    expect(textFunctionAliasOf('fn.trim', 'zh')).toBe('去空格');
    // 裸词 'round'（非 fn.round）依旧查不到——注册表标量口径统一保留语义 ID，不是 V1 短名。
    expect(textFunctionAliasOf('round', 'zh')).toBeNull();
  });

  it('本 wave 8 个新标量同样按 fn.* 语义 ID 反查（同 fn.round 既有口径），nullif/iif 按 coalesce 裸短名口径反查', () => {
    expect(textFunctionAliasOf('fn.upper', 'zh')).toBe('大写');
    expect(textFunctionAliasOf('fn.upper', 'en')).toBe('UPPER');
    expect(textFunctionAliasOf('fn.day', 'zh')).toBe('日');
    expect(textFunctionAliasOf('fn.day', 'en')).toBe('DAY');
    expect(textFunctionAliasOf('nullif', 'zh')).toBe('相等置空');
    expect(textFunctionAliasOf('nullif', 'en')).toBe('NULLIF');
    expect(textFunctionAliasOf('iif', 'zh')).toBe('条件取值');
    expect(textFunctionAliasOf('iif', 'en')).toBe('IIF');
    // 裸词 'upper'（非 fn.upper）依旧查不到——同 round 行既有口径。
    expect(textFunctionAliasOf('upper', 'zh')).toBeNull();
  });
});

describe('TEXT_KEYWORDS（逻辑运算符条）', () => {
  it('zh 包插中文关键字，NOT IN 两词之间留空格（表达式引擎词法对连续汉字做最大匹配）', () => {
    const zh = Object.fromEntries(TEXT_KEYWORDS.map(k => [k.key, k.symbol.zh]));
    expect(zh).toEqual({
      and: '并且',
      or: '或者',
      contains: '包含',
      starts_with: '开头是',
      ends_with: '结尾是',
      not_contains: '不 包含',
      in: '属于',
      not_in: '不 属于',
      between: '介于',
      not_between: '不 介于',
      is_null: '为 空值',
      is_not_null: '为 不 空值',
      not: '不'
    });
    const en = Object.fromEntries(TEXT_KEYWORDS.map(k => [k.key, k.symbol.en]));
    expect(en).toEqual({
      and: 'AND',
      or: 'OR',
      contains: 'CONTAINS',
      starts_with: 'STARTS_WITH',
      ends_with: 'ENDS_WITH',
      not_contains: 'NOT CONTAINS',
      in: 'IN',
      not_in: 'NOT IN',
      between: 'BETWEEN',
      not_between: 'NOT BETWEEN',
      is_null: 'IS NULL',
      is_not_null: 'IS NOT NULL',
      not: 'NOT'
    });
  });
});

describe('模糊匹配三分关键字（2026-09-07 改判：只插关键字，通配符由服务端降 IR 时补）', () => {
  it('包含 / 开头是 / 结尾是 / 不包含 是普通关键字条目：不带片段，插入即 ` 关键字 `', () => {
    const byKey = Object.fromEntries(TEXT_KEYWORDS.map(k => [k.key, k])) as Record<string, (typeof TEXT_KEYWORDS)[number]>;
    expect(byKey.contains.symbol).toEqual({ zh: '包含', en: 'CONTAINS' });
    expect(byKey.starts_with.symbol).toEqual({ zh: '开头是', en: 'STARTS_WITH' });
    expect(byKey.ends_with.symbol).toEqual({ zh: '结尾是', en: 'ENDS_WITH' });
    expect(byKey.not_contains.symbol).toEqual({ zh: '不 包含', en: 'NOT CONTAINS' });
    // 原生 匹配 / LIKE 不再有 chip（仍可手敲）
    expect(TEXT_KEYWORDS.some(k => k.symbol.en === 'LIKE')).toBe(false);
  });
});
