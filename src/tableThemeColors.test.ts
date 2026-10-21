import { describe, expect, it } from 'vitest';
import {
  TABLE_THEME_COLOR_COUNT,
  splitLabeledTextSegments,
  tableColorClass,
  tableColorClassByLabel,
  tableColorClassFor,
  tableColorIndex,
  tokenTableClass
} from './tableThemeColors';
import type { FormTableLite, SourceTableLite } from './rawSerialize';

/**
 * 来源表主题色（2026-09-02 样式草案）守护测试：
 *  - 别名 → 色类的确定性映射（t1→ttc-0 起、循环、bt 前缀与非法别名不占色）；
 *  - splitLabeledTextSegments 的文本切段口径（来源字段着表色、本报表字段落 form_field、
 *    系统变量落 system_var、解析不到按 raw 保留、标记间文本 raw）。
 */

// —— 最小 Lite 快照：一张显式来源 t1（订单表）+ 一张本报表 bt0（主表）——
const SOURCES = [
  {
    alias: 't1',
    dataTableId: 'dt-order',
    name: '订单',
    fields: [{ field_id: 'f-amount', field_name: '金额' }]
  }
] as unknown as SourceTableLite[];
const FORMS = [
  {
    alias: 'bt0',
    table: { data_table_id: 'dt-main', table_name: '主表' },
    fields: [{ field_id: 'f-qty', field_name: '数量' }]
  }
] as unknown as FormTableLite[];
// 系统变量目录形状（label/var_id 是 resolveTextLabel 消费的两个键）。
const VARS = [{ var_id: 'current_user_id', label: '当前用户ID' }] as any[];

describe('tableColorClass：别名 → ttc 色类', () => {
  it('t1→ttc-0 起按序取色，超出色板容量循环', () => {
    expect(tableColorClass('t1')).toBe('ttc-0');
    expect(tableColorClass('t2')).toBe('ttc-1');
    expect(tableColorClass(`t${TABLE_THEME_COLOR_COUNT}`)).toBe(`ttc-${TABLE_THEME_COLOR_COUNT - 1}`);
    // 第 9 张来源表（t9）回到 0 号色。
    expect(tableColorClass(`t${TABLE_THEME_COLOR_COUNT + 1}`)).toBe('ttc-0');
  });

  it('本报表 bt* / 空 / 非法别名不占主题色（空串）', () => {
    expect(tableColorClass('bt0')).toBe('');
    expect(tableColorClass('bt1')).toBe('');
    expect(tableColorClass('')).toBe('');
    expect(tableColorClass(undefined)).toBe('');
    expect(tableColorClass('t0')).toBe(''); // 别名从 t1 起，t0 非法
    expect(tableColorClass('table1')).toBe('');
  });

  it('tokenTableClass 附加 ttc-themed 开关类；无色别名同样空串', () => {
    expect(tokenTableClass('t1')).toBe('ttc-themed ttc-0');
    expect(tokenTableClass('bt0')).toBe('');
  });
});

describe('splitLabeledTextSegments：文本表达式切段', () => {
  it('来源字段标记 → source_field + 表色；标记间文本 → raw', () => {
    const segs = splitLabeledTextSegments('{订单.金额} > 100', SOURCES, FORMS, VARS);
    expect(segs).toEqual([
      { text: '{订单.金额}', kind: 'source_field', tableClass: 'ttc-themed ttc-0' },
      { text: ' > 100', kind: 'raw', tableClass: '' }
    ]);
  });

  it('本报表字段（bt* 编码的 source_field）→ form_field 不占色；系统变量 → system_var', () => {
    // 本报表字段标签是「表·字段」中点格式（resolveLabel 的 MID_DOT 分支）；点号格式只匹配显式来源。
    const segs = splitLabeledTextSegments('{主表·数量} = {当前用户ID}', SOURCES, FORMS, VARS);
    expect(segs.map(s => [s.kind, s.tableClass])).toEqual([
      ['form_field', ''],
      ['raw', ''],
      ['system_var', '']
    ]);
  });

  it('解析不到的标记连同花括号按 raw 保留，不臆造归属', () => {
    const segs = splitLabeledTextSegments('{不存在的表.字段} + 1', SOURCES, FORMS, VARS);
    expect(segs[0]).toEqual({ text: '{不存在的表.字段}', kind: 'raw', tableClass: '' });
  });

  it('无标记的纯文本整体一段 raw；空文本零段', () => {
    expect(splitLabeledTextSegments('1 + 2', SOURCES, FORMS, VARS)).toEqual([{ text: '1 + 2', kind: 'raw', tableClass: '' }]);
    expect(splitLabeledTextSegments('', SOURCES, FORMS, VARS)).toEqual([]);
  });
});

