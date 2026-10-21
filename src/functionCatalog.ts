/**
 * 文本模式函数/关键字目录——**唯一真相来源**。
 *   - 聚合 sum/avg/min/max/count + 行数 COUNT(*)；
 *   - 规范构造 coalesce/concat；
 *   - 2026-10-10：别名式聚合 count_distinct「去重计数」（不进函数注册表，
 *     v4/bind 绑到注册表 fn.count + DISTINCT）与注册表标量 week_start「周初」（周一起算）——与服务端取数编辑面
 *     清单 extractV4FunctionCatalog 同批加入；两者与 day/upper 等一样，旧 lower-text（textmodel）链路尚未收录，
 *     那条链路下按「函数暂不支持」安全拒绝，V4 编辑面（v4/bind）可直接绑定；
 *   - CASE WHEN 结构（关键字片段）。
 *
 * labelKey/descKey 是多语言键而非文案：本包 t() 走 host 注入或包内四语言表（见 host.ts useT），
 * 目录本身不持有任何语言的字面量。
 *
 * 🔴 `snip` 的光标回退语义**必须保持**：OperatorFunctionBar.insertFunc 与 AdvancedExpressionPanel
 * .onBarInsert/onPickFunction 都按「以 "()" 结尾 → 回退 1 落到括号内」判定，改动 snip 尾部形态会
 * 静默改变光标落点。
 */
import { computed, inject, type ComputedRef } from 'vue';
import { EXPRESSION_HOST } from './host';

/** 文本模式别名所属的语言包：服务端只有 zh-CN / en-US 两套可移植包（zh-TW→zh-CN、ja-JP→en-US）。 */
export type TextPackLang = 'zh' | 'en';

/** 由 BCP-47 显示语言算出文本模式该用哪套别名（与 host.ts pickLocaleTable 的中文判定同口径：
 *  任何 zh-* 都落中文包，其余落英文包——服务端 ja-JP 回落 en-US，所以日文界面插英文别名是正确行为）。 */
export function textPackLangOf(locale: string | undefined): TextPackLang {
  const lower = (locale ?? '').toLowerCase();
  return lower.startsWith('zh') ? 'zh' : 'en';
}

/** 函数目录的展示分类；执行语义仍由 semanticId/loweredName 决定，本字段只服务于分类选择界面。 */
export type FunctionCatalogCategory = 'aggregate' | 'numeric' | 'text' | 'dateTime' | 'conditional';

/** 一条函数目录项：既有 key/labelKey/descKey/snip 外补充展示分类；原消费方可忽略新增字段。 */
export interface FunctionCatalogItem {
  /** 稳定标识（用于选中态比对、v-for key），与 snip 解耦以免改片段就丢选中。 */
  key: string;
  /** 展示名的多语言键。 */
  labelKey: string;
  /** 说明文案的多语言键。 */
  descKey: string;
  /** 展示分类，供条件表达式弹窗的「更多」面板按类型分组。 */
  category: FunctionCatalogCategory;
  /** 插入到编辑框的片段（已按语言包选好别名）。 */
  snip: string;
}

/** 目录源条目：两套别名 + 语义 ID（alice 注册表 / V1 短名），snip 由 textFunctionCatalog() 按语言生成。 */
interface TextFunctionSpec {
  key: string;
  /** alice 语义 ID（注册表标量函数 fn.*，聚合/规范构造同样是 fn.*）。 */
  semanticId: string;
  loweredName: string;
  labelKey: string;
  descKey: string;
  category: FunctionCatalogCategory;
  alias: Record<TextPackLang, string>;
  /** 无参函数（行数()）：snip 仍以 "()" 结尾，光标回退 1 落进括号（与有参函数一致，用户可直接继续）。 */
  noArgs?: boolean;
}

