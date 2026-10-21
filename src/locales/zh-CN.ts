/**
 * 表达式编辑器中文本地化字符串。
 * 组件优先使用 ExpressionHost.t()，缺省回退此表（保证默认显示仍为中文）。
 */
export default {
  // ── 通用 ───────────────────────────────────────────────────────────────────
  'common.noResponse': '无响应',
  'common.requestFailed': '请求失败',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.loading': '加载中...',
  'common.delete': '删除',
  'common.none': '（无）',
  // 「空值」快捷选项：ConditionTree.vue 条件值输入 ⊞ 快捷选择新增项
  // + ExpressionInput.vue/ConditionReadonlyView.vue 展示 kind='const'+value=null 时的专属文案。
  'common.nullValue': '空值',
  'editor.previewFailed': '校验失败',
  'editor.joinLabel': '表关联',

  // ── SourceTreePicker ───────────────────────────────────────────────────────
  'picker.addSource': '＋ 添加来源',
  'picker.title': '添加来源（选到数据表级，可重复选择）',
  'picker.titleSingle': '选择数据表（单选，重新选择会替换当前项）',
  'picker.noTemplates': '暂无模板',
  'picker.currentTemplate': '（本模板）',
  'picker.ungrouped': '未分组',
  'picker.currentApp': '（当前应用）',
  'picker.thisApp': '当前应用',
  'picker.mainTable': '主表',
  'picker.detailTable': '扩展表',
  'picker.selected': '已选（',
  'picker.selectHint': '点击左侧数据表加入；同一表可重复加入',
  'picker.selectHintSingle': '点击左侧数据表选择；重新点选会替换当前选择',
  // 2026-07-25 视觉重塑新增：已选面板头部「清空」按钮（node 369:18348）。
  'picker.clear': '清空',
  'picker.confirm': '确定（',
  // views-frontend-b2 R7：视图叶子（selectableKinds 含 'view' 时）。
  'picker.viewGeneric': '视图',
  'picker.viewSelfRefDisabled': '不可选择自身（会形成环）',
  'picker.viewRegular': '常规视图',
  'picker.viewCombined': '组合视图',
  // 列数单位后缀（同 editor.fieldCountSuffix 范式：数字由组件拼接，本 key 只是单位文本）。
  'picker.columnCountUnit': ' 列',
  'picker.disabledWriteTarget': '已是本次写入目标',
  // Phase B（动作暂存区）：树顶置顶虚拟叶子的通用语义标签（title 提示，可见文案取具体的 producerLabel）。
  'picker.stagingSource': '上一步暂存区',
  // 持久化的 staging 来源表在当前画布拓扑下取不到「上一步暂存区」时的降级提示（前驱节点被删等）。
  'picker.stagingNoProducer': '上一步未产出暂存区',
  // ── 编辑区引用补全分组 ──
  'completion.sourceGroup': '来源',
  'completion.reportGroup': '本报表',
  'completion.variableGroup': '系统变量',
  // S2b（外部数据表来源）：外部数据表叶子。
  'picker.externalGeneric': '外部表',

  // ── ExpressionEditor ──────────────────────────────────────────────────────
  'editor.loadFieldsFailed': '加载字段目录失败',
  'editor.previewValid': '校验通过：可编译为合法 SQL',
  'editor.previewInvalid': '校验未通过',
  'editor.noResponse': '无响应',
  'editor.drawerTitle': '统一字段抽屉',
  // 字段抽屉折叠/展开切换按钮的 aria-label（404:22903 二轮）。
  'editor.drawerCollapse': '收起字段抽屉',
  'editor.drawerExpand': '展开字段抽屉',

  // 来源段
  'editor.segSource': '来源 · 组 from',
  'editor.addSourceEmpty': '点右上「添加来源」选择其它数据表',
  'editor.addSourceEmptyNoImplicit': '点右上「添加来源」选择第一张来源表',
  'editor.templateLabel': '模板：',
  'editor.fieldCountSuffix': ' 字段',
  // views-extraction-b3 R2：视图来源 tag 的视觉区分后缀（不引入新图标体系）。
  'editor.sourceViewSuffix': '（视图）',
  // Phase B（动作暂存区）：暂存来源 tag 的视觉区分后缀，与 sourceViewSuffix 同一范式。
  'editor.sourceStagingSuffix': '（暂存区）',
  // S2b（外部数据表来源）：外部表来源 tag 的视觉区分后缀，与 sourceViewSuffix 同一范式。
  'editor.sourceExternalSuffix': '（外部表）',

  // 关联段
  'editor.joinTypeInner': '内联合',
  'editor.joinTypeLeft': '左联合',
  'editor.manualJoinTitle': '手动关联（同模板主+明细已自动按 record_id 关联）',
  'editor.deleteJoin': '删除',
  'editor.addJoinCondition': '＋ 关联条件',
  'editor.manualJoinHint': '如需跨表自定义关联，点下方新增',
  'editor.addManualJoin': '＋ 新增手动关联',
  'editor.leftField': '左字段',
  'editor.rightField': '右字段',
  // JoinSettingsPanel 分节标题/条件标签（{n} 由组件自行 replace，非 vue-i18n 插值语法）
  'editor.manualJoinSectionTitle': '手动关联{n}',
  'editor.joinConditionLabel': '关联条件',
  'editor.writeLeftJoinNotice': '左关联会让目标表中未匹配的记录也被写入（相关字段得空值）；只想改命中的记录请用内关联',

  // 条件段
  'editor.segCondition': '条件 · 组 where',
  'editor.modeGuided': '引导式',
  'editor.modeExpr': '表达式',
  'editor.wherePlaceholder': '点击编写筛选表达式（整段 WHERE，如 {主表.金额} > 100 AND …）',

  // 目标段
  'editor.segTarget': '目标与字段',
  'editor.selectTargetTable': '选择填充目标表',
  'editor.selectTargetTableFirst': '先选择填充目标表',
  'editor.targetExprPlaceholder': '点选此处→右侧抽屉选字段；或「ƒ」自由写表达式',
  // 目标多选控件分组标签（数据表 / 图表，404:22903 二轮）。
  'editor.targetGroupTables': '数据表',
  // Phase B（动作暂存区）：目标多选控件第三分组「暂存区」+ 其固定单选项标签 + 暂存 tab 短标签
  // （分组标签与选项标签当前文案相同，语义各自独立——分组标签强调"这是一类目标"，tab 标签是短标识）。
  'editor.targetGroupStaging': '暂存区（供下一步使用）',
  'editor.stagingTargetLabel': '暂存区',
  // StagingTargetSection：自由列编辑器（列名 input 占位符 / 新增列按钮 / 列名重复即时提示）。
  'editor.stagingColumnName': '列名',
  'editor.stagingAddColumn': '＋ 添加列',
  'editor.stagingRemoveColumn': '删除此列',
  'editor.stagingColumnDupe': '列名重复',
  // 按名称填充（404:22903 二轮 R5；V4 设置面改版更名，避免与「自动按行列匹配」开关混淆）：
  // 表 tab 头按钮 + 结果提示。注意 autoMatchDone 末尾、autoMatchDoneUnit 开头各带一个空格——
  // 两者与匹配数字直接字符串拼接，无插值分隔符。
  'editor.autoMatchFields': '按名称填充',
  // 清空规则：③目标 tabs 行右侧、每个表目标独立的「范围 × 时机」合成下拉。
  // 「取值前/取值后」的语义轴 = 被清数据是否参与查询参数。
  'editor.clearModeTitle': '清空方式：执行开始时清 Mirror 里对应位置的值（只清值不删行、公式格跳过）',
  'editor.clearModeNone': '无',
  'editor.clearModeMapped': '填充字段',
  'editor.clearModeAll': '整表',
  'editor.clearTimingTitle': '清除时机：取值前=先清再查（旧数据不参与查询条件）；取值后=参数取完后清空与查询并发',
  'editor.clearTimingBefore': '取值前',
  'editor.clearTimingAfter': '取值后',
  // 自动按行列匹配（V4 设置面归位：目标级开关，仅明细目标显示）。
  'editor.autoRowMatch': '自动按行列匹配',
  'editor.autoRowMatchTitle': '开启后从筛选条件自动提取匹配键；关闭后可在填充方式中手动选择「按行列匹配」',
  'editor.autoRowMatchV4Hint': '开启后，筛选条件里「来源字段 = 本报表明细字段」的等式在执行时自动作为该字段的按行列匹配键；等式仍作为筛选条件生效，你的配置不会被改写。关闭则不自动推导，改在填充方式里手动选「按行列匹配」',
  'editor.targetSettings': '设置',
  'editor.targetSettingsTitle': '本目标表的填充设置',
  'editor.targetSettingsGroupFill': '填充与清空',
  'editor.targetSettingsGroupQuery': '查询结果',
  'editor.clearModeLabel': '清空方式',
  'editor.clearTimingLabel': '清除时机',
  'editor.noticeErrors': '错误',
  'editor.noticeWarnings': '警告',
  'editor.noticeInfos': '提示',
  'editor.noticeDetails': '详情',
  'editor.noticeWhereSyntax': '语法检查',
  'editor.statusWarning': '有需注意的提示',
  'editor.trimEmptyRowsAfterFill': '执行后清理空行',
  'editor.trimEmptyRowsAfterFillTitle': '本次取数写回后，删除该表末尾连续的空行；至少保留 2 行。局部更新时不清理',
  'editor.targetDistinct': '排除重复',
  'editor.targetDistinctTitle': '本目标的查询结果去掉完全重复的行（按本目标各输出列判重）；每个填充目标独立设置，默认开启',
  'editor.targetTake': '仅限前 N 条',
  'editor.targetTakeTitle': '只取本目标查询结果的前 N 行；可用 −/＋ 步进或直接输入，清空为不限',
  'editor.takeUnlimited': '不限',
  // 合并分隔符。
  'editor.separatorTitle': '合并分隔符',
  'editor.attachmentTargetHint': '图片 / 附件字段：只能用图片 / 附件表达式填充',
  'editor.sepComma': '逗号 ,',
  'editor.sepSemicolon': '分号 ;',
  'editor.sepPeriod': '句点 .',
  'editor.sepSpace': '空格',
  'editor.sepPlus': '加号 +',
  'editor.sepSlash': '斜杠 /',
  'editor.sepNewline': '换行',
  'editor.autoMatchDone': '已匹配 ',
  'editor.autoMatchDoneUnit': ' 个字段',

  // 写目标
  // ①目标段段名（按操作，三选一；段头不再挂操作类型徽标——段名已含操作，见 ExpressionEditor.vue）。
  'editor.writeTargetSeg_insert': '新增目标',
  'editor.writeTargetSeg_update': '修改目标',
  'editor.writeTargetSeg_delete': '删除目标',
  // ④字段赋值段段名（原「写入目标」，目标选择器已挪到①段，本段只剩字段赋值）。
  'editor.writeFieldsSeg': '填充字段',
  // 自赋值兜底提示（用户 09-10 反馈：修改扩展表按名称填充成自赋值）：该行填充表达式的引用只有
  // 目标字段自己，不阻断保存/执行，只是提示"值不变"。
  'editor.writeSelfAssignmentHint': '该填充引用了目标字段自身，执行后值不变',
  // ②来源/④字段赋值/⊞快捷面板/树坞里「目标」分组的列头（目标模板配对表：隐含来源 + 引用即入源候选）。
  'editor.writeTargetGroupLabel': '目标',
  // 三操作统一：①段唯一的数据表选择器（复用原 insert 实现，不再有单独的来源别名选择）。
  'editor.pickWriteTarget': '选择写目标表',
  'editor.pickWriteTargetFirst': '请先在上方①段选择目标数据表',
  'editor.dedupe': '唯一键防重',
  'editor.dedupeHint': '按所选字段判重：目标表里已有相同记录或本次结果重复时跳过，不重复插入',
  'editor.dedupeScopeLabel': '判重范围',
  'editor.dedupeScopeAll': '全表',
  'editor.dedupeScopeParent': '同一父记录内',
  'editor.dedupeNoFilledFields': '请先在上方为字段填充表达式',

  // 填充策略
  'editor.strategyOverwrite': '覆盖',
  'editor.strategyAppend': '追加',
  'editor.strategyMerge': '合并',
  'editor.strategyRowMatch': '按行列匹配',

  // 排序
  'editor.sortNone': '不排序',
  'editor.sortAsc': '升序',
  'editor.sortDesc': '降序',
  'editor.nativeTextEqualityHint': '文本相等使用目标数据库及字段/表达式的原生规则；不同数据库的结果可能不同。',
  'editor.nativeTextSemanticsHint': '文本相等、去重和排序使用目标数据库及字段/表达式的原生规则；不同数据库的结果可能不同。',

  // 校验结果
  'editor.validationFailed': '校验未通过：',
  'editor.validationPassed': '校验通过：可编译为合法 SQL',
  'editor.validationFailedMsg': '校验未通过',
  'editor.syntaxCheckPending': '输入中',
  'editor.syntaxCheckChecking': '检查中',
  'editor.syntaxCheckValid': '✓ 正确',
  'editor.syntaxCheckInvalid': '✗ 错误',

  'operatorBar.operatorLabel': '运算符',
  'operatorBar.opLike': '包含',
  'operatorBar.opLikeStarts': '开头是',
  'operatorBar.opLikeEnds': '结尾是',
  'operatorBar.opNotLike': '不包含',
  'operatorBar.opIn': '属于',
  'operatorBar.opNotIn': '不属于',
  'operatorBar.fnSum': '求和',
  'operatorBar.fnCount': '计数',
  'operatorBar.fnAvg': '平均值',
  'operatorBar.fnMin': '最小值',
  'operatorBar.fnMax': '最大值',
  'operatorBar.fnConcat': '字符串拼接',
  'operatorBar.fnCoalesce': '空值择优',
  'operatorBar.fnRound': '四舍五入',
  'operatorBar.fnCase': '条件分支',
  'operatorBar.fnCountStar': '行数',
  'operatorBar.fnAbs': '绝对值',
  'operatorBar.fnCharindex': '查找位置',
  'operatorBar.fnDatediff': '日期差',
  'operatorBar.fnDateadd': '日期加',
  'operatorBar.fnYear': '年份',
  'operatorBar.fnMonth': '月份',
  'operatorBar.fnYearMonth': '年月',
  'operatorBar.fnYearMonthDay': '年月日',
  'operatorBar.fnMonthStart': '月初',
  'operatorBar.fnQuarterStart': '季初',
  'operatorBar.fnYearStart': '年初',
  'operatorBar.fnLen': '长度',
  'operatorBar.fnLeft': '左截取',
  'operatorBar.fnRight': '右截取',
  'operatorBar.fnReplace': '替换',
  'operatorBar.fnTrim': '去空格',
  // ── 本 wave（2026-09-02）：8 个标量函数 + 2 个规范构造（NULLIF/IIF）别名──
  'operatorBar.fnUpper': '大写',
  'operatorBar.fnLower': '小写',
  'operatorBar.fnLtrim': '左去空格',
  'operatorBar.fnRtrim': '右去空格',
  'operatorBar.fnSubstring': '截取',
  'operatorBar.fnFloor': '向下取整',
  'operatorBar.fnCeiling': '向上取整',
  'operatorBar.fnDay': '日',
  'operatorBar.fnNullif': '相等置空',
  'operatorBar.fnIif': '条件取值',
  // ── 2026-10-10：去重计数 + 周初──
  'operatorBar.fnCountDistinct': '去重计数',
  'operatorBar.fnWeekStart': '周初',
  'operatorBar.more': '更多',
  'operatorBar.moreFunctions': '更多函数',
  'operatorBar.categoryAggregate': '聚合',
  'operatorBar.categoryNumeric': '数值',
  'operatorBar.categoryText': '文本',
  'operatorBar.categoryDateTime': '日期时间',
  'operatorBar.categoryConditional': '条件',
  'operatorBar.fnDescSum': '对所选字段求和，忽略空值。用法：SUM(字段)',
  'operatorBar.fnDescCount': '统计行数。COUNT(字段) 只计非空值，COUNT(*) 计全部行。',
  'operatorBar.fnDescAvg': '求算术平均值，忽略空值。用法：AVG(字段)',
  'operatorBar.fnDescMin': '取最小值，数值、日期、文本均可比较。用法：MIN(字段)',
  'operatorBar.fnDescMax': '取最大值，数值、日期、文本均可比较。用法：MAX(字段)',
  'operatorBar.fnDescConcat': '把多个值按顺序拼成一个字符串。用法：CONCAT(值1, 值2, …)',
  'operatorBar.fnDescCoalesce': '返回第一个非空的值，常用于兜底默认值。用法：COALESCE(值1, 值2, …)',
  'operatorBar.fnDescRound': '四舍五入到指定小数位。用法：ROUND(数值, 位数)',
  'operatorBar.fnDescCase': '按条件分支取值，可写多个 WHEN。用法：CASE WHEN 条件 THEN 值 ELSE 兜底值 END',
  'operatorBar.fnDescCountStar': '统计全部行数（等价 COUNT(*)）。用法：行数()',
  'operatorBar.fnDescAbs': '取绝对值。用法：绝对值(数值)',
  'operatorBar.fnDescCharindex': '返回子串在文本中首次出现的位置（从 1 起，找不到为 0）。用法：查找位置(子串, 文本[, 起始位置])',
  'operatorBar.fnDescDatediff': '两个日期相差的部件数。用法：日期差(部件, 起始日期, 结束日期)，部件如 \'d\'/\'m\'/\'y\'',
  'operatorBar.fnDescDateadd': '日期加上若干部件。用法：日期加(部件, 数量, 日期)',
  'operatorBar.fnDescYear': '取日期的年份（整数）。用法：年份(日期)',
  'operatorBar.fnDescMonth': '取日期的月份（整数）。用法：月份(日期)',
  'operatorBar.fnDescYearMonth': '取日期的「年-月」文本（YYYY-MM）。用法：年月(日期)',
  'operatorBar.fnDescYearMonthDay': '把日期时间截断到日历日。用法：年月日(日期)',
  'operatorBar.fnDescMonthStart': '取日期所在月的第一天。用法：月初(日期)',
  'operatorBar.fnDescQuarterStart': '取日期所在季度的第一天。用法：季初(日期)',
  'operatorBar.fnDescYearStart': '取日期所在年的第一天。用法：年初(日期)',
  'operatorBar.fnDescLen': '返回文本的字符长度。用法：长度(文本)',
  'operatorBar.fnDescLeft': '从文本左侧截取指定个数的字符。用法：左截取(文本, 字符数)',
  'operatorBar.fnDescRight': '从文本右侧截取指定个数的字符。用法：右截取(文本, 字符数)',
  'operatorBar.fnDescReplace': '把文本中的子串全部替换为新文本。用法：替换(文本, 查找子串, 替换为)',
  'operatorBar.fnDescTrim': '去除文本首尾的空白字符。用法：去空格(文本)',
  'operatorBar.fnDescOver': '开窗函数：在分组内做累计或排名而不合并行。用法：聚合函数 OVER (PARTITION BY 分组字段 ORDER BY 排序字段)',
  'operatorBar.fnDescUpper': '把文本转换为大写。用法：大写(文本)',
  'operatorBar.fnDescLower': '把文本转换为小写。用法：小写(文本)',
  'operatorBar.fnDescLtrim': '去除文本左侧（开头）的空白字符。用法：左去空格(文本)',
  'operatorBar.fnDescRtrim': '去除文本右侧（末尾）的空白字符。用法：右去空格(文本)',
  'operatorBar.fnDescSubstring': '从指定位置截取指定长度的子串（位置从 1 起）。用法：截取(文本, 起始位置, 长度)',
  'operatorBar.fnDescFloor': '向下取整到不超过原值的最大整数。用法：向下取整(数值)',
  'operatorBar.fnDescCeiling': '向上取整到不小于原值的最小整数。用法：向上取整(数值)',
  'operatorBar.fnDescDay': '取日期的日（当月第几天，整数）。用法：日(日期)',
  'operatorBar.fnDescNullif': '两值相等时返回空值，否则返回第一个值。用法：相等置空(值1, 值2)',
  'operatorBar.fnDescIif': '按条件返回两个值之一。用法：条件取值(条件, 真值, 假值)',
  'operatorBar.fnDescCountDistinct': '统计不重复的非空值个数（重复值只计一次，空值不计）。用法：去重计数(字段)',
  'operatorBar.fnDescWeekStart': '取日期所在周的周一（一周从周一开始）。用法：周初(日期)',

  // 这一 key 仍由 OperatorFunctionBar 与 FieldTreeDock 消费。
  'adv.functions': '函数',

  // ── ConditionTree ─────────────────────────────────────────────────────────
  'cond.and': '并且',
  'cond.or': '或者',
  'cond.negate': '不满足',
  'cond.addCondition': '＋ 条件',
  // 条件组范式改版：「括号组」改「条件组」——语义仍是"新增子组"，用词贴近新组头文案（"…条件"）。
  'cond.addGroup': '＋ 条件组',
  'cond.remove': '删',
  'cond.deleteGroup': '删除组',
  // 组头（条件组范式，负责声明本组语义）：拼成「[满足|不满足] 以下 [全部|任一] 条件」。
  // qb.conditionGroupAll/Any 是只读区整句文案（含标点、不可拆），组头是可交互下拉需要独立的原子词，
  // 故新增而非复用；两处文案在"满足/全部"等措辞上保持同源，只是编辑态拆成了可选中的碎片。
  'cond.groupSatisfy': '满足',
  'cond.groupNotSatisfy': '不满足',
  'cond.groupPrefix': '以下',
  'cond.groupAll': '全部',
  'cond.groupAny': '任一',
  'cond.groupSuffix': '条件',
  // E10：区间比较算子对，语义与 SQL BETWEEN/NOT BETWEEN 一致（闭区间，两端都含）。
  'cond.opBetween': '介于',
  'cond.opNotBetween': '不介于',
  // between/not_between 两个右值输入框之间的连接词，如「100 和 200」。
  'cond.betweenAnd': '和',
  'cond.opLike': '形如',
  // E11：切到「形如」时右值默认预填前后通配 %文本%，本提示告知用户可手动删一侧改前缀/后缀匹配。
  'cond.likePatternHint': '默认前后通配（%文本%），可删除一侧 % 改为前缀/后缀匹配',
  'cond.opIn': '属于',
  'cond.opNotIn': '不属于',
  // K1：判空算子（无右值）。
  'cond.opIsNull': '为空',
  'cond.opIsNotNull': '不为空',
  'cond.emptyGroup': '空组（无条件）',
  'cond.leftValue': '左值',
  'cond.rightValue': '右值',
  // K9-d：参数类引用（系统变量 / 本报表主表字段）被动提示，{name} 用字段/变量显示名插值。
  'cond.paramHintAlwaysFalse': '{name}未填时此条件恒不成立',
  'cond.paramHintNoEffect': '{name}未填时此条件不生效',

  // ── ExpressionInput ───────────────────────────────────────────────────────
  'input.clickToWriteExpr': '点击编写表达式',
  'input.clickToSelectField': '点击后从右侧抽屉选择字段 / 变量',

  // ── QuickFieldPicker（⊞ 快捷选择，值单元格三入口之一）──────────────────────
  // 头部「插入到 <字段名/槽位标题>」前缀；包内 t() 不做参数插值，标题片段由组件自行拼接（同
  // dialog.syntaxHintJump 一类处理先例）。「变量」组标题复用既有 drawer.tabVars，不新增。
  'quickPick.insertInto': '插入到',

  // ── FieldTreeDock────────────
  'editor.dockVarsColumn': '变量与函数',
  // 树坞「本报表」列（当前单据自身取值）列头后缀：与来源列的「（本模板）」区分，来源恰为本模板时不再出现两个同名列头。
  'editor.dockReportColumnSuffix': '（本报表）',
  'editor.dockSourceTemplateColumnSuffix': '（来源模板）',
  'editor.dockExpandCard': '展开卡片',
  'editor.dockCollapseCard': '收起卡片',
  'editor.dockSplitHandle': '拖拽调整树坞高度（双击复位）',
  'editor.dockNoMatch': '无匹配',

  // ── FieldDrawer ───────────────────────────────────────────────────────────
  'drawer.searchPlaceholder': '搜索字段 / 变量 / 函数',
  'drawer.tabSource': '来源表',
  'drawer.noSourceFields': '无来源表字段',
  // views-extraction-b3 R3：旧宿主桥无 getViewSchema 时视图分组的降级提示。
  'drawer.viewFieldsUnsupported': '当前宿主不支持视图字段目录',
  // Phase B（动作暂存区）：暂存来源但当前画布拓扑取不到「上一步暂存区」列时的字段面板降级提示。
  'drawer.stagingUnsupported': '上一步未产出暂存区',
  // S2b（外部数据表来源）：旧宿主桥无 getExternalSchema 时外部表分组的降级提示。
  'drawer.externalFieldsUnsupported': '当前宿主不支持读取外部表字段',
  'drawer.fieldTypeUnsupported': '暂不支持',
  'drawer.tabForm': '本报表',
  'drawer.noFields': '无字段',
  'drawer.tabVars': '变量',

  // ── AdvancedExpressionDialog ──────────────────────────────────────────────
  'dialog.title': '表达式编辑器',
  'dialog.exprHint': '字段/变量从上方树中点选插入（改字段名自动同步）；确认时由服务端解析为结构化条件，不支持注释与子查询。判空请写「为 空值」/ IS NULL（写成 = 空值 恒不成立）。',
  'dialog.unresolvedField': '无法识别字段标记：',
  'dialog.pleaseSelectFromDrawer': '请从右侧选择插入字段',
  'dialog.openWindow': '开窗 OVER',
  'dialog.syntaxTyping': '输入中',
  'dialog.syntaxChecking': '检查中',
  'dialog.syntaxOk': '语法正确',
  'dialog.syntaxHintJump': '点击定位到出错位置',
  'dialog.syntaxErr.unclosedParen': '有括号未闭合',
  'dialog.syntaxErr.unexpectedParen': '多余的右括号',
  'dialog.syntaxErr.unclosedToken': '字段标记未闭合',
  'dialog.syntaxErr.emptyToken': '空的字段标记',
  'dialog.syntaxErr.unknownField': '字段不在可用目录中',
  'dialog.syntaxErr.danglingOperator': '运算符缺少操作数',
  'dialog.discardTitle': '放弃修改？',
  'dialog.discardContent': '表达式已修改，关闭将丢失这些改动。',
  'dialog.maximize': '最大化',
  'dialog.restore': '还原',
  'dialog.textModeUnavailable': '当前宿主不支持文本模式（未实现表达式解析接口），请改用引导式或更新插件后重试',
  'dialog.lowerFailed': '表达式解析失败',
  // 2026-08-30 修正：后端 textmodel.toLike（baf29f7ef）已把文本模式
  // LIKE 从"两侧自动补通配"改为"右值原样作 pattern"（LikeMode=pattern，不再缺省包 %…%），本提示此前
  // 描述的是旧行为，随之修正为准确描述——不再声称自动补通配，改为教用户自己写 %。
  'dialog.textModeLikeHint': '「包含」（匹配 / LIKE）按 pattern 语义执行：右值原样作匹配模式，不自动补通配；如需"包含"效果请自行写 匹配 \'%abc%\'（只写 匹配 \'abc\' 是精确匹配 abc）。',

  // ── 目标表区（旧 key 保留兼容）─────────────────────────────────────────────
  'target.selectTable': '选择填充目标表',
  'target.noMapped': '（无映射字段）',

  // ── 分组展示预置词条（K9-d 附带登记，暂不接线 UI；非 cond.* 命名是任务方指定的固定 key） ──────
  'group-blank-label': '(空白)',

  // ── 填充到图表──────────────────────────
  'chart_target.section_title': '填充到图表',
  'chart_target.add': '＋ 添加图表目标',
  'chart_target.add_series': '＋ 添加系列',
  'chart_target.chart': '图表',
  'chart_target.layout': '组织方式',
  'chart_target.layout_long': '动态系列',
  'chart_target.layout_long_hint': '由一个字段的取值自动分出多条，有几条取决于数据',
  'chart_target.layout_wide': '固定系列',
  'chart_target.layout_wide_hint': '自己一条条加，每条起个名、写一条表达式',
  'chart_target.slot_category': '类目',
  'chart_target.slot_series': '系列',
  'chart_target.slot_value': '值',
  'chart_target.slot_name': '名称',
  'chart_target.slot_x': 'X',
  'chart_target.slot_y': 'Y',
  'chart_target.series_name_placeholder': '系列显示名',
  'chart_target.series_optional_placeholder': '不填＝只有一条数据线，图上不显示系列',
  'chart_target.warn_deleted': '图表已删除',
  'chart_target.warn_form_changed': '图表类型已变更，请重新映射',
  'chart_target.warn_not_pushed': '该图表不是取数填充模式',
  'chart_target.empty_catalog': '未检测到图表',
  'chart_target.remove': '移除',
  'chart_target.untitled': '未命名图表',

  // ── qb.*（数据流左右分栏改版：左栏①②面板/条件编辑弹窗/表关联设计器新增文案）─────────────
  'qb.sourcePanelTitle': '来源表',
  'qb.conditionPanelTitle': '筛选条件',
  // 已弃用：ConditionReadonlyView.vue 组头文案改走 cond.groupSatisfy/NotSatisfy +
  // groupPrefix + groupAll/Any + groupSuffix 原子词拼接（含 negate，见该组件 groupLabel 实现），
  // 本整句不再被引用；保留不删（四语言 key 集合测试敏感），供未来若需恢复"不含 negate 一体化短句"复用。
  'qb.conditionGroupAll': '满足以下全部条件：',
  'qb.conditionGroupAny': '满足以下任一条件：',
  'qb.conditionEmptyHint': '点击设置筛选条件 · 不设＝取全部行',
  'editor.havingSection': '分组后筛选',
  'editor.havingConstOnlyHint': '分组后筛选的右值目前只支持常量',
  'qb.conditionEditorTitle': '筛选条件',
  'qb.joinLinked': '已关联',
  'qb.joinUnlinked': '未关联',
  'qb.joinDesignerTitle': '表关联设计器',
  'qb.joinPendingTitle': '以下来源需要手动配置关联，否则无法定位数据：',

  // ── errMsg.*（F3：校验错误信息本地化，见 errorMessages.ts 映射来源说明）─────────────────
  // {n0}/{n1} 占位符由 errorMessages.ts 按正则捕获组顺序手动 replace（包内 t() 不做参数插值）。
  'errMsg.fillTargetMissingTable': '第 {n0} 个填充目标缺少目标表',
  'errMsg.fillTargetMissingField': '第 {n0} 个填充目标的第 {n1} 项映射缺少目标字段',
  'errMsg.fillTargetTemplateMismatch': '第 {n0} 个填充目标所属模板与当前模板不一致，无权写入',
  'errMsg.fillTargetResolveTable': '第 {n0} 个填充目标的目标表无法解析（可能已被删除或无权限）',
  'errMsg.fillTargetResolveField': '第 {n0} 个填充目标的目标字段无法解析（可能已被删除或无权限）',
  'errMsg.unknownSourceAlias': '引用了未声明的来源表别名',
  'errMsg.forbiddenSourceTable': '无权读取来源表',
  'errMsg.forbiddenSourceApp': '权限不足，不能编辑：该取数配置引用了你没有设计权限的应用',
  'errMsg.expressionPreviewStructureInvalid': '表达式结构校验未通过：{n0}',
  'errMsg.expressionPreviewReferenceNotFound': '表达式引用校验未通过：{n0}',
  'errMsg.forbiddenField': '无权读取该字段',
  'errMsg.joinUnknownAlias': '第 {n0} 条表关联引用了未知别名',
  'errMsg.unknownAliasInJoin': '引用了未知的来源表别名',
  'errMsg.aggregateArgCount': '聚合函数 {n0} 需要且只能有 1 个参数',
  'errMsg.unsupportedFunction': '不支持的函数：{n0}',
  'errMsg.fieldTokenMismatch': '字段标记数量与实际引用的字段数量不一致，请勿手写花括号标记',
  'errMsg.dataScopeMultiTableRejected': '来源表存在数据域限制，当前多表表达式暂不支持，已拒绝执行',
  'errMsg.aggregateFillOutputUnsupported': '填充取值里的聚合函数用法超出了当前支持范围：目前支持对来源数据（可先用筛选条件过滤）做 SUM/COUNT/AVG/MIN/MAX 后填入字段——该填充目标的取值要么全部是聚合（可另配常量），要么聚合与直接取列混用、按直接取的列自动分组（此时匹配条件的来源须是这些列）。匹配条件的来源取值本身不能用聚合函数。更复杂的分组汇总请改用图表目标。',
  'errMsg.matchKeyTypeIncompatible': '匹配条件两侧字段类型不相容，请选择同类型字段',
  'errMsg.fillStrategyTypeUnsupported': '该字段类型不支持追加或合并填充，请改用覆盖',
  'errMsg.writeWhereRequired': '修改/删除必须配置定位条件',
  'errMsg.havingRequiresGroupBy': '分组后筛选需要先配置分组字段',
  'errMsg.havingUnsupported': '分组后筛选的条件引擎无法承接，请改用常量右值或简化条件',
  'errMsg.havingRightOperandNonConst': '分组后筛选的条件只支持常量右值，请改用固定数值/文本',
  'errMsg.automaticRowMatchMultiSourceInvalid': '多来源表下无法自动确定匹配的表，请改用单来源表或手动配置匹配条件',
  'errMsg.autoRecordIDShapeInvalid': '自动关联只支持「主表 ⋈ 同一模板的明细表」且为内连接，请检查两表角色或改用手动关联条件',

  'errMsg.writeTargetCannotBeView': '写目标不能是视图来源：视图不支持写入（新增/修改/删除），请改选数据表作为写目标',

  // ── fieldMultiPick.* ──────────
  // 「暂不支持」复用既有 drawer.fieldTypeUnsupported；取消/删除复用 common.cancel/common.delete；
  // 最大化/还原复用 dialog.maximize/dialog.restore；空态复用 editor.dockNoMatch/picker.selectHint。
  'fieldMultiPick.title': '批量添加列',
  'fieldMultiPick.searchPlaceholder': '搜索字段',
  'fieldMultiPick.selectAll': '全选',
  'fieldMultiPick.deselectAll': '取消全选',
  'fieldMultiPick.added': '已添加',
  // 「将添加 N 列」拼接：包内 t() 不做参数插值（同 picker.selected/picker.confirm 先例），
  // 前后两段各自本地化，中间由组件插入数字。
  'fieldMultiPick.willAddPrefix': '将添加 ',
  'fieldMultiPick.willAddUnit': ' 列',
  'fieldMultiPick.columnNameHint': '列名取字段名，添加后可改',
  'fieldMultiPick.confirmPrefix': '添加 ',
  'fieldMultiPick.confirmUnit': ' 列',

  // ── v4.*（表达式引擎(表达式引擎) V4 引擎 demo 编辑面，src/v4/）─────────────────────────
  'v4.tabStaging': '暂存表',
  'v4.stagingEmpty': '暂无暂存列',
  'v4.diagnosticsTitle': '诊断信息',
  'v4.diagnosticsEmpty': '暂无诊断信息',
  'v4.diagnosing': '检查中…',
  'v4.textareaPlaceholder': '例如：[t1].[金额] > 100',
  'v4.operatorsLabel': '运算符',
  'v4.keywordsLabel': '关键字',
  'v4.functionCategory.aggregate': '聚合',
  'v4.functionCategory.scalar': '标量',
  'v4.functionCategory.construct': '构造函数'
} as const;