describe('tableColorIndex / tableColorClassFor：V4 来源按出现顺序回退取色（2026-09-07）', () => {
  const V4 = [
    { alias: 'rpt-dt-main-abc123' },
    { alias: 'cat-dt-src-1a2b3c' },
    { alias: 'stg-1' },
    { alias: 'cat-dt-src-9f9f9f' }
  ];

  it('tN 别名沿用 (N-1)%8，与来源顺序无关', () => {
    expect(tableColorIndex('t2', V4)).toBe(1);
    expect(tableColorClassFor('t1', V4)).toBe('ttc-0');
  });

  it('非 tN 显式来源按「非上下文来源」的出现顺序取色；bt*/rpt-* 上下文别名不占号也不占色', () => {
    expect(tableColorIndex('cat-dt-src-1a2b3c', V4)).toBe(0);
    expect(tableColorIndex('stg-1', V4)).toBe(1);
    expect(tableColorClassFor('cat-dt-src-9f9f9f', V4)).toBe('ttc-2');
    expect(tableColorIndex('rpt-dt-main-abc123', V4)).toBe(-1);
    // 本报表上下文别名：不占色板序号，但拿本报表独立色（各面圆点 / 表 chip 用）
    expect(tableColorClassFor('bt0', V4)).toBe('ttc-report');
    expect(tableColorClassFor('rpt-dt-main-abc123', V4)).toBe('ttc-report');
    expect(tableColorClassFor('unknown', V4)).toBe('');
  });

  it('tableColorClassByLabel：按文本里的表写法（含同表多实例 (N) 后缀）反查色类', () => {
    const sources = [
      { alias: 'cat-a', dataTableId: 'dt-x', name: '入库流水', fields: [] },
      { alias: 'cat-b', dataTableId: 'dt-x', name: '入库流水', fields: [] },
      { alias: 'rpt-1', dataTableId: 'dt-main', name: '采购订单', fields: [] }
    ] as unknown as SourceTableLite[];
    // 同表多实例：instanceSuffix 从第一份起就带 (1)，裸表名不再指向任何一份
    expect(tableColorClassByLabel('入库流水(1)', sources)).toBe('ttc-0');
    expect(tableColorClassByLabel('入库流水(2)', sources)).toBe('ttc-1');
    expect(tableColorClassByLabel('入库流水', sources)).toBe('');
    expect(tableColorClassByLabel('采购订单', sources)).toBe('');
    expect(tableColorClassByLabel('不存在', sources)).toBe('');
  });
});

describe('splitLabeledTextSegments：brackets（V4）语法的方括号引用切段', () => {
  const V4_SOURCES = [
    { alias: 'cat-a', dataTableId: 'dt-x', name: '物料信息的主表', fields: [{ field_id: 'f1', field_name: '物料名称' }] }
  ] as unknown as SourceTableLite[];

  it('`[表].[字段]` → 整条一段 source_field，淡底表主题色，parts 拆出表名 / 字段 / 标点（方案 A）', () => {
    expect(splitLabeledTextSegments('[物料信息的主表].[物料名称] > 0', V4_SOURCES, FORMS, VARS)).toEqual([
      {
        text: '[物料信息的主表].[物料名称]',
        kind: 'source_field',
        tableClass: 'ttc-themed ttc-0',
        parts: [
          { text: '[', role: 'punc' },
          { text: '物料信息的主表', role: 'table' },
          { text: '].[', role: 'punc' },
          { text: '物料名称', role: 'field' },
          { text: ']', role: 'punc' }
        ]
      },
      { text: ' > 0', kind: 'raw', tableClass: '' }
    ]);
  });

  it('`本报表.[表].[字段]` → 整条一段 form_field 走本报表独立色，前缀归 punc；来源里查不到的表整条无色', () => {
    expect(splitLabeledTextSegments('本报表.[采购入库的扩展表].[数量] + [外部表].[金额]', V4_SOURCES, FORMS, VARS)).toEqual([
      {
        text: '本报表.[采购入库的扩展表].[数量]',
        kind: 'form_field',
        tableClass: 'ttc-themed ttc-report',
        parts: [
          { text: '本报表.', role: 'punc' },
          { text: '[', role: 'punc' },
          { text: '采购入库的扩展表', role: 'table' },
          { text: '].[', role: 'punc' },
          { text: '数量', role: 'field' },
          { text: ']', role: 'punc' }
        ]
      },
      { text: ' + ', kind: 'raw', tableClass: '' },
      {
        text: '[外部表].[金额]',
        kind: 'source_field',
        tableClass: '',
        parts: [
          { text: '[', role: 'punc' },
          { text: '外部表', role: 'table' },
          { text: '].[', role: 'punc' },
          { text: '金额', role: 'field' },
          { text: ']', role: 'punc' }
        ]
      }
    ]);
  });

  it('`暂存表.[列]` → 整条一段 form_field 走本报表独立色（Phase B 暂存来源与本报表同款前缀着色角色）；' +
    '没有独立 [表] 分段，parts 只有 前缀/[/字段/]', () => {
    expect(splitLabeledTextSegments('暂存表.[数量合计] + 1', V4_SOURCES, FORMS, VARS)).toEqual([
      {
        text: '暂存表.[数量合计]',
        kind: 'form_field',
        tableClass: 'ttc-themed ttc-report',
        parts: [
          { text: '暂存表.', role: 'punc' },
          { text: '[', role: 'punc' },
          { text: '数量合计', role: 'field' },
          { text: ']', role: 'punc' }
        ]
      },
      { text: ' + 1', kind: 'raw', tableClass: '' }
    ]);
  });

  it('单段 `[x]`：命中系统变量目录 → system_var，否则原样 raw；字符串字面量里的方括号不是引用', () => {
    expect(splitLabeledTextSegments('[当前用户ID] = [谁]', V4_SOURCES, FORMS, VARS)).toEqual([
      { text: '[当前用户ID]', kind: 'system_var', tableClass: '' },
      { text: ' = [谁]', kind: 'raw', tableClass: '' }
    ]);
    expect(splitLabeledTextSegments("'[物料信息的主表].[x]'", V4_SOURCES, FORMS, VARS)).toEqual([
      { text: "'[物料信息的主表].[x]'", kind: 'raw', tableClass: '' }
    ]);
  });
});
