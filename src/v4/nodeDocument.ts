/**
 * V4（表达式引擎(表达式引擎) V4 引擎）取数节点文档（ExtractNodeDocumentV4 文档形状）的 TS 等价类型。
 *
 * 本子目录（src/v4/）与包内既有 ExpressionHost/types.ts 完全独立并存——不改动、不复用后者的任何
 * 已有导出语义（沿用 ./types.ts 头注释里的约定）。
 */
import type { V4SourceBinding, V4JoinDefinition, V4ExpressionDocument } from './definition';

/** 取数节点文档 schema_version 字面量常量，供构造/校验处直接引用，避免各处手写字符串走样。 */
export const NODE_DOCUMENT_SCHEMA_VERSION = 'kimpo.extract-node/v4';

/** 目标表角色：主表（全局唯一一行）/ 明细（可多行）。 */
export type V4TableRole = 'main' | 'detail';

/** 清空方式：none=不清空；mapped=清映射字段（本目标输出列，匹配键列除外）；
 *  all=清整表（仅明细目标可选，主表目标不得取该值——见 V4FillTarget 头注释）。 */
export type V4ClearMode = 'none' | 'mapped' | 'all';

/** 清空时机：before=取值前先清；after=取值后与查询并发清空。 */
export type V4ClearTiming = 'before' | 'after';

/** 清空规则（mode+timing 成对出现，缺省即整段不出现，与旧「未配置」同形）。 */
export interface V4ClearSpec {
  mode: V4ClearMode;
  timing: V4ClearTiming;
}

/** 填充策略：overwrite=覆盖；merge=合并（配合 separator）；row_match=按行列匹配（该输出行即匹配键，
 *  不另设 match_keys 字段）。V4 首版不支持 append（追加），故联合类型不含该值。 */
export type V4FillStrategy = 'overwrite' | 'merge' | 'row_match';

/** 一条填充输出（目标表的一个字段）。 */
export interface V4FillOutput {
  target_field_id: string;
  /** 输出列显示名，可选，留空回退 target_field_id。 */
  label?: string;
  expression: V4ExpressionDocument;
  fill_strategy: V4FillStrategy;
  /** 仅 fill_strategy='merge' 时可填，取值见 SEPARATOR_PRESETS（./targetOptions.ts）。 */
  separator?: string;
}

/** 一个填充目标（一张目标表）。 */
export interface V4FillTarget {
  target_id: string;
  target_data_table_id: string;
  table_role: V4TableRole;
  outputs: V4FillOutput[];
  /** 清空规则：主表目标不得 mode='all'（前端便利过滤，真正拒绝闸在后端）。 */
  clear?: V4ClearSpec;
  /** 自动按行列匹配：三态——缺省/true=开，显式 false=关（服务端 extractdoc.FillTarget.AutoRowMatch
   *  *bool 同口径）。开时服务端在展开期把筛选里「来源字段 = 本报表明细字段」等式作为该字段的匹配键（等式保留在
   *  筛选里、文档不被改写）；关则只认手动 fill_strategy='row_match'。V4 编辑器：开=删字段、关=写 false。 */
  auto_row_match?: boolean;
  /** 执行后清理空行：填充写回后删除该表末尾连续空行，下限保留 2 行。
   *  仅 table_role='detail' 可为 true（后端 extractdoc 校验强制）。 */
  trim_empty_rows_after_fill?: boolean;
  /** 逐目标「排除重复」：展开后落到本目标引擎定义的
   *  options.distinct（按本目标输出列判重）；未提供时服务端按产品默认视为 true。
   *  编辑器新建目标恒写 true。 */
  distinct?: boolean;
  /** 逐目标「仅限前 N 条」：>=1 限量；显式 0=本目标不限（覆盖查询级限量）；未提供=服务端回退
   *  query.options.take。编辑器保存恒显式写（不限写 0）。 */
  take?: number;
  order_by?: Array<{ target_field_id: string; direction: 'asc' | 'desc' }>;
}

export interface V4QueryOptions {
  distinct: boolean;
  take?: number;
  business_timezone: 'UTC';
}

/** 查询定义（来源 + 关联 + 筛选 + 选项）。 */
export interface V4QueryDefinition {
  sources: V4SourceBinding[];
  joins: V4JoinDefinition[];
  filter?: V4ExpressionDocument;
  options: V4QueryOptions;
}

/** 图表形态：分类系列 / 名值对 / 散点。 */
export type V4ChartForm = 'categorySeries' | 'nameValue' | 'points';

/** 图表布局：宽表 / 长表。 */
export type V4ChartLayout = 'wide' | 'long';

/** 图表聚合方式。 */
export type V4ChartAggregate = 'sum' | 'avg' | 'count' | 'max' | 'min' | 'first';

/** categorySeries 形态下 values 数组的一项：一个系列名 + 对应表达式。 */
export interface V4ChartValueSlot {
  name_key: string;
  expression: V4ExpressionDocument;
}

/** 图表槽位：按 chart_form 不同，实际只会用到其中一部分槽位（其余留空）。 */
export interface V4ChartSlots {
  category?: V4ExpressionDocument;
  series?: V4ExpressionDocument;
  value?: V4ExpressionDocument;
  name?: V4ExpressionDocument;
  x?: V4ExpressionDocument;
  y?: V4ExpressionDocument;
  values?: V4ChartValueSlot[];
}

/** 一个图表目标（填充到某图表）。 */
export interface V4ChartTarget {
  chart_id: string;
  chart_form: V4ChartForm;
  layout?: V4ChartLayout;
  row_limit?: number;
  aggregate?: V4ChartAggregate;
  slots: V4ChartSlots;
}

/** 取数节点文档（ExtractNodeDocumentV4 文档形状 TS 等价类型）。 */
export interface V4ExtractNodeDocument {
  schema_version: 'kimpo.extract-node/v4';
  syntax_profile: 'kimposql.mssql/v1';
  query: V4QueryDefinition;
  targets: V4FillTarget[];
  chart_targets?: V4ChartTarget[];
  /** 暂存目标（可空）：把本次查询结果写进暂存区，供画布下一步节点当来源读。
   *  顶层单字段——「一次取数至多一个暂存目标」由形状天然保证，无需校验；且 targets 保持
   *  「填充目标」的纯粹语义，各遍历点不必到处过滤（与服务端 extractdoc.StagingTarget 同形）。 */
  staging_target?: V4StagingTarget;
}

/** 暂存目标：列名 + 取值表达式。没有清空/匹配键/填充方式的概念——查出什么存什么。 */
export interface V4StagingTarget {
  columns: V4StagingColumn[];
}

/** 暂存区的一列：column_id/name 两个键各司其职，
 *  不再由 name 一字兼顶物理列名——name 只是显示名，任意非空文本、目标内唯一（trim 后比较），
 *  不进 DDL、不做字符白名单。 */
export interface V4StagingColumn {
  /** 稳定键：编辑器新增列时生成 `col_<8hex>`、改显示名不变；`^[A-Za-z0-9_]+$`、目标内唯一、
   *  不得撞系统列（alice_row_id/alice_src_record_id/alice_src_version_no，大小写不敏感）。
   *  唯一进临时表 DDL 的物理列名，也是下游 staging_field.staging_column_id 的定位键。存量文档缺省，解码层回填为 name。 */
  column_id?: string;
  /** 显示名：任意非空文本，只用于界面与「暂存表.[显示名]」文本引用的解析，不进 DDL。 */
  name: string;
  expression: V4ExpressionDocument;
}