/** 函数目录源表（顺序即函数树/函数条展示顺序）。 */
const TEXT_FUNCTION_SPECS: readonly TextFunctionSpec[] = [
  { key: 'sum', semanticId: 'fn.sum', loweredName: 'sum', labelKey: 'operatorBar.fnSum', descKey: 'operatorBar.fnDescSum', category: 'aggregate', alias: { zh: '合计', en: 'SUM' } },
  { key: 'count', semanticId: 'fn.count', loweredName: 'count', labelKey: 'operatorBar.fnCount', descKey: 'operatorBar.fnDescCount', category: 'aggregate', alias: { zh: '计数', en: 'COUNT' } },
  { key: 'count_star', semanticId: 'fn.count_star', loweredName: 'count', labelKey: 'operatorBar.fnCountStar', descKey: 'operatorBar.fnDescCountStar', category: 'aggregate', alias: { zh: '行数', en: 'ROW_COUNT' }, noArgs: true },
  { key: 'count_distinct', semanticId: 'fn.count_distinct', loweredName: 'count_distinct', labelKey: 'operatorBar.fnCountDistinct', descKey: 'operatorBar.fnDescCountDistinct', category: 'aggregate', alias: { zh: '去重计数', en: 'COUNT_DISTINCT' } },
  { key: 'avg', semanticId: 'fn.avg', loweredName: 'avg', labelKey: 'operatorBar.fnAvg', descKey: 'operatorBar.fnDescAvg', category: 'aggregate', alias: { zh: '平均', en: 'AVG' } },
  { key: 'min', semanticId: 'fn.min', loweredName: 'min', labelKey: 'operatorBar.fnMin', descKey: 'operatorBar.fnDescMin', category: 'aggregate', alias: { zh: '最小', en: 'MIN' } },
  { key: 'max', semanticId: 'fn.max', loweredName: 'max', labelKey: 'operatorBar.fnMax', descKey: 'operatorBar.fnDescMax', category: 'aggregate', alias: { zh: '最大', en: 'MAX' } },
  { key: 'concat', semanticId: 'fn.concat', loweredName: 'concat', labelKey: 'operatorBar.fnConcat', descKey: 'operatorBar.fnDescConcat', category: 'text', alias: { zh: '连接文本', en: 'CONCAT' } },
  { key: 'coalesce', semanticId: 'fn.coalesce', loweredName: 'coalesce', labelKey: 'operatorBar.fnCoalesce', descKey: 'operatorBar.fnDescCoalesce', category: 'conditional', alias: { zh: '空值替换', en: 'COALESCE' } },
  { key: 'abs', semanticId: 'fn.abs', loweredName: 'fn.abs', labelKey: 'operatorBar.fnAbs', descKey: 'operatorBar.fnDescAbs', category: 'numeric', alias: { zh: '绝对值', en: 'ABS' } },
  { key: 'charindex', semanticId: 'fn.charindex', loweredName: 'fn.charindex', labelKey: 'operatorBar.fnCharindex', descKey: 'operatorBar.fnDescCharindex', category: 'text', alias: { zh: '查找位置', en: 'CHARINDEX' } },
  { key: 'datediff', semanticId: 'fn.datediff', loweredName: 'fn.datediff', labelKey: 'operatorBar.fnDatediff', descKey: 'operatorBar.fnDescDatediff', category: 'dateTime', alias: { zh: '日期差', en: 'DATEDIFF' } },
  { key: 'dateadd', semanticId: 'fn.dateadd', loweredName: 'fn.dateadd', labelKey: 'operatorBar.fnDateadd', descKey: 'operatorBar.fnDescDateadd', category: 'dateTime', alias: { zh: '日期加', en: 'DATEADD' } },
  { key: 'year', semanticId: 'fn.year', loweredName: 'fn.year', labelKey: 'operatorBar.fnYear', descKey: 'operatorBar.fnDescYear', category: 'dateTime', alias: { zh: '年份', en: 'YEAR' } },
  { key: 'month', semanticId: 'fn.month', loweredName: 'fn.month', labelKey: 'operatorBar.fnMonth', descKey: 'operatorBar.fnDescMonth', category: 'dateTime', alias: { zh: '月份', en: 'MONTH' } },
  { key: 'year_month', semanticId: 'fn.year_month', loweredName: 'fn.year_month', labelKey: 'operatorBar.fnYearMonth', descKey: 'operatorBar.fnDescYearMonth', category: 'dateTime', alias: { zh: '年月', en: 'YEAR_MONTH' } },
  { key: 'year_month_day', semanticId: 'fn.year_month_day', loweredName: 'fn.year_month_day', labelKey: 'operatorBar.fnYearMonthDay', descKey: 'operatorBar.fnDescYearMonthDay', category: 'dateTime', alias: { zh: '年月日', en: 'YEAR_MONTH_DAY' } },
  { key: 'month_start', semanticId: 'fn.month_start', loweredName: 'fn.month_start', labelKey: 'operatorBar.fnMonthStart', descKey: 'operatorBar.fnDescMonthStart', category: 'dateTime', alias: { zh: '月初', en: 'MONTH_START' } },
  { key: 'quarter_start', semanticId: 'fn.quarter_start', loweredName: 'fn.quarter_start', labelKey: 'operatorBar.fnQuarterStart', descKey: 'operatorBar.fnDescQuarterStart', category: 'dateTime', alias: { zh: '季初', en: 'QUARTER_START' } },
  { key: 'year_start', semanticId: 'fn.year_start', loweredName: 'fn.year_start', labelKey: 'operatorBar.fnYearStart', descKey: 'operatorBar.fnDescYearStart', category: 'dateTime', alias: { zh: '年初', en: 'YEAR_START' } },
  { key: 'week_start', semanticId: 'fn.week_start', loweredName: 'fn.week_start', labelKey: 'operatorBar.fnWeekStart', descKey: 'operatorBar.fnDescWeekStart', category: 'dateTime', alias: { zh: '周初', en: 'WEEK_START' } },
  { key: 'round', semanticId: 'fn.round', loweredName: 'fn.round', labelKey: 'operatorBar.fnRound', descKey: 'operatorBar.fnDescRound', category: 'numeric', alias: { zh: '四舍五入', en: 'ROUND' } },
  { key: 'len', semanticId: 'fn.len', loweredName: 'fn.len', labelKey: 'operatorBar.fnLen', descKey: 'operatorBar.fnDescLen', category: 'text', alias: { zh: '长度', en: 'LEN' } },
  { key: 'left', semanticId: 'fn.left', loweredName: 'fn.left', labelKey: 'operatorBar.fnLeft', descKey: 'operatorBar.fnDescLeft', category: 'text', alias: { zh: '左截取', en: 'LEFT' } },
  { key: 'right', semanticId: 'fn.right', loweredName: 'fn.right', labelKey: 'operatorBar.fnRight', descKey: 'operatorBar.fnDescRight', category: 'text', alias: { zh: '右截取', en: 'RIGHT' } },
  { key: 'replace', semanticId: 'fn.replace', loweredName: 'fn.replace', labelKey: 'operatorBar.fnReplace', descKey: 'operatorBar.fnDescReplace', category: 'text', alias: { zh: '替换', en: 'REPLACE' } },
  { key: 'trim', semanticId: 'fn.trim', loweredName: 'fn.trim', labelKey: 'operatorBar.fnTrim', descKey: 'operatorBar.fnDescTrim', category: 'text', alias: { zh: '去空格', en: 'TRIM' } },
  { key: 'upper', semanticId: 'fn.upper', loweredName: 'fn.upper', labelKey: 'operatorBar.fnUpper', descKey: 'operatorBar.fnDescUpper', category: 'text', alias: { zh: '大写', en: 'UPPER' } },
  { key: 'lower', semanticId: 'fn.lower', loweredName: 'fn.lower', labelKey: 'operatorBar.fnLower', descKey: 'operatorBar.fnDescLower', category: 'text', alias: { zh: '小写', en: 'LOWER' } },
  { key: 'ltrim', semanticId: 'fn.ltrim', loweredName: 'fn.ltrim', labelKey: 'operatorBar.fnLtrim', descKey: 'operatorBar.fnDescLtrim', category: 'text', alias: { zh: '左去空格', en: 'LTRIM' } },
  { key: 'rtrim', semanticId: 'fn.rtrim', loweredName: 'fn.rtrim', labelKey: 'operatorBar.fnRtrim', descKey: 'operatorBar.fnDescRtrim', category: 'text', alias: { zh: '右去空格', en: 'RTRIM' } },
  { key: 'substring', semanticId: 'fn.substring', loweredName: 'fn.substring', labelKey: 'operatorBar.fnSubstring', descKey: 'operatorBar.fnDescSubstring', category: 'text', alias: { zh: '截取', en: 'SUBSTRING' } },
  { key: 'floor', semanticId: 'fn.floor', loweredName: 'fn.floor', labelKey: 'operatorBar.fnFloor', descKey: 'operatorBar.fnDescFloor', category: 'numeric', alias: { zh: '向下取整', en: 'FLOOR' } },
  { key: 'ceiling', semanticId: 'fn.ceiling', loweredName: 'fn.ceiling', labelKey: 'operatorBar.fnCeiling', descKey: 'operatorBar.fnDescCeiling', category: 'numeric', alias: { zh: '向上取整', en: 'CEILING' } },
  { key: 'day', semanticId: 'fn.day', loweredName: 'fn.day', labelKey: 'operatorBar.fnDay', descKey: 'operatorBar.fnDescDay', category: 'dateTime', alias: { zh: '日', en: 'DAY' } },
  { key: 'nullif', semanticId: 'fn.nullif', loweredName: 'nullif', labelKey: 'operatorBar.fnNullif', descKey: 'operatorBar.fnDescNullif', category: 'conditional', alias: { zh: '相等置空', en: 'NULLIF' } },
  { key: 'iif', semanticId: 'fn.iif', loweredName: 'iif', labelKey: 'operatorBar.fnIif', descKey: 'operatorBar.fnDescIif', category: 'conditional', alias: { zh: '条件取值', en: 'IIF' } }
];

