/**
 * 表达式编辑器日文本地化字符串。
 * key 集合与 zh-CN.ts 逐条对齐。
 */
export default {
  // ── 通用 ───────────────────────────────────────────────────────────────────
  'common.noResponse': '応答なし',
  'common.requestFailed': 'リクエスト失敗',
  'common.cancel': 'キャンセル',
  'common.confirm': 'OK',
  'common.loading': '読み込み中...',
  'common.delete': '削除',
  'common.none': '（なし）',
  // 「空値」クイックオプション：ConditionTree.vue の条件値入力
  // ⊞ クイック選択に追加した項目 + ExpressionInput.vue/ConditionReadonlyView.vue が
  // kind='const'+value=null を表示する際の専用文言。
  'common.nullValue': '空値',
  'editor.previewFailed': '検証に失敗しました',
  'editor.joinLabel': 'テーブル結合',

  // ── SourceTreePicker ───────────────────────────────────────────────────────
  'picker.addSource': '＋ データ元を追加',
  'picker.title': 'データ元の追加（データテーブル単位、重複選択可）',
  'picker.titleSingle': 'データテーブルを選択（単一選択、再選択で置き換え）',
  'picker.noTemplates': 'テンプレートがありません',
  'picker.currentTemplate': '（このテンプレート）',
  'picker.ungrouped': '未分類',
  'picker.currentApp': '（現在のアプリ）',
  'picker.thisApp': '現在のアプリ',
  'picker.mainTable': 'メインテーブル',
  'picker.detailTable': '拡張テーブル',
  'picker.selected': '選択済み（',
  'picker.selectHint': '左のデータテーブルをクリックして追加。同じテーブルを重複追加できます',
  'picker.selectHintSingle': '左のデータテーブルをクリックして選択。再度選択すると置き換わります',
  'picker.clear': 'クリア',
  'picker.confirm': 'OK（',
  'picker.viewGeneric': 'ビュー',
  'picker.viewSelfRefDisabled': '自身は選択できません（循環参照になります）',
  'picker.viewRegular': '通常ビュー',
  'picker.viewCombined': '結合ビュー',
  'picker.columnCountUnit': ' 列',
  'picker.disabledWriteTarget': 'このアクションの書き込み対象になっています',
  'picker.stagingSource': '前ステップの一時領域',
  'picker.stagingNoProducer': '前ステップに一時領域がありません',
  // ── 编辑区引用补全分组 ──
  'completion.sourceGroup': 'データ源',
  'completion.reportGroup': '本帳票',
  'completion.variableGroup': 'システム変数',
  // S2b（外部データテーブル来源）：selectableKinds に 'external' を含む場合の外部テーブル葉ノード。
  'picker.externalGeneric': '外部テーブル',

  // ── ExpressionEditor ──────────────────────────────────────────────────────
  'editor.loadFieldsFailed': '項目カタログの読み込みに失敗しました',
  'editor.previewValid': '検証に成功：有効な SQL にコンパイルできます',
  'editor.previewInvalid': '検証に失敗しました',
  'editor.noResponse': '応答なし',
  'editor.drawerTitle': '統合項目パネル',
  'editor.drawerCollapse': '項目パネルを閉じる',
  'editor.drawerExpand': '項目パネルを開く',

  // 来源段
  'editor.segSource': 'データ元 · from 句',
  'editor.addSourceEmpty': '右上の「データ元を追加」から他のデータテーブルを選択',
  'editor.addSourceEmptyNoImplicit': '右上の「データ元を追加」から最初のソーステーブルを選択',
  'editor.templateLabel': 'テンプレート：',
  'editor.fieldCountSuffix': ' 項目',
  'editor.sourceViewSuffix': '（ビュー）',
  'editor.sourceStagingSuffix': '（一時領域）',
  // S2b（外部データテーブル来源）：外部テーブル来源タグの視覚区分接尾辞、sourceViewSuffix と同一方式。
  'editor.sourceExternalSuffix': '（外部テーブル）',

  // 关联段
  'editor.joinTypeInner': '内部結合',
  'editor.joinTypeLeft': '左外部結合',
  'editor.manualJoinTitle': '手動結合（同一テンプレートのメイン＋明細は record_id で自動結合済み）',
  'editor.deleteJoin': '削除',
  'editor.addJoinCondition': '＋ 結合条件',
  'editor.manualJoinHint': 'テーブルをまたぐ結合が必要な場合は下から追加してください',
  'editor.addManualJoin': '＋ 手動結合を追加',
  'editor.leftField': '左項目',
  'editor.rightField': '右項目',
  'editor.manualJoinSectionTitle': '手動結合{n}',
  'editor.joinConditionLabel': '結合条件',
  'editor.writeLeftJoinNotice':
    '左結合にすると対象テーブルの未一致レコードも書き込まれます（該当フィールドは空値になります）。一致したレコードのみ変更したい場合は内部結合を使用してください',

  // 条件段
  'editor.segCondition': '条件 · where 句',
  'editor.modeGuided': 'ガイド式',
  'editor.modeExpr': '式',
  'editor.wherePlaceholder': 'クリックして絞り込み式を入力（WHERE 全体、例：{メインテーブル.金額} > 100 AND …）',

  // 目标段
  'editor.segTarget': 'ターゲットと項目',
  'editor.selectTargetTable': '登録先テーブルを選択',
  'editor.selectTargetTableFirst': '先に登録先テーブルを選択してください',
  'editor.targetExprPlaceholder': 'ここをクリック→右のパネルで項目を選択、または「ƒ」で式を入力',
  'editor.targetGroupTables': 'データテーブル',
  'editor.targetGroupStaging': '一時領域（次のステップで使用）',
  'editor.stagingTargetLabel': '一時領域',
  'editor.stagingColumnName': '列名',
  'editor.stagingAddColumn': '＋ 列を追加',
  'editor.stagingRemoveColumn': 'この列を削除',
  'editor.stagingColumnDupe': '列名が重複しています',
  'editor.autoMatchFields': '名称で自動入力',
  // クリア規則：③ターゲットタブ行の右側、テーブルごとの「範囲 × タイミング」統合セレクト。
  // 「取得前」= クリアされたデータはクエリ条件に参加しない。
  'editor.clearModeTitle': 'クリア方式：実行開始時に Mirror の該当位置の値をクリア（値のみ・行は保持・数式セルはスキップ）',
  'editor.clearModeNone': 'なし',
  'editor.clearModeMapped': '入力項目',
  'editor.clearModeAll': 'テーブル全体',
  'editor.clearTimingTitle': 'クリア時機：取得前＝クリアしてから照会（旧データは条件に参加しない）；取得後＝パラメータ取得後にクリアと照会を並行',
  'editor.clearTimingBefore': '取得前',
  'editor.clearTimingAfter': '取得後',
  // 自動行列マッチング（V4 設定面の再配置：ターゲット単位のスイッチ、明細ターゲットのみ表示）。
  'editor.autoRowMatch': '自動行列マッチング',
  'editor.autoRowMatchTitle': 'オン：絞り込み条件からマッチキーを自動抽出；オフ：入力方式で「行列マッチング」を手動選択',
  'editor.autoRowMatchV4Hint': 'オンにすると、絞り込み条件の「ソース項目 = 本レポート明細項目」の等式が実行時にその項目の行単位マッチングキーとして自動的に使われます。等式は絞り込み条件として引き続き有効で、設定は書き換えられません。オフでは推導せず、入力方式で「行単位でマッチング」を手動選択します',
  'editor.targetSettings': '設定',
  'editor.targetSettingsTitle': 'この対象テーブルの入力設定',
  'editor.targetSettingsGroupFill': '入力とクリア',
  'editor.targetSettingsGroupQuery': 'クエリ結果',
  'editor.clearModeLabel': 'クリア方式',
  'editor.clearTimingLabel': 'クリアのタイミング',
  'editor.noticeErrors': 'エラー',
  'editor.noticeWarnings': '警告',
  'editor.noticeInfos': 'ヒント',
  'editor.noticeDetails': '詳細',
  'editor.noticeWhereSyntax': '構文チェック',
  'editor.statusWarning': '要確認の項目があります',
  'editor.trimEmptyRowsAfterFill': '実行後に空行を整理',
  'editor.trimEmptyRowsAfterFillTitle': '今回のデータ取得の書き戻し後、この表の末尾にある連続した空行を削除します；最低 2 行は残します。部分更新時は実行しません',
  'editor.targetDistinct': '重複を除外',
  'editor.targetDistinctTitle': 'この対象の結果から完全に重複する行を除きます（この対象の出力列で判定）。入力対象ごとに個別設定、既定はオン',
  'editor.targetTake': '先頭 N 件のみ',
  'editor.targetTakeTitle': 'この対象の結果の先頭 N 行だけ取得します。−/＋ で調整するか直接入力、空欄で無制限',
  'editor.takeUnlimited': '無制限',
  // マージ区切り文字。
  'editor.separatorTitle': 'マージ区切り文字',
  'editor.attachmentTargetHint': '画像／添付ファイルのフィールド：画像／添付ファイルの式でのみ入力できます',
  'editor.sepComma': 'カンマ ,',
  'editor.sepSemicolon': 'セミコロン ;',
  'editor.sepPeriod': 'ピリオド .',
  'editor.sepSpace': 'スペース',
  'editor.sepPlus': 'プラス +',
  'editor.sepSlash': 'スラッシュ /',
  'editor.sepNewline': '改行',
  'editor.autoMatchDone': 'マッチ済み ',
  'editor.autoMatchDoneUnit': ' 項目',

  // 写目标
  // ①目標セグメントの名称（操作ごとに三択；セグメント見出しに操作種別バッジは付けない——名称に
  // 操作が含まれているため）。
  'editor.writeTargetSeg_insert': '追加先',
  'editor.writeTargetSeg_update': '更新先',
  'editor.writeTargetSeg_delete': '削除先',
  // ④項目入力セグメントの名称（旧「書き込み先」。ターゲット選択は①セグメントへ移動、本セグメントは
  // 項目入力のみ）。
  'editor.writeFieldsSeg': '入力項目',
  // 自己代入の補助ヒント（ユーザー 09-10 フィードバック：拡張テーブル更新で名前一致入力が自己代入
  // になる不具合）：この行の入力式が参照しているのはターゲット項目自身のみ——保存/実行は妨げず、
  // 「値が変わらない」ことだけ知らせる。
  'editor.writeSelfAssignmentHint': 'この入力式はターゲット項目自身を参照しています。実行後も値は変わりません',
  // ②データ元／④項目入力／⊞クイック選択／ドックの「ターゲット」グループの見出し。
  'editor.writeTargetGroupLabel': 'ターゲット',
  // 3 つの操作は①セグメントの単一データテーブル選択（旧「追加」用ピッカーを再利用）で統一——
  // データ元の別名から選ぶという別経路はもうありません。
  'editor.pickWriteTarget': '書き込み先テーブルを選択',
  'editor.pickWriteTargetFirst': '先に上の①セグメントで対象テーブルを選択してください',
  'editor.dedupe': '一意キーによる重複防止',
  'editor.dedupeHint': '選択した項目で判定：対象テーブルに同一レコードが既にある場合、または今回の結果内で重複する場合はスキップし、追加しません',
  'editor.dedupeScopeLabel': '判定範囲',
  'editor.dedupeScopeAll': 'テーブル全体',
  'editor.dedupeScopeParent': '同一親レコード内',
  'editor.dedupeNoFilledFields': '先に上の項目へ式を入力してください',

  // 填充策略
  'editor.strategyOverwrite': '上書き',
  'editor.strategyAppend': '追加',
  'editor.strategyMerge': 'マージ',
  'editor.strategyRowMatch': '行単位でマッチング',

  // 排序
  'editor.sortNone': '並べ替えなし',
  'editor.sortAsc': '昇順',
  'editor.sortDesc': '降順',
  'editor.nativeTextEqualityHint': 'テキストの等価比較には、対象データベースおよび列／式のネイティブ規則を使用します。データベースによって結果が異なる場合があります。',
  'editor.nativeTextSemanticsHint': 'テキストの等価比較、重複排除、並べ替えには、対象データベースおよび列／式のネイティブ規則を使用します。データベースによって結果が異なる場合があります。',

  // 校验结果
  'editor.validationFailed': '検証に失敗：',
  'editor.validationPassed': '検証に成功：有効な SQL にコンパイルできます',
  'editor.validationFailedMsg': '検証に失敗しました',
  'editor.syntaxCheckPending': '入力中',
  'editor.syntaxCheckChecking': 'チェック中',
  'editor.syntaxCheckValid': '✓ 正しい',
  'editor.syntaxCheckInvalid': '✗ エラー',

  // ── OperatorFunctionBar ────────────────────────────────────────────────────
  // 2026-09-08 ユーザー確定：算術/論理の 2 行を「演算子」1 行に統合（旧 2 キーは退役）。
  'operatorBar.operatorLabel': '演算子',
  'operatorBar.opLike': '含む',
  'operatorBar.opLikeStarts': '前方一致',
  'operatorBar.opLikeEnds': '後方一致',
  'operatorBar.opNotLike': '含まない',
  'operatorBar.opIn': '含まれる',
  'operatorBar.opNotIn': '含まれない',
  'operatorBar.fnSum': '合計',
  'operatorBar.fnCount': '件数',
  'operatorBar.fnAvg': '平均',
  'operatorBar.fnMin': '最小値',
  'operatorBar.fnMax': '最大値',
  'operatorBar.fnConcat': '文字列連結',
  'operatorBar.fnCoalesce': 'NULL 値の代替',
  'operatorBar.fnRound': '四捨五入',
  'operatorBar.fnCase': '条件分岐',
  'operatorBar.fnCountStar': '行数',
  'operatorBar.fnAbs': '絶対値',
  'operatorBar.fnCharindex': '位置検索',
  'operatorBar.fnDatediff': '日付差',
  'operatorBar.fnDateadd': '日付加算',
  'operatorBar.fnYear': '年',
  'operatorBar.fnMonth': '月',
  'operatorBar.fnYearMonth': '年月',
  'operatorBar.fnYearMonthDay': '暦日',
  'operatorBar.fnMonthStart': '月初',
  'operatorBar.fnQuarterStart': '四半期初',
  'operatorBar.fnYearStart': '年初',
  'operatorBar.fnLen': '長さ',
  'operatorBar.fnLeft': '左端抽出',
  'operatorBar.fnRight': '右端抽出',
  'operatorBar.fnReplace': '置換',
  'operatorBar.fnTrim': '空白除去',
  // ── 本 wave（2026-09-02）：8 個のスカラー関数 + 2 個の正規構造（NULLIF/IIF）別名──
  'operatorBar.fnUpper': '大文字変換',
  'operatorBar.fnLower': '小文字変換',
  'operatorBar.fnLtrim': '左空白除去',
  'operatorBar.fnRtrim': '右空白除去',
  'operatorBar.fnSubstring': '部分文字列',
  'operatorBar.fnFloor': '切り捨て',
  'operatorBar.fnCeiling': '切り上げ',
  'operatorBar.fnDay': '日',
  'operatorBar.fnNullif': 'NULL 化 (NULLIF)',
  'operatorBar.fnIif': '条件値 (IIF)',
  // ── 2026-10-10：重複なし件数 + 週初──
  'operatorBar.fnCountDistinct': '重複なし件数',
  'operatorBar.fnWeekStart': '週初',
  'operatorBar.fnDescSum': '選択した項目を合計します（NULL は無視）。用法：SUM(項目)',
  'operatorBar.fnDescCount': '行数を数えます。COUNT(項目) は非 NULL のみ、COUNT(*) は全行を数えます。',
  'operatorBar.fnDescAvg': '算術平均を求めます（NULL は無視）。用法：AVG(項目)',
  'operatorBar.fnDescMin': '最小値を取ります（数値・日付・文字列いずれも比較可）。用法：MIN(項目)',
  'operatorBar.fnDescMax': '最大値を取ります（数値・日付・文字列いずれも比較可）。用法：MAX(項目)',
  'operatorBar.fnDescConcat': '複数の値を順に連結して 1 つの文字列にします。用法：CONCAT(値1, 値2, …)',
  'operatorBar.fnDescCoalesce': '最初の非 NULL 値を返します（既定値のフォールバックに便利）。用法：COALESCE(値1, 値2, …)',
  'operatorBar.fnDescRound': '指定した小数桁で四捨五入します。用法：ROUND(数値, 桁数)',
  'operatorBar.fnDescCase': '条件によって値を分岐します（WHEN は複数可）。用法：CASE WHEN 条件 THEN 値 ELSE 既定値 END',
  'operatorBar.fnDescCountStar': '全行数を数えます（COUNT(*) と同じ）。用法：ROW_COUNT()',
  'operatorBar.fnDescAbs': '絶対値を返します。用法：ABS(数値)',
  'operatorBar.fnDescCharindex': '部分文字列が最初に現れる位置（1 始まり、見つからなければ 0）。用法：CHARINDEX(部分文字列, テキスト[, 開始位置])',
  'operatorBar.fnDescDatediff': '2 つの日付の差を指定単位で返します。用法：DATEDIFF(単位, 開始日, 終了日)、単位は \'d\'/\'m\'/\'y\' など',
  'operatorBar.fnDescDateadd': '日付に指定単位の数量を加えます。用法：DATEADD(単位, 数量, 日付)',
  'operatorBar.fnDescYear': '日付の年（整数）。用法：YEAR(日付)',
  'operatorBar.fnDescMonth': '日付の月（整数）。用法：MONTH(日付)',
  'operatorBar.fnDescYearMonth': '日付の「年-月」テキスト（YYYY-MM）。用法：YEAR_MONTH(日付)',
  'operatorBar.fnDescYearMonthDay': '日時を暦日に切り捨てます。用法：YEAR_MONTH_DAY(日付)',
  'operatorBar.fnDescMonthStart': '日付が属する月の初日。用法：MONTH_START(日付)',
  'operatorBar.fnDescQuarterStart': '日付が属する四半期の初日。用法：QUARTER_START(日付)',
  'operatorBar.fnDescYearStart': '日付が属する年の初日。用法：YEAR_START(日付)',
  'operatorBar.fnDescLen': 'テキストの文字数を返します。用法：LEN(テキスト)',
  'operatorBar.fnDescLeft': 'テキストの左端から指定した文字数を取り出します。用法：LEFT(テキスト, 文字数)',
  'operatorBar.fnDescRight': 'テキストの右端から指定した文字数を取り出します。用法：RIGHT(テキスト, 文字数)',
  'operatorBar.fnDescReplace': 'テキスト内の部分文字列を新しい文字列に置き換えます（すべて置換）。用法：REPLACE(テキスト, 検索文字列, 置換後文字列)',
  'operatorBar.fnDescTrim': 'テキストの前後にある空白文字を取り除きます。用法：TRIM(テキスト)',
  'operatorBar.fnDescOver': 'ウィンドウ関数：行をまとめずに、区画内で累計や順位を求めます。用法：集計関数 OVER (PARTITION BY 項目 ORDER BY 項目)',
  'operatorBar.fnDescUpper': 'テキストを大文字に変換します。用法：UPPER(テキスト)',
  'operatorBar.fnDescLower': 'テキストを小文字に変換します。用法：LOWER(テキスト)',
  'operatorBar.fnDescLtrim': 'テキストの先頭にある空白文字を取り除きます。用法：LTRIM(テキスト)',
  'operatorBar.fnDescRtrim': 'テキストの末尾にある空白文字を取り除きます。用法：RTRIM(テキスト)',
  'operatorBar.fnDescSubstring': '指定した位置から指定した長さの部分文字列を取得します（位置は 1 始まり）。用法：SUBSTRING(テキスト, 開始位置, 長さ)',
  'operatorBar.fnDescFloor': '値以下の最大の整数に切り捨てます。用法：FLOOR(数値)',
  'operatorBar.fnDescCeiling': '値以上の最小の整数に切り上げます。用法：CEILING(数値)',
  'operatorBar.fnDescDay': '日付の日（何日か、整数）を返します。用法：DAY(日付)',
  'operatorBar.fnDescNullif': '2 つの値が等しい場合は NULL を返し、そうでなければ最初の値を返します。用法：NULLIF(値1, 値2)',
  'operatorBar.fnDescIif': '条件に応じて 2 つの値のいずれかを返します。用法：IIF(条件, 真の値, 偽の値)',
  'operatorBar.fnDescCountDistinct': '重複しない非 NULL 値の個数を数えます（重複は 1 回、NULL は数えません）。用法：COUNT_DISTINCT(項目)',
  'operatorBar.fnDescWeekStart': '日付が属する週の月曜日（週は月曜日始まり）。用法：WEEK_START(日付)',
  'operatorBar.more': 'その他',
  'operatorBar.moreFunctions': 'その他の関数',
  'operatorBar.categoryAggregate': '集計',
  'operatorBar.categoryNumeric': '数値',
  'operatorBar.categoryText': 'テキスト',
  'operatorBar.categoryDateTime': '日付と時刻',
  'operatorBar.categoryConditional': '条件',

  // OperatorFunctionBar と FieldTreeDock が引き続き使用。
  'adv.functions': '関数',

  // ── ConditionTree ─────────────────────────────────────────────────────────
  'cond.and': 'かつ',
  'cond.or': 'または',
  'cond.negate': '満たさない',
  'cond.addCondition': '＋ 条件',
  'cond.addGroup': '＋ 条件グループ',
  'cond.remove': '削除',
  'cond.deleteGroup': 'グループを削除',
  // グループヘッド（条件グループ方式）：4 つの固定スロット [dropdown1][groupPrefix][dropdown2][groupSuffix]
  // は全言語共通（テンプレート自体は言語別に分岐しない）。日本語は動詞が文末に来る言語のため、
  // 中国語の語順（満たす→以下→全て→条件）をそのまま流し込むと不自然になるが、コンポーネント構造上の
  // 制約でスロット順は変えられない——妥協点として各スロットは単語単位の直訳を採用。
  'cond.groupSatisfy': '満たす',
  'cond.groupNotSatisfy': '満たさない',
  'cond.groupPrefix': '以下の',
  'cond.groupAll': 'すべて',
  'cond.groupAny': 'いずれか',
  'cond.groupSuffix': 'の条件',
  // E10：範囲比較演算子のペア。意味は SQL の BETWEEN/NOT BETWEEN と同じ（両端を含む
  // 閉区間）。ラベルは他 3 言語の「単語」に合わせ、範囲を表す慣用表現を採用。
  'cond.opBetween': '範囲内',
  'cond.opNotBetween': '範囲外',
  // between/not_between の 2 つの右辺入力欄の間に置く連結語。日本語 UI では「and」に無理に対応する
  // 語より、範囲表記の慣用記号「〜」（例：100〜200）の方が固定スロット位置でも自然に読めるため採用
  // （グループヘッドの語順制約と同じ妥協——コンポーネント構造上スロット順は変えられない）。
  'cond.betweenAnd': '〜',
  'cond.opLike': '含む',
  // E11（プロダクト判断）：「含む」に切り替えると右辺値の前後に既定でワイルドカードが補われる
  // （%text%）。このヒントは、片側の % を削除すると前方一致/後方一致になることを案内する。
  'cond.likePatternHint': '既定で前後にワイルドカードが補われます（%テキスト%）。片側の % を削除すると前方一致/後方一致になります',
  'cond.opIn': 'いずれかに一致',
  'cond.opNotIn': 'いずれにも一致しない',
  'cond.opIsNull': '空である',
  'cond.opIsNotNull': '空でない',
  'cond.emptyGroup': '空のグループ（条件なし）',
  'cond.leftValue': '左辺',
  'cond.rightValue': '右辺',
  'cond.paramHintAlwaysFalse': '{name}が未入力の場合、この条件は常に成立しません',
  'cond.paramHintNoEffect': '{name}が未入力の場合、この条件は適用されません',

  // ── ExpressionInput ───────────────────────────────────────────────────────
  'input.clickToWriteExpr': 'クリックして式を入力',
  'input.clickToSelectField': 'クリックして右のパネルから項目／変数を選択',

  // ── QuickFieldPicker（⊞ クイック選択、値セルの三つの入口の一つ）─────────────
  'quickPick.insertInto': '挿入先',

  'editor.dockVarsColumn': '変数と関数',
  // 树坞「本报表」列（当前单据自身取值）列头后缀：与来源列的「（本模板）」区分，来源恰为本模板时不再出现两个同名列头。
  'editor.dockReportColumnSuffix': '（このレポート）',
  'editor.dockSourceTemplateColumnSuffix': '（ソーステンプレート）',
  'editor.dockExpandCard': 'カードを展開',
  'editor.dockCollapseCard': 'カードを折りたたむ',
  'editor.dockSplitHandle': 'ドラッグして項目ツリーの高さを調整（ダブルクリックでリセット）',
  'editor.dockNoMatch': '一致なし',

  // ── FieldDrawer ───────────────────────────────────────────────────────────
  'drawer.searchPlaceholder': '項目／変数／関数を検索',
  'drawer.tabSource': 'データ元',
  'drawer.noSourceFields': 'データ元の項目がありません',
  'drawer.viewFieldsUnsupported': '現在のホストはビュー項目カタログに未対応です',
  'drawer.stagingUnsupported': '前ステップに一時領域がありません',
  // S2b（外部データテーブル来源）：旧ホストブリッジが getExternalSchema 未対応の場合の劣化表示。
  'drawer.externalFieldsUnsupported': '現在のホストは外部テーブル項目の読み取りに未対応です',
  'drawer.fieldTypeUnsupported': '現在未対応です',
  'drawer.tabForm': 'このレポート',
  'drawer.noFields': '項目がありません',
  'drawer.tabVars': '変数',

  // ── AdvancedExpressionDialog ──────────────────────────────────────────────
  'dialog.title': '式エディター',
  // 2026-08-23 追加：NULL 判定のヒント——ここは自由記述の逃げ道で `=` はそのまま SQL に渡るため、
  // `= NULL` は三値論理上恒に成立しない（引導式に追加した「空値」クイックオプションとは別の判定経路）。
  'dialog.exprHint': '上のツリーから項目/変数を選んで挿入（項目名の変更は自動反映）。確定時にサーバーが構造化条件に解析します。コメントとサブクエリは使用できません。NULL 判定は IS NULL / IS NOT NULL を使用してください（= NULL は常に不成立）。',
  'dialog.unresolvedField': '認識できない項目記法：',
  'dialog.pleaseSelectFromDrawer': '右から挿入する項目を選択してください',
  'dialog.openWindow': 'ウィンドウ関数 OVER',
  'dialog.syntaxTyping': '入力中',
  'dialog.syntaxChecking': 'チェック中',
  'dialog.syntaxOk': '構文は正しい',
  'dialog.syntaxHintJump': 'クリックでエラー位置へ移動',
  'dialog.syntaxErr.unclosedParen': '閉じ括弧がありません',
  'dialog.syntaxErr.unexpectedParen': '余分な閉じ括弧があります',
  'dialog.syntaxErr.unclosedToken': 'フィールドトークンが閉じていません',
  'dialog.syntaxErr.emptyToken': '空のフィールドトークンです',
  'dialog.syntaxErr.unknownField': 'フィールドが利用可能な一覧にありません',
  'dialog.syntaxErr.danglingOperator': '演算子のオペランドがありません',
  'dialog.discardTitle': '変更を破棄しますか？',
  'dialog.discardContent': '式が変更されています。閉じると変更内容が失われます。',
  'dialog.maximize': '最大化',
  'dialog.restore': '元に戻す',
  'dialog.textModeUnavailable': 'このホストではテキストモードを使用できません（式解析 API が未実装）。ガイドモードを使うか、プラグインを更新して再試行してください。',
  'dialog.lowerFailed': '式を解析できません',
  // 2026-08-30 修正：バックエンドの textmodel.toLike
  // （baf29f7ef）がテキストモード LIKE を「両側に自動でワイルドカードを補う」から「右辺の値をそのまま
  // pattern として使う」（LikeMode=pattern、既定で %…% を補わなくなった）に変更したため、このヒントが
  // 説明していた旧挙動は不正確になった。自動補完すると誤って伝えないよう、% は自分で書くよう案内する
  // 文言に修正。
  'dialog.textModeLikeHint': '「含む」（LIKE）は pattern 一致で実行されます：右辺の値がそのまま照合パターンとして使われ、ワイルドカードは自動追加されません。「含む」動作にしたい場合は LIKE \'%abc%\' のように自分で書いてください（LIKE \'abc\' だけだと完全一致になります）。',

  // ── 目标表区（旧 key 保留兼容）─────────────────────────────────────────────
  'target.selectTable': '登録先テーブルを選択',
  'target.noMapped': '（マッピング項目なし）',

  // ── 分组展示预置词条 ───────────────────────────────────────────────────────
  'group-blank-label': '(空白)',

  // ── 填充到图表 ─────────────────────────────────────────────────────────────
  'chart_target.section_title': 'グラフへ出力',
  'chart_target.add': '＋ グラフ出力先を追加',
  'chart_target.add_series': '＋ 系列を追加',
  'chart_target.chart': 'グラフ',
  'chart_target.layout': 'データ形式',
  'chart_target.layout_long': '動的系列',
  'chart_target.layout_long_hint': '1 つの項目の値で系列が自動的に分かれます。本数はデータ次第です',
  'chart_target.layout_wide': '固定系列',
  'chart_target.layout_wide_hint': '系列を 1 本ずつ追加します。それぞれに名前と式を設定します',
  'chart_target.slot_category': '分類',
  'chart_target.slot_series': '系列',
  'chart_target.slot_value': '値',
  'chart_target.slot_name': '名称',
  'chart_target.slot_x': 'X',
  'chart_target.slot_y': 'Y',
  'chart_target.series_name_placeholder': '系列の表示名',
  'chart_target.series_optional_placeholder': '空欄＝データが 1 本だけ。グラフに系列は表示されません',
  'chart_target.warn_deleted': 'グラフは削除されています',
  'chart_target.warn_form_changed': 'グラフの種類が変更されました。再マッピングしてください',
  'chart_target.warn_not_pushed': 'このグラフは取得データ出力モードではありません',
  'chart_target.empty_catalog': 'グラフが見つかりません',
  'chart_target.remove': '削除',
  'chart_target.untitled': '無題のグラフ',

  // ── qb.*（データフロー左右分割レイアウト改版：左カラム①②パネル/条件編集ダイアログ/
  // テーブル関連付けデザイナーの新規文言）──────────────────────────────────────────
  'qb.sourcePanelTitle': 'ソーステーブル',
  'qb.conditionPanelTitle': 'フィルター条件',
  // 非推奨（D8 実機検証）：ConditionReadonlyView.vue のグループヘッド文言は cond.groupSatisfy/
  // NotSatisfy + groupPrefix + groupAll/Any + groupSuffix の原子語結合（negate 対応、groupLabel()
  // 参照）に変更済みで、本整文キーは未参照。削除せず保持（4 言語キー集合テストが敏感）——将来
  // "negate なしの一文" が必要になった場合の再利用用途。
  'qb.conditionGroupAll': '以下のすべての条件を満たす：',
  'qb.conditionGroupAny': '以下のいずれかの条件を満たす：',
  'qb.conditionEmptyHint': 'クリックしてフィルター条件を設定 · 未設定＝全行を取得',
  'editor.havingSection': 'グループ後の絞り込み（HAVING）',
  'editor.havingConstOnlyHint': 'グループ後の絞り込みの右辺は現在定数のみ対応',
  'qb.conditionEditorTitle': 'フィルター条件',
  'qb.joinLinked': '関連付け済み',
  'qb.joinUnlinked': '未関連付け',
  'qb.joinDesignerTitle': 'テーブル関連付けデザイナー',
  'qb.joinPendingTitle': '以下のソースは手動で関連付けを設定する必要があります。設定しないとデータを特定できません：',

  // ── errMsg.*（F3：検証エラーメッセージの多言語化。マッピング元は errorMessages.ts を参照）──
  // {n0}/{n1} プレースホルダーは errorMessages.ts が正規表現のキャプチャグループから手動で
  // replace する（パッケージ内 t() は引数の差し込みを行わない）。
  'errMsg.fillTargetMissingTable': '入力先 #{n0} に対象テーブルが指定されていません。',
  'errMsg.fillTargetMissingField': '入力先 #{n0} のマッピング #{n1} に対象フィールドが指定されていません。',
  'errMsg.fillTargetTemplateMismatch': '入力先 #{n0} は別のテンプレートに属しており、書き込み権限がありません。',
  'errMsg.fillTargetResolveTable': '入力先 #{n0} の対象テーブルを解決できません（削除された、または権限がない可能性があります）。',
  'errMsg.fillTargetResolveField': '入力先 #{n0} の対象フィールドを解決できません（削除された、または権限がない可能性があります）。',
  'errMsg.unknownSourceAlias': '宣言されていないソーステーブルのエイリアスを参照しています。',
  'errMsg.forbiddenSourceTable': 'このソーステーブルを読み取る権限がありません。',
  'errMsg.forbiddenSourceApp': '権限が不足しています。このデータ取得設定は、設計権限のないアプリを参照しています。',
  'errMsg.expressionPreviewStructureInvalid': '式のプレビューは構造検証に失敗しました：{n0}',
  'errMsg.expressionPreviewReferenceNotFound': '式のプレビューは参照検証に失敗しました：{n0}',
  'errMsg.forbiddenField': 'このフィールドを読み取る権限がありません。',
  'errMsg.joinUnknownAlias': '関連付け #{n0} が不明なエイリアスを参照しています。',
  'errMsg.unknownAliasInJoin': '不明なソーステーブルのエイリアスを参照しています。',
  'errMsg.aggregateArgCount': '集計関数 {n0} は引数を 1 つだけ必要とします。',
  'errMsg.unsupportedFunction': 'サポートされていない関数：{n0}',
  'errMsg.fieldTokenMismatch': 'フィールドマーカーの数と実際に参照されているフィールドの数が一致しません。波括弧のマーカーを手入力しないでください。',
  'errMsg.dataScopeMultiTableRejected': 'ソーステーブルにデータ範囲の制限があり、現在は複数テーブルの式に対応していないため拒否されました。',
  'errMsg.aggregateFillOutputUnsupported': '入力値に含まれる集計関数の使い方が現在サポートされている範囲を超えています。現在サポートしているのは、ソースデータ（あらかじめ絞り込み条件で絞り込み可）に対して SUM/COUNT/AVG/MIN/MAX を実行して入力する形です——入力先のすべての値が集計（定数も併用可）であるか、集計と列の直接参照を混在させ、直接参照した列で自動的にグループ化する形（この場合、照合条件のソースはそれらの列である必要があります）のいずれかです。照合条件のソース値そのものに集計関数は使えません。より複雑なグループ集計はグラフの出力先をご利用ください。',
  'errMsg.matchKeyTypeIncompatible': '照合条件の両側のフィールド型が一致しません。同じ型のフィールドを選択してください',
  'errMsg.fillStrategyTypeUnsupported': 'このフィールド型は追加・結合による書き込みに対応していません。上書きを使用してください',
  'errMsg.writeWhereRequired': '更新/削除には絞り込み条件の設定が必須です',
  'errMsg.havingRequiresGroupBy': 'グループ後の絞り込みには、先にグループ化フィールドの設定が必要です',
  'errMsg.havingUnsupported': 'グループ後の絞り込み条件をエンジンが処理できません。右辺を定数にするか、条件を簡略化してください',
  'errMsg.havingRightOperandNonConst': 'グループ後の絞り込み条件は右辺に定数のみ使用できます。固定の数値やテキストに変更してください',
  'errMsg.automaticRowMatchMultiSourceInvalid': 'ソーステーブルが複数あるため、自動的に一致するテーブルを特定できません。単一のソーステーブルを使用するか、手動で照合条件を設定してください',
  'errMsg.autoRecordIDShapeInvalid': '自動関連付けは同一テンプレートの主テーブルと明細テーブルの内部結合のみ対応しています。テーブルの役割を確認するか、結合条件を手動で設定してください',

  'errMsg.writeTargetCannotBeView': '書き込み対象にビューを指定することはできません。ビューは書き込み（追加/更新/削除）に対応していません。データテーブルを選択してください',

  // ── fieldMultiPick.* ──
  // 「未対応」は既存 drawer.fieldTypeUnsupported を再利用；キャンセル/削除は common.cancel/common.delete、
  // 最大化/復元は dialog.maximize/dialog.restore、空状態は editor.dockNoMatch/picker.selectHint を再利用。
  'fieldMultiPick.title': '列を一括追加',
  'fieldMultiPick.searchPlaceholder': 'フィールドを検索',
  'fieldMultiPick.selectAll': 'すべて選択',
  'fieldMultiPick.deselectAll': '選択解除',
  'fieldMultiPick.added': '追加済み',
  // 「N 列を追加します」の連結：本パッケージの t() は引数の埋め込みを行わない（picker.selected/
  // picker.confirm と同じ方式）ため、前後をそれぞれローカライズし、数字はコンポーネント側で挿入する。
  'fieldMultiPick.willAddPrefix': '追加予定：',
  'fieldMultiPick.willAddUnit': ' 列',
  'fieldMultiPick.columnNameHint': '列名は既定でフィールド名、追加後に変更できます',
  'fieldMultiPick.confirmPrefix': '追加 ',
  'fieldMultiPick.confirmUnit': ' 列',

  // ── v4.*（アリス(表达式引擎) V4 エンジン デモ編集パネル、src/v4/）───────────────────
  'v4.tabStaging': 'ステージング',
  'v4.stagingEmpty': 'ステージング列がありません',
  'v4.diagnosticsTitle': '診断情報',
  'v4.diagnosticsEmpty': '診断情報はありません',
  'v4.diagnosing': 'チェック中…',
  'v4.textareaPlaceholder': '例：[t1].[金額] > 100',
  'v4.operatorsLabel': '演算子',
  'v4.keywordsLabel': 'キーワード',
  // T6 リワーク：関数バーのグループ見出しをローカライズ（以前はサーバーの category 生値を表示）。
  'v4.functionCategory.aggregate': '集計',
  'v4.functionCategory.scalar': 'スカラー',
  'v4.functionCategory.construct': '構成関数'
} as const;
