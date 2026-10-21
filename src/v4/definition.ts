/**
 * V4（表达式引擎(表达式引擎) V4 引擎）取数动作 —— 持久化定义模型（ExtractDefinitionV4 文档形状）的 TS 等价类型。
 *
 * 本子目录（src/v4/）与包内既有 ExpressionHost/types.ts 完全独立并存——不改动、不复用后者的任何
 * 已有导出语义（沿用 ./types.ts 头注释里的约定）。
 */
import type { V4Purpose } from './types';

export interface V4ExpressionRefWire {
  ref_id: string;
  kind: 'source_field' | 'report_field' | 'staging_field' | 'system_var';
  source_instance_id?: string;
  table_id?: string;
  field_id?: string;
  producer_node_id?: string;
  staging_column_id?: string;
  /** 最近一次成功绑定时的完整显示格式快照，仅供引用失效时墓碑显示。 */
  last_label: string;
}

export interface V4SourceBindingCatalog {
  kind: 'catalog';
  instance_id: string;
  alias: string;
  app_id: string;
  template_id: string;
  data_table_id: string;
}

/** 本报表来源（D 卡新增）：table_role 为该表在当前表单里的角色（主表/明细）。 */
export interface V4SourceBindingReport {
  kind: 'report';
  instance_id: string;
  alias: string;
  table_id: string;
  table_role: 'main' | 'detail';
}

/** 暂存表来源（D 卡新增）：producer_node_id/output_schema_revision 首版固定常量
 *  'staging_area'/'v1'，本类型仅为透传服务端 schema 的可读字段名。 */
export interface V4SourceBindingStaging {
  kind: 'staging';
  instance_id: string;
  alias: string;
  producer_node_id: string;
  output_schema_revision: string;
}

/**
 * 单位行来源：写动作新增数据节点在设计态不选择
 * 任何来源时，包装层给引擎定义挂一个恒一行、零列、不物化的合成根，供常量/系统变量输出表达式落
 * 脚。除 kind/instance_id/alias 三个公共字段外不携带任何专属字段——instance_id 形态固定
 * `unit-<6位hex>`（服务端 schema pattern `^unit-`）。
 */
export interface V4SourceBindingUnit {
  kind: 'unit';
  instance_id: string;
  alias: string;
}

export interface V4SourceBindingView {
  kind: 'view';
  instance_id: string;
  alias: string;
  app_id: string;
  view_id: string;
}

export interface V4SourceBindingExternal {
  kind: 'external';
  instance_id: string;
  alias: string;
  app_id: string;
  external_stable_id: string;
}

export type V4SourceBinding =
  | V4SourceBindingCatalog
  | V4SourceBindingReport
  | V4SourceBindingStaging
  | V4SourceBindingUnit
  | V4SourceBindingView
  | V4SourceBindingExternal;

/** purpose=join_on/filter/output 共用的表达式文档形状。 */
export interface V4ExpressionDocument {
  expression_id: string;
  purpose: V4Purpose;
  /** token 化源码：字段引用一律为 `[标签]#{rN}` 组合形态；保存前必须已全部绑定（tokenize 产物）。 */
  source_text: string;
  refs: V4ExpressionRefWire[];
  /** 最近一次成功绑定的语义摘要（服务端计算，客户端只读回显）。 */
  normalized_digest?: string;
}

export interface V4JoinDefinition {
  join_id: string;
  sequence: number;
  left_instance_id: string;
  right_instance_id: string;
  join_type: 'inner' | 'left';
  on: V4ExpressionDocument;
}

export interface V4OutputDefinition {
  target_field_id: string;
  expression: V4ExpressionDocument;
  /** 输出列显示名（D 卡追加：服务端 schema/definition 包同步新增）——Encode 保留、Digest 排除，
   *  编译时 TargetLabel 取 label，未提供则回退 target_field_id。可选：留空表示不特别指定显示名。 */
  label?: string;
}

export interface V4ExtractDefinitionOptions {
  distinct: boolean;
  take?: number;
  order_by?: Array<{ target_field_id: string; direction: 'asc' | 'desc' }>;
  business_timezone: string;
}

export interface V4ExtractDefinition {
  schema_version: 'alice.extract/v4';
  syntax_profile: 'kimposql.mssql/v1';
  definition_id: string;
  revision: number;
  label?: string;
  sources: V4SourceBinding[];
  joins: V4JoinDefinition[];
  filter?: V4ExpressionDocument;
  outputs: V4OutputDefinition[];
  options: V4ExtractDefinitionOptions;
}
