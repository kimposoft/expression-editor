/**
 *
 * 一份文档 = 一份共享查询（来源 / 关联 / 筛选 / 选项，与取数节点同构的 V4QueryDefinition）+ N 列输出
 * （column_id 稳定键 / name 显示名 / expression，与暂存列同构）+ 可选排序 + 可选关键字搜索 + 可选级联分层。
 * 落点：select / radio / checkbox 在 `source_inline.query_v4`；list / cascader 在 `props.query_v4`；
 * list 多套在 `props.variants[i].query_v4`。
 */
import type { V4ExpressionDocument } from './definition';
import type { V4QueryDefinition } from './nodeDocument';

export const CONTROL_QUERY_DOCUMENT_SCHEMA_VERSION = 'kimpo.control-query/v4';

/** 级联组织方式：分级列 / 自引用树 / 编码分段（与表格编辑器 CascaderQuery.dataMode 同值域）。 */
export type V4ControlCascadeMode = 'columns' | 'tree' | 'coded';

/** 输出列：column_id 稳定键（`^[A-Za-z0-9_]+$`，文档内唯一）、name 显示名、expression 取值表达式。 */
export interface V4ControlColumn {
  column_id: string;
  name: string;
  expression: V4ExpressionDocument;
}

/** 关键字搜索：可搜索列（column_id）+ 槽数（缺省 3，1..3）。columns 为空 ⇒ 服务端不注入关键字谓词。 */
export interface V4ControlSearchSpec {
  columns: string[];
  keyword_slots?: number;
}

/** 级联分层配置：三种组织方式各自的建树列（与 Go CascadeSpec 同名字段）。 */
/** 分组树的一级：分组列 + 树上该级节点的排列方向（缺省 asc，按「默认值省略」约定不落键）。 */
export interface V4ControlGroupLevel {
  column_id: string;
  direction?: 'asc' | 'desc';
}

/**
 * list 分组筛选树配置：按层序排列的分组级，1..8 级。
 *
 * 与 cascade **互斥**（一个文档只能有一种分层语义），但与 search **并存**——分组树要跟着
 * 关键字变，所以分组层除父路径谓词外还吃关键字槽谓词；级联各层从不吃关键字槽。
 * direction 管的是树上节点顺序，与管右表行顺序的 order_by 是两回事。
 */
export interface V4ControlGroupSpec {
  levels: V4ControlGroupLevel[];
}

export interface V4ControlCascadeSpec {
  mode: V4ControlCascadeMode;
  /** columns 模式：按层序排列的 column_id，2..8 个。 */
  level_columns?: string[];
  /** tree 模式：自身编码列 / 父编码列。 */
  self_column?: string;
  parent_column?: string;
  /** coded 模式：编码列 + 每段长度（2..8 段，每段 ≥1）。 */
  code_column?: string;
  segments?: number[];
}

/** 排序键：按输出列 column_id 指定（与 V4FillTarget.order_by 同形）。 */
export interface V4ControlOrderBy {
  target_field_id: string;
  direction: 'asc' | 'desc';
}

export interface V4ControlQueryDocument {
  schema_version: 'kimpo.control-query/v4';
  syntax_profile: 'kimposql.mssql/v1';
  query: V4QueryDefinition;
  columns: V4ControlColumn[];
  order_by?: V4ControlOrderBy[];
  search?: V4ControlSearchSpec;
  cascade?: V4ControlCascadeSpec;
  group?: V4ControlGroupSpec;
}

/** 空白控件查询文档：无来源、无列、选项缺省。 */
export function emptyControlQueryDocument(): V4ControlQueryDocument {
  return {
    schema_version: 'kimpo.control-query/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: { sources: [], joins: [], options: { distinct: true, business_timezone: 'UTC' } },
    columns: []
  };
}

/** 浅层形状守卫：对象 + schema_version 字面量 + query 为对象 + columns 为数组。深校验归宿主。 */
export function isControlQueryDocument(value: unknown): value is V4ControlQueryDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<V4ControlQueryDocument>;
  return (
    doc.schema_version === CONTROL_QUERY_DOCUMENT_SCHEMA_VERSION &&
    !!doc.query &&
    typeof doc.query === 'object' &&
    Array.isArray(doc.columns)
  );
}
