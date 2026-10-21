/**
 * 表达式编辑器校验错误信息本地化映射（F3）。
 *
 * 本文件按「模式（正则）→ i18n key」的映射表，在展示前把高频错误串替换成随语言切换的友好文案；
 * 命中模式时用捕获组填充占位符（第几个填充目标/字段等），未命中任何模式的错误串原样透传——
 * 宁可显示原始 debug 文案，也不能让匹配不到的错误信息被吞掉、掩盖真实问题。
 *
 * 映射来源（枚举高频串的两处依据）：
 */

/** 一条错误串映射规则：正则命中即换用对应 i18n key 的友好文案。 */
export interface ErrorMessagePattern {
  /** 匹配原始错误串的正则——不加 ^/$ 锚定，因为原串通常带 "invalid_input: " 等错误码前缀
   *  与 ": 底层原因" 后缀（见 action.Error.Error()），本表只需命中中段的稳定措辞即可，
   *  用 String.prototype.match 在整串中查找子串匹配。捕获组按出现顺序对应文案里的
   *  {n0}/{n1}/…占位符（包内 t() 不做参数插值，占位符由 friendlyErrorMessage 手动 replace，
   *  与 ConditionTree.vue withName 对 {name} 的既有处理同一惯例）。 */
  pattern: RegExp;
  /** 对应的 i18n key，须在 locales/{zh-CN,en-US,ja-JP,zh-TW}.ts 四份词表登记同一 key。 */
  key: string;
  ordinalGroups?: number[];
}

/**
 * 高频错误串映射表。
 * 未命中本表任何模式的错误串在 friendlyErrorMessage 里原样透传。
 */
export const ERROR_MESSAGE_PATTERNS: readonly ErrorMessagePattern[] = [
  { pattern: /expression fill target\[(\d+)\] requires target_template_id and target_data_table_id/, key: 'errMsg.fillTargetMissingTable', ordinalGroups: [0] },
  { pattern: /expression fill target\[(\d+)\] output\[(\d+)\] requires target_field_id/, key: 'errMsg.fillTargetMissingField', ordinalGroups: [0, 1] },
  { pattern: /expression fill target\[(\d+)\] template "[^"]*" does not own current Mirror template "[^"]*"/, key: 'errMsg.fillTargetTemplateMismatch', ordinalGroups: [0] },
  { pattern: /resolve expression fill target\[(\d+)\] table "[^"]*"/, key: 'errMsg.fillTargetResolveTable', ordinalGroups: [0] },
  { pattern: /resolve expression fill target\[(\d+)\] field "[^"]*"/, key: 'errMsg.fillTargetResolveField', ordinalGroups: [0] },

  { pattern: /引用了未声明的来源表别名 "[^"]*"/, key: 'errMsg.unknownSourceAlias' },
  { pattern: /无权读取来源模板 \S+ 的数据表 \S+\([^)]*\)/, key: 'errMsg.forbiddenSourceTable' },
  { pattern: /无权读取字段 \S+\([^)]*\)/, key: 'errMsg.forbiddenField' },
  { pattern: /source\.joins\[(\d+)\]: 未知别名 "[^"]*"/, key: 'errMsg.joinUnknownAlias', ordinalGroups: [0] },
  { pattern: /未知来源表别名 "[^"]*"/, key: 'errMsg.unknownAliasInJoin' },
  { pattern: /聚合函数 (\S+) 需要 1 个参数/, key: 'errMsg.aggregateArgCount' },
  { pattern: /不支持的函数 "([^"]*)"/, key: 'errMsg.unsupportedFunction' },
  { pattern: /字段标记\((\d+)\)与字段引用\((\d+)\)数量不一致/, key: 'errMsg.fieldTokenMismatch' },
  { pattern: /来源表 \S+\([^)]*\) 存在数据域限制，当前多表表达式不支持安全下推，已拒绝执行/, key: 'errMsg.dataScopeMultiTableRejected' },

  { pattern: /无权设计来源应用 \S+，不能编辑引用该应用的取数配置/, key: 'errMsg.forbiddenSourceApp' },

  { pattern: /表达式结构校验未通过：(.+)/, key: 'errMsg.expressionPreviewStructureInvalid' },
  { pattern: /表达式引用校验未通过：(.+)/, key: 'errMsg.expressionPreviewReferenceNotFound' },

  { pattern: /填充目标字段 \S+ 的取值用了聚合函数 \S+/, key: 'errMsg.aggregateFillOutputUnsupported' },
  { pattern: /匹配条件的来源取值用了聚合函数 \S+/, key: 'errMsg.aggregateFillOutputUnsupported' },

  { pattern: /匹配条件字段 \S+ 与 \S+ 的类型不相容/, key: 'errMsg.matchKeyTypeIncompatible' },
  { pattern: /填充目标字段 \S+ 不支持(追加|合并)策略/, key: 'errMsg.fillStrategyTypeUnsupported' },
  { pattern: /修改\/删除必须配置定位条件/, key: 'errMsg.writeWhereRequired' },

  { pattern: /分组后筛选需要先配置分组字段/, key: 'errMsg.havingRequiresGroupBy' },
  { pattern: /分组后筛选的条件引擎无法承接/, key: 'errMsg.havingUnsupported' },

  { pattern: /分组后筛选的条件只支持常量右值/, key: 'errMsg.havingRightOperandNonConst' },

  { pattern: /多来源表下自动匹配键无法确定锚定表/, key: 'errMsg.automaticRowMatchMultiSourceInvalid' },

  { pattern: /自动关联要求左表是主表、右表是同一模板的明细表|自动关联（主表 ⋈ 明细）只支持内连接/, key: 'errMsg.autoRecordIDShapeInvalid' }
];

/**
 * 按模式表把原始错误串转换为随语言切换的友好文案；未命中任何模式时原样返回 raw（不吞真实
 * 错误信息）。空串直接返回（无需查表）。
 *
 * t：调用方注入的翻译函数（useT() 产物）。本文件不依赖 Vue inject，保持纯函数——单测无需挂载
 * 组件即可直接调用 friendlyErrorMessage，也便于反验（临时删掉某条 ERROR_MESSAGE_PATTERNS 映射，
 * 对应用例立刻转红，是本文件的最低验收线）。
 */
export function friendlyErrorMessage(raw: string, t: (key: string) => string): string {
  if (!raw) return raw;
  for (const { pattern, key, ordinalGroups } of ERROR_MESSAGE_PATTERNS) {
    const m = raw.match(pattern);
    if (!m) continue;
    let text = t(key);
    // 捕获组按顺序替换 {n0}/{n1}/…；某条文案未使用某个占位符时 replace 找不到目标即为 no-op，
    // 不会报错（如 fillTargetTemplateMismatch 只用了 index，未插值具体模板 ID，属有意省略）。
    // ordinalGroups 标记的捕获组是后端 0 基序号，展示前 +1（人类从 1 数）。
    m.slice(1).forEach((group, i) => {
      const shown = ordinalGroups?.includes(i) && group != null ? String(Number(group) + 1) : (group ?? '');
      text = text.replace(`{n${i}}`, shown);
    });
    return text;
  }
  return raw;
}
