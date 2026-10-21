/**
 * reportTextRefs —— 在 V4（brackets）文本里找出「本报表」引用所指的表。
 *
 * 为什么需要：3.4 编辑器的调和（ExpressionEditor.reconcile）按「模型里被引用的 bt* 别名」决定本报表
 * 上下文表要不要纳入/剔除；V4 壳下引用是纯文本 `本报表.[表].[字段]`，调和看不见——不补这一眼，
 * 本报表表永远进不了 V4 文档的 report 来源，服务端作用域里没有它，整条引用解析失败。
 *
 * 判定走词法扫描（kimpoSqlHighlight.scanKimpoSql，引号铁律：字符串字面量内的 `本报表.[x].[y]` 不算），
 * 不做正则整段替换。只认与服务端同款的紧凑形态 `本报表.[表].[字段]`（`本报表` 与 `.` 之间允许空白）。
 */
import { scanKimpoSql } from './kimpoSqlHighlight';

/** 文本里所有 `本报表.[表].[字段]` 引用的表显示名（按出现顺序，去重）。
 *  扫描器（2026-09-07 起）把多段引用拆成「表段 ref-table（report=true 即带本报表前缀）+ 字段段」，
 *  这里直接取表段的 table；三段以上的畸形写法取首段（与旧口径一致）。 */
export function reportTableNamesInText(text: string): string[] {
  const names: string[] = [];
  for (const tok of scanKimpoSql(text)) {
    if (tok.kind !== 'ref-table' || !tok.report) continue;
    const name = (tok.table ?? '').split('].[')[0];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * 写模式「目标」候选表的引用检测：文本里是否存在对指定表显示名的
 * **普通**方括号引用 `[表名].[字段]`——不带 `本报表.`/`暂存表.` 保留前缀（那两种是 kind=report/
 * staging 的专属写法，目标候选表是普通 kind=catalog 来源，没有前缀，与用户手动添加的显式来源引用
 * 写法完全一样）。
 *
 * 为什么需要它：目标模板配对表（新增到主表/扩展表时的目标表本身、修改/删除扩展表目标时的主表）
 * 在被引用前并不在 model.source.tables 里（「引用即入源」，与本报表 bt* 同一即用即物化机制），
 * ExpressionEditor.vue 的 reconcile 需要靠扫描已写下的表达式原文来判定"要不要把它正式补进来源"——
 * 与 reportTableNamesInText 同一扫描器（scanKimpoSql），只是反过来只认**非** report/非 staging 的
 * ref-table token，按「表段」精确匹配传入的 tableDisplayName（大小写与全角/半角不做归一化，与
 * scanKimpoSql 词法本身的大小写敏感口径一致）。
 */
export function plainTableNameReferencedInText(text: string, tableDisplayName: string): boolean {
  if (!tableDisplayName) return false;
  for (const tok of scanKimpoSql(text)) {
    if (tok.kind !== 'ref-table' || tok.report || tok.staging) continue;
    const name = (tok.table ?? '').split('].[')[0];
    if (name === tableDisplayName) return true;
  }
  return false;
}
