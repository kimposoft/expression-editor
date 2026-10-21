/**
 * Expression editor English localization strings.
 * Components prefer ExpressionHost.t(), falling back to this table.
 */
export default {
  // ── Common ─────────────────────────────────────────────────────────────────
  'common.noResponse': 'No response',
  'common.requestFailed': 'Request failed',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.loading': 'Loading...',
  'common.delete': 'Delete',
  'common.none': '(none)',
  // Null-value quick option: new item in ConditionTree.vue's
  // condition value ⊞ quick pick + the dedicated caption ExpressionInput.vue/ConditionReadonlyView.vue
  // render for kind='const'+value=null.
  'common.nullValue': 'Null value',
  // ── M4 rework: trailing hardcoded strings ──
  'editor.previewFailed': 'Validation failed',
  'editor.joinLabel': 'Table joins',

  // ── SourceTreePicker ───────────────────────────────────────────────────────
  'picker.addSource': '＋ Add Source',
  'picker.title': 'Add Source (select to data-table level, duplicates allowed)',
  'picker.titleSingle': 'Select data table (single choice, re-selecting replaces it)',
  'picker.noTemplates': 'No templates',
  'picker.currentTemplate': '(current)',
  'picker.ungrouped': 'Ungrouped',
  'picker.currentApp': ' (current app)',
  'picker.thisApp': 'Current app',
  'picker.mainTable': 'Main table',
  'picker.detailTable': 'Detail table',
  'picker.selected': 'Selected (',
  'picker.selectHint': 'Click a data table on the left; same table can be added multiple times',
  'picker.selectHintSingle': 'Click a data table on the left to select it; picking another replaces the current choice',
  // 2026-07-25 restyle addition: "Clear" button in the selected-panel header (node 369:18348).
  'picker.clear': 'Clear',
  'picker.confirm': 'Confirm (',
  // views-frontend-b2 R7: view leaves (when selectableKinds includes 'view').
  'picker.viewGeneric': 'View',
  'picker.viewSelfRefDisabled': 'Cannot select itself (would form a cycle)',
  'picker.viewRegular': 'Regular view',
  'picker.viewCombined': 'Combined view',
  'picker.columnCountUnit': ' cols',
  // User decision 2026-09-10: hover hint for the write-mode ② source picker disabling write-target
  // related tables (the target table itself and its paired main/extension table).
  'picker.disabledWriteTarget': 'Already the write target for this action',
  // Phase B (action staging area): generic label for the pinned virtual leaf at the top of the tree
  // (title hint; the visible label text uses the specific producerLabel).
  'picker.stagingSource': 'Previous-step staging area',
  // Degradation hint when a persisted staging source table can't resolve the "previous-step staging
  // area" under the current canvas topology (e.g. the upstream node was deleted).
  'picker.stagingNoProducer': 'Previous step produced no staging area',
  // ── 编辑区引用补全分组 ──
  'completion.sourceGroup': 'Source',
  'completion.reportGroup': 'This report',
  'completion.variableGroup': 'System variable',
  'picker.externalGeneric': 'External',

  // ── ExpressionEditor ──────────────────────────────────────────────────────
  'editor.loadFieldsFailed': 'Failed to load field catalog',
  'editor.previewValid': 'Validation passed: compilable to valid SQL',
  'editor.previewInvalid': 'Validation failed',
  'editor.noResponse': 'No response',
  'editor.drawerTitle': 'Field drawer',
  // aria-label for the field drawer collapse/expand toggle button (404:22903 round 2).
  'editor.drawerCollapse': 'Collapse field drawer',
  'editor.drawerExpand': 'Expand field drawer',

  // Source segment
  'editor.segSource': 'Source · group from',
  'editor.addSourceEmpty': 'Click "Add Source" to select other data tables',
  'editor.addSourceEmptyNoImplicit': 'Click "Add Source" to pick the first source table',
  'editor.templateLabel': 'Template: ',
  'editor.fieldCountSuffix': ' fields',
  // views-extraction-b3 R2: visual suffix for view-source tags (no new icon system).
  'editor.sourceViewSuffix': ' (View)',
  // Phase B (action staging area): visual suffix for staging-source tags, same pattern as sourceViewSuffix.
  'editor.sourceStagingSuffix': ' (Staging)',
  // S2b (external data table source): visual suffix for external-source tags, same pattern as sourceViewSuffix.
  'editor.sourceExternalSuffix': ' (External)',

  // Join segment
  'editor.joinTypeInner': 'Inner join',
  'editor.joinTypeLeft': 'Left join',
  'editor.manualJoinTitle': 'Manual join (same-template main+detail already auto-joined by record_id)',
  'editor.deleteJoin': 'Delete',
  'editor.addJoinCondition': '＋ Add condition',
  'editor.manualJoinHint': 'Add manual join below for cross-table custom relations',
  'editor.addManualJoin': '＋ Add manual join',
  'editor.leftField': 'Left field',
  'editor.rightField': 'Right field',
  // JoinSettingsPanel section title / condition label ({n} is replaced by the component itself, not vue-i18n interpolation)
  'editor.manualJoinSectionTitle': 'Manual join {n}',
  'editor.joinConditionLabel': 'Join condition',
  'editor.writeLeftJoinNotice':
    'A left join lets unmatched rows in the target table get written too (with those fields set to null); use an inner join if you only want to affect matched rows',

  // Condition segment
  'editor.segCondition': 'Condition · group where',
  'editor.modeGuided': 'Guided',
  'editor.modeExpr': 'Expression',
  'editor.wherePlaceholder': 'Click to write filter expression (full WHERE, e.g. {main.amount} > 100 AND …)',

  // Target segment
  'editor.segTarget': 'Target & fields',
  'editor.selectTargetTable': 'Select fill target table',
  'editor.selectTargetTableFirst': 'Select a fill target table first',
  'editor.targetExprPlaceholder': 'Click here → select field from drawer; or use "ƒ" to write freely',
  // Group label for the target multi-select (data tables / charts, 404:22903 round 2).
  'editor.targetGroupTables': 'Data tables',
  // Phase B (action staging area): third target multi-select group "Staging area" + its fixed single
  // option label + the staging tab's short label (group label emphasizes "a kind of target"; the tab
  // label is a short identifier — text happens to match today but the two keys are semantically distinct).
  'editor.targetGroupStaging': 'Staging area (for the next step)',
  'editor.stagingTargetLabel': 'Staging area',
  // StagingTargetSection: free-form column editor (column-name input placeholder / add-column button /
  // duplicate-name inline hint).
  'editor.stagingColumnName': 'Column name',
  'editor.stagingAddColumn': '+ Add column',
  'editor.stagingRemoveColumn': 'Remove this column',
  'editor.stagingColumnDupe': 'Duplicate column name',
  // Auto-match (404:22903 round 2 R5): table-tab header button + result message. Note the trailing
  // space on autoMatchDone and leading space on autoMatchDoneUnit — both are string-concatenated
  // directly with the matched count, with no separator.
  'editor.autoMatchFields': 'Fill by name',
  // Clear rule: per-target "scope × timing" select on the
  // right of the target tabs row. "Before pickup" = cleared data is excluded from query parameters.
  'editor.clearModeTitle': 'Clear mode: values at the target positions are cleared in the Mirror when execution starts (values only, rows kept, formula cells skipped)',
  'editor.clearModeNone': 'None',
  'editor.clearModeMapped': 'Filled fields',
  'editor.clearModeAll': 'Whole table',
  'editor.clearTimingTitle': 'Clear timing: before pickup = clear, then query (old data excluded from conditions); after pickup = clear runs concurrently with the query once parameters are captured',
  'editor.clearTimingBefore': 'Before pickup',
  'editor.clearTimingAfter': 'After pickup',
  // Auto row match (V4 settings relocation: per-target switch, detail targets only).
  'editor.autoRowMatch': 'Auto row match',
  'editor.autoRowMatchTitle': 'On: match keys are extracted from the filter conditions automatically; off: pick "Row match" manually in fill strategy',
  'editor.autoRowMatchV4Hint': 'When on, equalities \"source field = current-form detail field\" in the filter act as that field\'s row-column match keys at run time; the equality still filters and your configuration is never rewritten. When off, nothing is derived and you pick \"Row-column match\" manually in the fill strategy instead',
  'editor.targetSettings': 'Settings',
  'editor.targetSettingsTitle': 'Fill settings for this target table',
  'editor.targetSettingsGroupFill': 'Fill & clear',
  'editor.targetSettingsGroupQuery': 'Query result',
  'editor.clearModeLabel': 'Clear mode',
  'editor.clearTimingLabel': 'Clear timing',
  'editor.noticeErrors': 'Errors',
  'editor.noticeWarnings': 'Warnings',
  'editor.noticeInfos': 'Notes',
  'editor.noticeDetails': 'Details',
  'editor.noticeWhereSyntax': 'Syntax check',
  'editor.statusWarning': 'Needs attention',
  'editor.trimEmptyRowsAfterFill': 'Trim empty rows after fill',
  'editor.trimEmptyRowsAfterFillTitle': 'After this extraction writes back, delete the trailing empty rows of this table; at least 2 rows are kept. Skipped on partial updates',
  'editor.targetDistinct': 'Distinct rows',
  'editor.targetDistinctTitle': 'Drop fully duplicated rows from this target\'s result (compared on this target\'s output columns); set per fill target, on by default',
  'editor.targetTake': 'First N rows only',
  'editor.targetTakeTitle': 'Take only the first N rows of this target\'s result; use −/＋ or type a number, clear for no limit',
  'editor.takeUnlimited': 'No limit',
  // Merge separator.
  'editor.separatorTitle': 'Merge separator',
  'editor.attachmentTargetHint': 'Image / attachment field: can only be filled with an image / attachment expression',
  'editor.sepComma': 'Comma ,',
  'editor.sepSemicolon': 'Semicolon ;',
  'editor.sepPeriod': 'Period .',
  'editor.sepSpace': 'Space',
  'editor.sepPlus': 'Plus +',
  'editor.sepSlash': 'Slash /',
  'editor.sepNewline': 'Newline',
  'editor.autoMatchDone': 'Matched ',
  'editor.autoMatchDoneUnit': ' field(s)',

  'editor.writeTargetSeg_insert': 'Insert target',
  'editor.writeTargetSeg_update': 'Update target',
  'editor.writeTargetSeg_delete': 'Delete target',
  // ④ field-assignment segment title (was "Write target"; the target picker moved to segment ①,
  // so this segment now only holds field assignments).
  'editor.writeFieldsSeg': 'Fill fields',
  // Self-assignment fallback hint (user feedback 09-10: fill-by-name on an extension table's update
  // target produced a self-assignment): this row's fill expression only references the target field
  // itself — does not block save/execution, just flags that the value never changes.
  'editor.writeSelfAssignmentHint': 'This fill expression references the target field itself — the value will not change after execution',
  // Header for the "Target" group in ② sources / ④ field assignments / the ⊞ quick picker / dock.
  'editor.writeTargetGroupLabel': 'Target',
  // All three operations share one data-table selector in segment ① (reusing the former insert
  // picker); there is no longer a separate "pick from source alias" flow.
  'editor.pickWriteTarget': 'Select write target table',
  'editor.pickWriteTargetFirst': 'Select a target data table in segment ① above first',
  'editor.dedupe': 'Unique-key de-dup',
  'editor.dedupeHint': 'Match by the selected fields: skip the insert when the target table already has a matching record, or the result set has a duplicate',
  'editor.dedupeScopeLabel': 'Match scope',
  'editor.dedupeScopeAll': 'Whole table',
  'editor.dedupeScopeParent': 'Within same parent',
  'editor.dedupeNoFilledFields': 'Fill in an expression for a field above first',

  // Fill strategy
  'editor.strategyOverwrite': 'Overwrite',
  'editor.strategyAppend': 'Append',
  'editor.strategyMerge': 'Merge',
  'editor.strategyRowMatch': 'Row-column match',

  // Sort
  'editor.sortNone': 'No sort',
  'editor.sortAsc': 'Ascending',
  'editor.sortDesc': 'Descending',
  'editor.nativeTextEqualityHint': 'Text equality uses the native rules of the target database and column/expression; results may differ across databases.',
  'editor.nativeTextSemanticsHint': 'Text equality, deduplication, and ordering use the native rules of the target database and column/expression; results may differ across databases.',

  // Validation
  'editor.validationFailed': 'Validation failed: ',
  'editor.validationPassed': 'Validation passed: compilable to valid SQL',
  'editor.validationFailedMsg': 'Validation failed',
  'editor.syntaxCheckPending': 'Typing',
  'editor.syntaxCheckChecking': 'Checking',
  'editor.syntaxCheckValid': '✓ Valid',
  'editor.syntaxCheckInvalid': '✗ Error',

  // ── OperatorFunctionBar (operator/function quick-insert bar, generic component extracted at 369:18577) ──
  // 2026-09-08 decision: arithmetic and logical rows merged into a single "Operators" row.
  'operatorBar.operatorLabel': 'Operators',
  'operatorBar.opLike': 'Contains',
  'operatorBar.opLikeStarts': 'Starts with',
  'operatorBar.opLikeEnds': 'Ends with',
  'operatorBar.opNotLike': 'Not contains',
  'operatorBar.opIn': 'IN',
  'operatorBar.opNotIn': 'NOT IN',
  'operatorBar.fnSum': 'Sum',
  'operatorBar.fnCount': 'Count',
  'operatorBar.fnAvg': 'Average',
  'operatorBar.fnMin': 'Min',
  'operatorBar.fnMax': 'Max',
  'operatorBar.fnConcat': 'Concatenate',
  'operatorBar.fnCoalesce': 'Coalesce',
  'operatorBar.fnRound': 'Round',
  'operatorBar.fnCase': 'Conditional branch (CASE)',
  'operatorBar.fnCountStar': 'Row count',
  'operatorBar.fnAbs': 'Absolute value',
  'operatorBar.fnCharindex': 'Find position',
  'operatorBar.fnDatediff': 'Date difference',
  'operatorBar.fnDateadd': 'Date add',
  'operatorBar.fnYear': 'Year',
  'operatorBar.fnMonth': 'Month',
  'operatorBar.fnYearMonth': 'Year-month',
  'operatorBar.fnYearMonthDay': 'Calendar day',
  'operatorBar.fnMonthStart': 'Month start',
  'operatorBar.fnQuarterStart': 'Quarter start',
  'operatorBar.fnYearStart': 'Year start',
  'operatorBar.fnLen': 'Length',
  'operatorBar.fnLeft': 'Left characters',
  'operatorBar.fnRight': 'Right characters',
  'operatorBar.fnReplace': 'Replace text',
  'operatorBar.fnTrim': 'Trim spaces',
  // ── This wave (2026-09-02): 8 scalar functions + 2 canonical constructs (NULLIF/IIF) aliases ──
  'operatorBar.fnUpper': 'Uppercase',
  'operatorBar.fnLower': 'Lowercase',
  'operatorBar.fnLtrim': 'Left trim',
  'operatorBar.fnRtrim': 'Right trim',
  'operatorBar.fnSubstring': 'Substring',
  'operatorBar.fnFloor': 'Floor',
  'operatorBar.fnCeiling': 'Ceiling',
  'operatorBar.fnDay': 'Day',
  'operatorBar.fnNullif': 'Null if equal (NULLIF)',
  'operatorBar.fnIif': 'Conditional value (IIF)',
  // ── 2026-10-10: distinct count + week start ──
  'operatorBar.fnCountDistinct': 'Distinct count',
  'operatorBar.fnWeekStart': 'Week start',
  'operatorBar.fnDescSum': 'Sums the selected field, ignoring nulls. Usage: SUM(field)',
  'operatorBar.fnDescCount': 'Counts rows. COUNT(field) counts non-null values; COUNT(*) counts all rows.',
  'operatorBar.fnDescAvg': 'Arithmetic mean, ignoring nulls. Usage: AVG(field)',
  'operatorBar.fnDescMin': 'Smallest value; works for numbers, dates and text. Usage: MIN(field)',
  'operatorBar.fnDescMax': 'Largest value; works for numbers, dates and text. Usage: MAX(field)',
  'operatorBar.fnDescConcat': 'Joins several values into one string, in order. Usage: CONCAT(v1, v2, …)',
  'operatorBar.fnDescCoalesce': 'Returns the first non-null value — handy for fallbacks. Usage: COALESCE(v1, v2, …)',
  'operatorBar.fnDescRound': 'Rounds to the given number of decimal places. Usage: ROUND(number, digits)',
  'operatorBar.fnDescCase': 'Branches by condition; multiple WHENs allowed. Usage: CASE WHEN cond THEN value ELSE fallback END',
  'operatorBar.fnDescCountStar': 'Counts all rows (same as COUNT(*)). Usage: ROW_COUNT()',
  'operatorBar.fnDescAbs': 'Absolute value. Usage: ABS(number)',
  'operatorBar.fnDescCharindex': 'Position of the first occurrence of a substring (1-based, 0 if absent). Usage: CHARINDEX(substring, text[, start])',
  'operatorBar.fnDescDatediff': 'Number of date parts between two dates. Usage: DATEDIFF(part, start, end), part such as \'d\'/\'m\'/\'y\'',
  'operatorBar.fnDescDateadd': 'Adds date parts to a date. Usage: DATEADD(part, count, date)',
  'operatorBar.fnDescYear': 'Year of a date as an integer. Usage: YEAR(date)',
  'operatorBar.fnDescMonth': 'Month of a date as an integer. Usage: MONTH(date)',
  'operatorBar.fnDescYearMonth': 'Year-month text (YYYY-MM) of a date. Usage: YEAR_MONTH(date)',
  'operatorBar.fnDescYearMonthDay': 'Truncates a datetime to its calendar day. Usage: YEAR_MONTH_DAY(date)',
  'operatorBar.fnDescMonthStart': 'First day of the month of a date. Usage: MONTH_START(date)',
  'operatorBar.fnDescQuarterStart': 'First day of the quarter of a date. Usage: QUARTER_START(date)',
  'operatorBar.fnDescYearStart': 'First day of the year of a date. Usage: YEAR_START(date)',
  'operatorBar.fnDescLen': 'Character length of a text value. Usage: LEN(text)',
  'operatorBar.fnDescLeft': 'Extracts the given number of characters from the left of a text value. Usage: LEFT(text, count)',
  'operatorBar.fnDescRight': 'Extracts the given number of characters from the right of a text value. Usage: RIGHT(text, count)',
  'operatorBar.fnDescReplace': 'Replaces every occurrence of a substring within a text value. Usage: REPLACE(text, search, replacement)',
  'operatorBar.fnDescTrim': 'Removes leading and trailing whitespace from a text value. Usage: TRIM(text)',
  'operatorBar.fnDescOver': 'Window function: running totals or ranking within a partition, without collapsing rows. Usage: agg OVER (PARTITION BY field ORDER BY field)',
  'operatorBar.fnDescUpper': 'Converts text to uppercase. Usage: UPPER(text)',
  'operatorBar.fnDescLower': 'Converts text to lowercase. Usage: LOWER(text)',
  'operatorBar.fnDescLtrim': 'Removes leading whitespace from a text value. Usage: LTRIM(text)',
  'operatorBar.fnDescRtrim': 'Removes trailing whitespace from a text value. Usage: RTRIM(text)',
  'operatorBar.fnDescSubstring': 'Extracts a substring starting at a position for a given length (1-based). Usage: SUBSTRING(text, start, length)',
  'operatorBar.fnDescFloor': 'Rounds down to the largest integer not greater than the value. Usage: FLOOR(number)',
  'operatorBar.fnDescCeiling': 'Rounds up to the smallest integer not less than the value. Usage: CEILING(number)',
  'operatorBar.fnDescDay': 'Day of month of a date, as an integer. Usage: DAY(date)',
  'operatorBar.fnDescNullif': 'Returns null if the two values are equal, otherwise returns the first value. Usage: NULLIF(v1, v2)',
  'operatorBar.fnDescIif': 'Returns one of two values depending on a condition. Usage: IIF(condition, true_value, false_value)',
  'operatorBar.fnDescCountDistinct': 'Counts distinct non-null values (duplicates count once, nulls are ignored). Usage: COUNT_DISTINCT(field)',
  'operatorBar.fnDescWeekStart': 'Monday of the week of a date (weeks start on Monday). Usage: WEEK_START(date)',
  'operatorBar.more': 'More',
  'operatorBar.moreFunctions': 'More functions',
  'operatorBar.categoryAggregate': 'Aggregate',
  'operatorBar.categoryNumeric': 'Numeric',
  'operatorBar.categoryText': 'Text',
  'operatorBar.categoryDateTime': 'Date & time',
  'operatorBar.categoryConditional': 'Conditional',

  // Still consumed by OperatorFunctionBar and FieldTreeDock.
  'adv.functions': 'Functions',

  // ── ConditionTree ─────────────────────────────────────────────────────────
  'cond.and': 'AND',
  'cond.or': 'OR',
  'cond.negate': 'NOT',
  'cond.addCondition': '＋ Condition',
  'cond.addGroup': '＋ Add group',
  'cond.remove': 'Del',
  'cond.deleteGroup': 'Delete group',
  // Group head (condition-group paradigm), four fixed slots [dropdown1][groupPrefix][dropdown2][groupSuffix]
  // shared across all four locales (component template is not per-language): "[Match|Not match] the
  // following [all|any] conditions". Word order is stiffer than idiomatic English because the slot
  // order itself is authored in Chinese ("满足 以下 全部 条件") and not locale-specific — same tradeoff
  // already accepted elsewhere in this file for parameterized strings (see cond.paramHint* comment).
  'cond.groupSatisfy': 'Match',
  'cond.groupNotSatisfy': 'Not match',
  'cond.groupPrefix': 'the following',
  'cond.groupAll': 'all',
  'cond.groupAny': 'any',
  'cond.groupSuffix': 'conditions',
  // E10: range-comparison operator pair, semantics match SQL BETWEEN/NOT BETWEEN
  // (inclusive on both ends).
  'cond.opBetween': 'Between',
  'cond.opNotBetween': 'Not between',
  // Connector word between the two right-value inputs for between/not_between, e.g. "100 and 200".
  'cond.betweenAnd': 'and',
  'cond.opLike': 'Like',
  // E11 (product decision): switching to "Like" prefills the right value with wildcards on both
  // sides (%text%) by default; this hint tells users they can delete one side's % for a prefix/suffix match.
  'cond.likePatternHint': 'Wildcards are added on both sides by default (%text%); delete one side\'s % for a prefix/suffix match',
  'cond.opIn': 'In',
  'cond.opNotIn': 'Not in',
  // K1: null-check operators (no right value).
  'cond.opIsNull': 'Is empty',
  'cond.opIsNotNull': 'Is not empty',
  'cond.emptyGroup': 'Empty group (no conditions)',
  'cond.leftValue': 'Left value',
  'cond.rightValue': 'Right value',
  // K9-d: passive hint for parameter-like references (system variable / current-report main-table field);
  // {name} is interpolated with the field/variable display name.
  'cond.paramHintAlwaysFalse': 'When {name} is empty, this condition is always false',
  'cond.paramHintNoEffect': 'When {name} is empty, this condition has no effect',

  // ── ExpressionInput ───────────────────────────────────────────────────────
  'input.clickToWriteExpr': 'Click to write expression',
  'input.clickToSelectField': 'Click then select field / variable from right drawer',

  // ── QuickFieldPicker (⊞ quick pick, one of the value-cell's three entries) ──
  // Header prefix "Insert into <field name / slot title>"; the package's t() does not interpolate,
  // so the component concatenates the title fragment itself (same precedent as dialog.syntaxHintJump).
  // The "Variables" group title reuses the existing drawer.tabVars key — not a new one.
  'quickPick.insertInto': 'Insert into',

  'editor.dockVarsColumn': 'Variables & Functions',
  // 树坞「本报表」列（当前单据自身取值）列头后缀：与来源列的「（本模板）」区分，来源恰为本模板时不再出现两个同名列头。
  'editor.dockReportColumnSuffix': '(current report)',
  'editor.dockSourceTemplateColumnSuffix': '(source template)',
  'editor.dockExpandCard': 'Expand card',
  'editor.dockCollapseCard': 'Collapse card',
  'editor.dockSplitHandle': 'Drag to resize the field tree dock (double-click to reset)',
  'editor.dockNoMatch': 'No matches',

  // ── FieldDrawer ───────────────────────────────────────────────────────────
  'drawer.searchPlaceholder': 'Search fields / variables / functions',
  'drawer.tabSource': 'Source tables',
  'drawer.noSourceFields': 'No source table fields',
  // views-extraction-b3 R3: degradation hint when legacy host bridge lacks getViewSchema.
  'drawer.viewFieldsUnsupported': 'This host does not support the view field catalog',
  // Phase B (action staging area): degradation hint when a staging source can't resolve the
  // "previous-step staging area" columns under the current canvas topology.
  'drawer.stagingUnsupported': 'Previous step produced no staging area',
  // S2b (external data table source): degradation hint when legacy host bridge lacks getExternalSchema.
  'drawer.externalFieldsUnsupported': 'This host does not support reading external table fields',
  'drawer.fieldTypeUnsupported': 'Not supported yet',
  'drawer.tabForm': 'Current report',
  'drawer.noFields': 'No fields',
  'drawer.tabVars': 'Variables',

  // ── AdvancedExpressionDialog ──────────────────────────────────────────────
  'dialog.title': 'Expression editor',
  // 2026-08-23: added a null-check tip — this box is a free-text escape hatch where `=` is passed
  // through as literal SQL, and `= NULL` never matches under three-valued logic (a separate, parallel
  // way to check for null vs. the guided builder's new "Null value" quick option).
  'dialog.exprHint': 'Pick fields/variables from the trees above to insert (auto-syncs on rename). On confirm the server parses the text into a structured condition; comments and subqueries are not supported. For null checks use IS NULL / IS NOT NULL (= NULL never matches).',
  'dialog.unresolvedField': 'Unresolved field reference: ',
  'dialog.pleaseSelectFromDrawer': 'Please select and insert field from the right drawer',
  'dialog.openWindow': 'Window OVER',
  'dialog.syntaxTyping': 'Typing',
  'dialog.syntaxChecking': 'Checking',
  'dialog.syntaxOk': 'Syntax OK',
  'dialog.syntaxHintJump': 'Click to jump to the error',
  'dialog.syntaxErr.unclosedParen': 'Unclosed parenthesis',
  'dialog.syntaxErr.unexpectedParen': 'Unexpected closing parenthesis',
  'dialog.syntaxErr.unclosedToken': 'Unclosed field token',
  'dialog.syntaxErr.emptyToken': 'Empty field token',
  'dialog.syntaxErr.unknownField': 'Field not in the available catalog',
  'dialog.syntaxErr.danglingOperator': 'Operator is missing an operand',
  'dialog.discardTitle': 'Discard changes?',
  'dialog.discardContent': 'The expression has been modified. Closing will lose these changes.',
  'dialog.maximize': 'Maximize',
  'dialog.restore': 'Restore',
  'dialog.textModeUnavailable': 'Text mode is unavailable on this host (expression parsing API not implemented). Use guided mode or update the plugin and retry.',
  'dialog.lowerFailed': 'Expression could not be parsed',
  // Fixed 2026-08-30: backend textmodel.toLike (baf29f7ef)
  // changed text-mode LIKE from "auto-wraps both sides" to "right value used as-is as the pattern"
  // (LikeMode=pattern, no longer implicitly wraps %...%). This hint used to describe the old behavior;
  // updated to match — it no longer claims auto-wrapping, and instead tells users to add % themselves.
  'dialog.textModeLikeHint': '"Contains" (LIKE) now runs with pattern semantics: the right-hand value is used as-is as the match pattern -- wildcards are no longer added automatically. For "contains" behavior, write it yourself, e.g. LIKE \'%abc%\' (LIKE \'abc\' alone is an exact match).',

  // ── Target section (legacy keys kept for compatibility) ───────────────────
  'target.selectTable': 'Select target table',
  'target.noMapped': '(no mapped fields)',

  // ── Grouping display: pre-registered term (K9-d side task, not wired to any UI yet;
  // the non-namespaced key name is mandated by the handoff spec, kept verbatim) ──────
  'group-blank-label': '(Blank)',

  // ── Fill into chart ──────────
  'chart_target.section_title': 'Fill into chart',
  'chart_target.add': '+ Add chart target',
  'chart_target.add_series': '+ Add series',
  'chart_target.chart': 'Chart',
  'chart_target.layout': 'Layout',
  'chart_target.layout_long': 'Dynamic series',
  'chart_target.layout_long_hint': 'Series are split automatically by one field; how many there are depends on the data',
  'chart_target.layout_wide': 'Fixed series',
  'chart_target.layout_wide_hint': 'Add series one by one; each gets a name and its own expression',
  'chart_target.slot_category': 'Category',
  'chart_target.slot_series': 'Series',
  'chart_target.slot_value': 'Value',
  'chart_target.slot_name': 'Name',
  'chart_target.slot_x': 'X',
  'chart_target.slot_y': 'Y',
  'chart_target.series_name_placeholder': 'Series display name',
  'chart_target.series_optional_placeholder': 'Leave empty for a single data line with no series shown',
  'chart_target.warn_deleted': 'Chart deleted',
  'chart_target.warn_form_changed': 'Chart type changed, please remap',
  'chart_target.warn_not_pushed': 'This chart is not in pushed-data mode',
  'chart_target.empty_catalog': 'No charts detected',
  'chart_target.remove': 'Remove',
  'chart_target.untitled': 'Untitled chart',

  // ── qb.* (data-flow left/right split layout: left-column ①② panels / condition editor dialog /
  // join designer dialog new copy) ──────────────────────────────────────────────────────
  'qb.sourcePanelTitle': 'Source tables',
  'qb.conditionPanelTitle': 'Filter conditions',
  // Deprecated (D8 real-device audit): ConditionReadonlyView.vue's group head now composes from
  // cond.groupSatisfy/NotSatisfy + groupPrefix + groupAll/Any + groupSuffix (negate-aware, see its
  // groupLabel()); this whole-sentence key is unreferenced. Kept — not removed (the 4-locale key-set
  // test is sensitive to it) — for possible future reuse of a "no-negate one-liner" phrasing.
  'qb.conditionGroupAll': 'Match all of the following:',
  'qb.conditionGroupAny': 'Match any of the following:',
  'qb.conditionEmptyHint': 'Click to set filter conditions · Not set = all rows',
  // Card H-E12C (2026-08-30): post-group filter (HAVING) section title and right-value hint.
  'editor.havingSection': 'Post-group filter (HAVING)',
  'editor.havingConstOnlyHint': 'Post-group filter values must be constants for now',
  'qb.conditionEditorTitle': 'Filter conditions',
  'qb.joinLinked': 'Linked',
  'qb.joinUnlinked': 'Not linked',
  'qb.joinDesignerTitle': 'Table join designer',
  'qb.joinPendingTitle': 'The following sources need a manual join, otherwise data cannot be located:',

  // ── errMsg.* (F3: localized validation error messages, see errorMessages.ts for the mapping source) ──
  // {n0}/{n1} placeholders are manually replaced by errorMessages.ts from the regex capture groups
  // (the in-package t() does not interpolate arguments).
  'errMsg.fillTargetMissingTable': 'Fill target #{n0} is missing a target table.',
  'errMsg.fillTargetMissingField': 'Fill target #{n0} mapping #{n1} is missing a target field.',
  'errMsg.fillTargetTemplateMismatch': 'Fill target #{n0} belongs to a different template and is not allowed to write to this one.',
  'errMsg.fillTargetResolveTable': "Fill target #{n0}'s target table could not be resolved (it may have been deleted, or you lack permission).",
  'errMsg.fillTargetResolveField': "Fill target #{n0}'s target field could not be resolved (it may have been deleted, or you lack permission).",
  'errMsg.unknownSourceAlias': 'References a source table alias that was never declared.',
  'errMsg.forbiddenSourceTable': 'You do not have permission to read this source table.',
  'errMsg.forbiddenSourceApp': 'Permission denied: this data configuration references an app you cannot design.',
  'errMsg.expressionPreviewStructureInvalid': 'Expression preview failed structural validation: {n0}',
  'errMsg.expressionPreviewReferenceNotFound': 'Expression preview failed reference validation: {n0}',
  'errMsg.forbiddenField': 'You do not have permission to read this field.',
  'errMsg.joinUnknownAlias': 'Join #{n0} references an unknown alias.',
  'errMsg.unknownAliasInJoin': 'References an unknown source table alias.',
  'errMsg.aggregateArgCount': 'Aggregate function {n0} requires exactly 1 argument.',
  'errMsg.unsupportedFunction': 'Unsupported function: {n0}',
  'errMsg.fieldTokenMismatch': 'The number of field tokens does not match the number of field references — do not type curly-brace tokens by hand.',
  'errMsg.dataScopeMultiTableRejected': 'The source table has data-scope restrictions; multi-table expressions are not currently supported, so it was rejected.',
  'errMsg.aggregateFillOutputUnsupported': "The aggregate function used in a fill value is outside the currently supported range: you can aggregate the source data (optionally filtered first) with SUM/COUNT/AVG/MIN/MAX — either every value in the fill target is an aggregate (constants are also allowed), or aggregates are mixed with direct source columns, which are then used as automatic grouping keys (match-key sources must be those columns). A match-key source value itself cannot use an aggregate function. For more complex grouped summaries, use a chart target instead.",
  'errMsg.matchKeyTypeIncompatible': 'Match-key fields on both sides must have compatible types',
  'errMsg.fillStrategyTypeUnsupported': 'This field type does not support append or merge; use overwrite',
  'errMsg.writeWhereRequired': 'Update/delete requires a locating condition',
  // Card H-E12C (2026-08-30): localized display text for the post-group filter (having) save-gate's
  // two new hard rejections; the backend detail strings are fixed and must not change.
  'errMsg.havingRequiresGroupBy': 'Post-group filter requires group-by fields',
  'errMsg.havingUnsupported': 'The post-group filter condition engine cannot support this — use a constant on the right side or simplify the condition',
  // Card E12 (narrowing) / cluster 2 (automatic-row-match normalization error previously swallowed
  // by the save gate): localized display text for the two new hard rejections.
  'errMsg.havingRightOperandNonConst': 'The post-group filter only supports a constant on the right side — use a fixed value or text',
  'errMsg.automaticRowMatchMultiSourceInvalid': 'The matching table cannot be determined automatically with multiple source tables — use a single source table or configure the match condition manually',
  'errMsg.autoRecordIDShapeInvalid': 'Auto linking only supports an inner join between a main table and a detail table of the same template — check the table roles or configure the join condition manually',

  'errMsg.writeTargetCannotBeView': 'Write target cannot be a view source: views do not support writes (insert/update/delete) — please choose a data table as the write target',

  // ── fieldMultiPick.* ──
  // "Not supported" reuses drawer.fieldTypeUnsupported; cancel/delete reuse common.cancel/common.delete;
  // maximize/restore reuse dialog.maximize/dialog.restore; empty states reuse editor.dockNoMatch/picker.selectHint.
  'fieldMultiPick.title': 'Batch add columns',
  'fieldMultiPick.searchPlaceholder': 'Search fields',
  'fieldMultiPick.selectAll': 'Select all',
  'fieldMultiPick.deselectAll': 'Deselect all',
  'fieldMultiPick.added': 'Added',
  // "Will add N columns" concatenation: t() in this package does not interpolate (same convention
  // as picker.selected/picker.confirm) — each half is localized separately, the number goes between.
  'fieldMultiPick.willAddPrefix': 'Will add ',
  'fieldMultiPick.willAddUnit': ' column(s)',
  'fieldMultiPick.columnNameHint': 'Column name defaults to the field name; you can rename it after adding',
  'fieldMultiPick.confirmPrefix': 'Add ',
  'fieldMultiPick.confirmUnit': ' column(s)',

  // ── v4.* (表达式引擎 V4 engine demo editing panel, src/v4/) ──────────────────────
  'v4.tabStaging': 'Staging',
  'v4.stagingEmpty': 'No staging columns',
  'v4.diagnosticsTitle': 'Diagnostics',
  'v4.diagnosticsEmpty': 'No diagnostics',
  'v4.diagnosing': 'Checking…',
  'v4.textareaPlaceholder': 'e.g. [t1].[amount] > 100',
  'v4.operatorsLabel': 'Operators',
  'v4.keywordsLabel': 'Keywords',
  // T6 rework: localize the function bar's group titles (previously showed the raw server category value).
  'v4.functionCategory.aggregate': 'Aggregate',
  'v4.functionCategory.scalar': 'Scalar',
  'v4.functionCategory.construct': 'Constructs'
} as const;