/** CASE 结构的关键字片段。
 *  不以 "()" 结尾 → 光标落在片段末尾（与改造前 CASE 片段行为一致）。 */
const CASE_SNIP: Record<TextPackLang, string> = {
  zh: '分支 当  则  否则  结束',
  en: 'CASE WHEN  THEN  ELSE  END'
};

export interface TextKeywordItem {
  key:
    | 'and'
    | 'or'
    | 'contains'
    | 'starts_with'
    | 'ends_with'
    | 'not_contains'
    | 'in'
    | 'not_in'
    | 'between'
    | 'not_between'
    | 'is_null'
    | 'is_not_null'
    | 'not';
  labelKey: string;
  symbol: Record<TextPackLang, string>;
}
export const TEXT_KEYWORDS: readonly TextKeywordItem[] = [
  { key: 'and', labelKey: 'cond.and', symbol: { zh: '并且', en: 'AND' } },
  { key: 'or', labelKey: 'cond.or', symbol: { zh: '或者', en: 'OR' } },
  { key: 'contains', labelKey: 'operatorBar.opLike', symbol: { zh: '包含', en: 'CONTAINS' } },
  { key: 'starts_with', labelKey: 'operatorBar.opLikeStarts', symbol: { zh: '开头是', en: 'STARTS_WITH' } },
  { key: 'ends_with', labelKey: 'operatorBar.opLikeEnds', symbol: { zh: '结尾是', en: 'ENDS_WITH' } },
  { key: 'not_contains', labelKey: 'operatorBar.opNotLike', symbol: { zh: '不 包含', en: 'NOT CONTAINS' } },
  { key: 'in', labelKey: 'operatorBar.opIn', symbol: { zh: '属于', en: 'IN' } },
  { key: 'not_in', labelKey: 'operatorBar.opNotIn', symbol: { zh: '不 属于', en: 'NOT IN' } },
  { key: 'between', labelKey: 'cond.opBetween', symbol: { zh: '介于', en: 'BETWEEN' } },
  { key: 'not_between', labelKey: 'cond.opNotBetween', symbol: { zh: '不 介于', en: 'NOT BETWEEN' } },
  { key: 'is_null', labelKey: 'cond.opIsNull', symbol: { zh: '为 空值', en: 'IS NULL' } },
  { key: 'is_not_null', labelKey: 'cond.opIsNotNull', symbol: { zh: '为 不 空值', en: 'IS NOT NULL' } },
  { key: 'not', labelKey: 'cond.negate', symbol: { zh: '不', en: 'NOT' } }
];

