/**
 * stagingSourceLite —— 独立调用方（不持有完整 model.source.tables 语境）把「上一步暂存区」列表
 * 合成为 SourceTableLite 的最小口径。
 *
 * 背景：暂存来源目前只有 ExpressionEditor.vue 一条挂载路（stagingSource prop → sourceTablesForInput
 * 的 st.source_type === 'staging' 分支，见该文件同名注释）——流程设计器的条件表达式走的是
 * ConditionEditorDialog.vue → ExpressionDialogShell.vue → AdvancedExpressionPanel.vue 这条路，
 * 该路只吃 sourceTables/formTables/dockColumns，没有 model.source.tables 那套「登记来源表」的概念，
 * 也就没有对应的真实来源别名。本函数补的是同一份合成口径的独立版本，供这类场景直接拼一条
 * SourceTableLite 追加进 sourceTables 数组。
 *
 * alias/dataTableId 恒 '__staging__'（与 ExpressionEditor.vue 那条路一致）：暂存来源是「虚拟单表」，
 * 一次编辑会话至多一张，不需要按模型里的真实别名区分同表多实例；bracketText.ts
 * （valueRefToBracketText source_field 分支）与 kimpoSqlRefCompletion.ts（buildReferenceCandidates）
 * 均已按 `source.dataTableId === '__staging__'` 判定走保留前缀 `暂存表.[列]` 写法，本函数产出的
 * SourceTableLite 天然命中这两处既有分支，不需要新增判据。
 */
import type { SourceTableLite } from './rawSerialize';
import { stagingColumnToTemplateField } from './useExpressionContext';

/** 「上一步暂存区」列表的最小形状（与 ExpressionEditor.vue stagingSource prop 的 producerLabel/columns
 *  两个字段同构；不带 producerNodeId——那个字段在原 prop 上也仅供展示/防越步，不进 SourceTableLite）。 */
export interface StagingSourceLite {
  producerLabel: string;
  columns: Array<{ code: string; name: string; type?: string }>;
}

/**
 * 把 StagingSourceLite 合成为 SourceTableLite。fields 经 stagingColumnToTemplateField 逐列适配——
 * type 不在其内部 VIEW_COLUMN_DATA_TYPES 白名单（text/number/boolean/date/datetime）内、或缺失时，
 * 沿用该函数既有的兜底规则回落 'text'（与 view 来源同一口径），本函数不重复实现这条判定。
 */
export function stagingSourceToSourceTableLite(s: StagingSourceLite): SourceTableLite {
  return {
    alias: '__staging__',
    dataTableId: '__staging__',
    name: s.producerLabel,
    fields: s.columns.map(stagingColumnToTemplateField)
  };
}