/** 按语言包生成函数目录（含 CASE 片段）。纯函数，供单测与非组件上下文直接调用。 */
export function textFunctionCatalog(lang: TextPackLang): FunctionCatalogItem[] {
  const items: FunctionCatalogItem[] = TEXT_FUNCTION_SPECS.map(spec => ({
    key: spec.key,
    labelKey: spec.labelKey,
    descKey: spec.descKey,
    category: spec.category,
    snip: `${spec.alias[lang]}()`
  }));
  items.push({ key: 'case', labelKey: 'operatorBar.fnCase', descKey: 'operatorBar.fnDescCase', category: 'conditional', snip: CASE_SNIP[lang] });
  return items;
}

/** 降级后的函数名（ValueRef.name：sum/avg/…/fn.year/…）→ 当前语言包主别名；查不到返回 null。
 *  供 rawSerialize 把无 text_source 的结构化 func 节点反写成文本时使用（反写是 best-effort，见那边注释）。 */
export function textFunctionAliasOf(loweredName: string, lang: TextPackLang): string | null {
  const name = loweredName.toLowerCase();
  // count 与 count_star 降级后同名（count）；反写时优先普通 count（带参形态更通用）。
  const spec = TEXT_FUNCTION_SPECS.find(s => s.loweredName === name && !s.noArgs) ?? TEXT_FUNCTION_SPECS.find(s => s.loweredName === name);
  return spec ? spec.alias[lang] : null;
}

/**
 * 组件内取「跟随宿主语言」的函数目录（响应式）：host.locale() 每次渲染现取，宿主切语言后目录跟随。
 * inject 带 null 默认值——本目录也在缺 provider 的环境（单测/表格编辑器字段控件）里被消费，此时回落中文包。
 */
export function useTextFunctionCatalog(): ComputedRef<FunctionCatalogItem[]> {
  const host = inject(EXPRESSION_HOST, null);
  return computed(() => textFunctionCatalog(textPackLangOf(host?.locale?.())));
}

export const DEFAULT_FUNCTION_CATALOG: readonly FunctionCatalogItem[] = textFunctionCatalog('zh');
