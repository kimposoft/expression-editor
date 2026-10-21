/**
 * 统一表达式中间模型。
 */

// TextSource.v4 随身包用：纯类型导入（import type 编译期整体擦除），
// 与 ./v4/definition.ts 反向 `import type { V4Purpose } from './v4/types'` 一样不产生运行时循环。
import type { V4ExpressionRefWire } from './v4/definition';

// ── 模板相关类型（来自 template.ts，供 ExpressionHost 接口与组件使用）────────────────

export type DesignerType = 'spreadsheet' | 'canvas-form' | 'flow-form';
export type TemplateStatusCode = 'draft' | 'active' | 'inactive';

export interface Template {
  template_id: string;
  template_code: string;
  template_name: string;
  template_description: string;
  designer_type: DesignerType;
  plugin_id?: string;
  plugin_instance_id?: string;
  folder_node_id: string;
  folder_node_name: string;
  folder_node_path: string;
  status_code: TemplateStatusCode;
  active_version_no: string;
  latest_version_no: string;
  version_no: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateListParams {
  node_key?: string;
  recursive?: boolean;
  q?: string;
  designer_type?: DesignerType;
  status_code?: TemplateStatusCode;
}

export interface TemplateDataTable {
  data_table_id: string;
  table_code: string;
  table_name: string;
  physical_table_name: string;
  /** 后端权威角色：'main'=主表，其余（如 'extension'）=明细/扩展表。
   *  角色判定须优先用它——切勿再靠 sort_no 猜（主表/明细 sort_no 会撞号，如均为 0，导致明细被误判成主表）。 */
  table_role?: string;
  /** 扩展表模式（如 'detail'）；后端下发，作角色判定的兜底信号之一。 */
  extension_mode?: string;
  sort_no: number;
  field_count: number;
  version_no: number;
}

/** 应用真实层级树节点（精简自宿主 AppTreeNode）：来源选择器据此按层级+顺序渲染、区分目录(category)/模板(resource)图标。
 *  category = 目录；resource 且 resource_type==='template' = 模板（resource_id=template_id，可展开为其数据表）。 */
export interface ExpressionTreeNode {
  node_key: string;
  node_type: 'root' | 'category' | 'resource';
  node_name: string;
  resource_type: string | null;
  resource_id: string | null;
  sort_no: number;
  resource_subtype?: string | null;
  /** 模板为查询模式时为 true。查询模式不落库、没有数据，
   *  来源添加器据此不把它列为可选数据源。 */
  query_mode?: boolean;
  children?: ExpressionTreeNode[];
}

export interface TemplateField {
  field_id: string;
  field_code: string;
  field_name: string;
  data_type: string;
  control_type?: string;
  display_style: string;
  sort_no: number;
  is_searchable: boolean;
  is_filterable: boolean;
  is_sortable: boolean;
  is_list_visible: boolean;
  format_rule_json?: Record<string, unknown> | string | null;
  option_source_json?: Record<string, unknown> | string | null;
}

// ── 表达式编译结果类型 ────────────────────────────────────────────────────────

/**
 * 预览/校验返回：valid=当前这份表达式模型能否使用；error=中文错误文案；error_code=失败分类码。
 */
export interface ExpressionPreviewResult {
  valid: boolean;
  /** @deprecated 随 表达式引擎 V1 编译器退役下线，恒为空字符串，下一版本删除。 */
  sql?: string;
  /** @deprecated 随 表达式引擎 V1 编译器退役下线，恒为 0，下一版本删除。 */
  arg_count: number;
  error?: string;
  error_code?: string;
}

// ── 表达式中间模型（原样平移，P1 不改任何字段）────────────────────────────────

/** 中间模型当前版本号，随结构演进递增。
 *  2026-09-01 硬切换：1 → 2，对齐后端 actionquery/expressionv2 已收口的严格
 *  `schema_version==2` 校验闸。本包新建模型（emptyExpressionModel）与编辑器保存输出（见
 *  ExpressionEditor.vue reconcile()）恒写本常量；打开存量 schema_version:1 文档仍按现状 reconcile
 *  正常呈现（v1 是 v2 的超集口径，结构未变），只是保存时统一升版——与后端
 *  expressionv2.UpgradeModelJSON 读取端收口的升版口径一致，两侧不再各自为战。 */
export const EXPRESSION_SCHEMA_VERSION = 2;

export type SourceType = 'template' | 'view' | 'staging' | 'other' | 'external';
/** 表在本模板内的角色，驱动「同模板主+明细自动 record_id 左关联」。 */
export type TableRole = 'main' | 'detail';

/**
 * 判定一张数据表在模板内的角色（main/detail）。
 *
 * 权威来源＝后端 `table_role`（'main'=主表；其余如 'extension' 皆为明细/扩展表），
 * 与后端编译期 `HasSystemRowNo`（物理 row_no 系统列）判定同源。
 * 仅当后端未下发 `table_role`（旧宿主桥/精简载荷）时，才回落「同模板内 sort_no 最小者为主表」的启发式——
 * 该回落在主表/明细 sort_no 撞号（如均为 0）时不可靠，故有 `table_role` 必须优先用之。
 */
export function tableRoleOf(
  table: Pick<TemplateDataTable, 'table_role' | 'sort_no'>,
  tablesInTemplate: Pick<TemplateDataTable, 'sort_no'>[]
): TableRole {
  if (table.table_role) return table.table_role === 'main' ? 'main' : 'detail';
  const minSort = tablesInTemplate.length ? Math.min(...tablesInTemplate.map(t => t.sort_no)) : 0;
  return table.sort_no === minSort ? 'main' : 'detail';
}
/**
 * 填充策略「按行列匹配」（row_match）是否对某目标可选：
 * - 主表（role='main'）恒不可选——主表全局唯一一行，不存在"该写哪一行"，按行列匹配的前提是
 *   目标侧有多行可选，只有扩展表满足；
 */
export function rowMatchStrategyAllowed(role: TableRole, autoRowMatch?: boolean): boolean {
  return role !== 'main' && !autoRowMatch;
}

/**
 * 来源字段树按 data_type 隐藏的档位。
 */
const SOURCE_TREE_HIDDEN_FIELD_DATA_TYPES: ReadonlySet<string> = new Set<string>();

export function isSourceTreeHiddenFieldDataType(dataType?: string | null): boolean {
  return SOURCE_TREE_HIDDEN_FIELD_DATA_TYPES.has((dataType ?? '').trim().toLowerCase());
}

/**
 * 判断字段 data_type 是否图片 / 附件档：后端只有一档 data_type='attachment'
 *（display_style 区分 501 单元格图片 / 502 浮动图片 / 6 附件）；'image' 一并纳入防历史 / 未来字面值。
 * 供目标字段行的类型提示、填充方式（附件不可作按行列匹配键、合并不显示分隔符）、判重键候选过滤、
 * 图表自动预指派跳过等前端便利复用——真正的拒绝闸在服务端保存闸。
 */
export function isAttachmentFieldDataType(dataType?: string | null): boolean {
  const normalized = (dataType ?? '').trim().toLowerCase();
  return normalized === 'attachment' || normalized === 'image';
}

/** 关联方式：内联合 / 左联合。 */
export type JoinType = 'inner' | 'left';
/** 比较操作符全集（对齐运算符工具条）。K1：is_null/is_not_null 为判空算子，语义上只判「左值是否为空」，
 *  没有右值——见下方 Predicate.right 因此改为可选字段。E10新增 between/not_between 区间
 *  比较算子对，语义与 SQL BETWEEN/NOT BETWEEN 一致（闭区间，两端都含）；右值改用 Predicate.right2
 *  承接区间第二端，落地规则见 isBetweenOp/applyPredicateOp。 */
export type CompareOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'like' | 'in' | 'not_in' | 'is_null' | 'is_not_null' | 'between' | 'not_between';
export type FillStrategy = 'overwrite' | 'append' | 'merge' | 'row_match';
export type ValueRefKind = 'source_field' | 'form_field' | 'system_var' | 'const' | 'func' | 'raw' | 'window' | 'case';

// ── 文本表达式 sidecar──────

/** TextSource.refs 的一项：文本里一处字段/系统变量引用的「稳定 ID + 降级当时的显示标签」。
 *  stable_id 派生规则与后端 textmodel.derivedStableID 逐字一致（见 textSource.ts derivedStableId），
 *  重开编辑器时据它反查当前字段名重绘原文（字段改名靠它解决，不靠 digest）。 */
export interface TextSourceRef {
  stable_id: string;
  label?: string;
}

export interface TextSource {
  text: string;
  locale?: string;
  input_profile?: string;
  pack_revision: string;
  refs?: TextSourceRef[];
  digest: string;
  /** V4 随身包：**仅由 V4 宿主适配器
   *  （./v4/v4ExpressionHostAdapter.ts lowerTextViaV4）写入**，承载 tokenize 返回的 token 化源码
   *  与**完整**稳定引用表。
   *  为什么要多这一份：上面的 `refs` 是 3.4 sidecar 口径，只有 `{stable_id,label}` 二元组，
   *  不足以还原 V4 绑定（kind/source_instance_id/table_id/field_id 等全丢），
   *  条件节点要存整份 V4 表达式文档，重开才不丢绑定。
   *  3.4 链路与其它读者一律忽略该字段（可选，缺省 undefined）。 */
  v4?: { source_text: string; refs: V4ExpressionRefWire[] };
}

/** lower-text 端点的用途：where=谓词根（产出 ConditionGroup）；value=取值根（产出 ValueRef）。 */
/**
 * 宿主壳挂进编辑器校验状态条的一条「文档级」通知：severity 决定档位与着色
 * （error > warning > info），where 是出处短语（如「筛选条件」「目标 采购明细」），message 是可读文案。
 * 与编辑器自身的语法三态 / 写模式定位条件拦截合成状态条同一条 label，见 ExpressionEditor.vue statusNotices。
 */
export interface ExpressionNotice {
  severity: 'error' | 'warning' | 'info';
  message: string;
  where?: string;
}

export type LowerTextPurpose = 'where' | 'value';

/** lower-text 请求体 refs[] 单项：文本里第 i 个 {…} 占位符绑定到的结构化目标（按出现顺序）。
 *  target 只允许 source_field/form_field/system_var/const 四种（后端白名单，其余具名拒绝）。 */
export interface LowerTextRef {
  label: string;
  stable_id: string;
  target: ValueRef;
}

/** lower-text 请求体（wire 形状与后端 动作网关.lowerTextRequestBody 逐字段一致）。 */
export interface LowerTextRequest {
  text: string;
  locale?: string;
  purpose: LowerTextPurpose;
  refs: LowerTextRef[];
}

/** lower-text 一条诊断：message 已按请求语言本地化（前端直接显示，不再二次映射）；
 *  rune_start/rune_end 是用户原文的 rune（码点）偏移，高亮/定位用它（start/end 是字节偏移，前端不用）。 */
export interface LowerTextDiagnostic {
  code: string;
  severity: string;
  message: string;
  start: number;
  end: number;
  rune_start: number;
  rune_end: number;
}

/** lower-text 响应体（200 与 422 共用同一形状）：成功时 text_source 非空且按 purpose 只出现 value 或
 *  condition 之一，diagnostics 为空数组；降级失败（422）时只有 diagnostics（非空）。
 *  判成功用 isLowerTextSuccess()，不要只看 diagnostics 长度。 */
export interface LowerTextResult {
  purpose: LowerTextPurpose;
  value?: ValueRef;
  condition?: ConditionGroup;
  text_source?: TextSource;
  diagnostics: LowerTextDiagnostic[];
}

/** lower-text 是否成功降级：text_source 在场且没有 error 级诊断。 */
export function isLowerTextSuccess(r: LowerTextResult): boolean {
  return !!r.text_source && !r.diagnostics.some(d => d.severity === 'error');
}

/** CASE 分支：when 成立时取 then（when 复用 ConditionGroup，与 where 同构）。 */
export interface CaseBranch {
  when: ConditionGroup;
  then: ValueRef;
}

/** 统一表达式原子：来源字段 / 本报表字段 / 系统变量 / 常量 / 函数 / 开窗 / CASE / 自由文本。按 kind 取对应字段。 */
export interface ValueRef {
  kind: ValueRefKind;
  /** source_field：来源表别名 + 字段。 */
  alias?: string;
  field_id?: string;
  /** form_field：本报表某表 + 字段。 */
  table_id?: string;
  /** system_var：系统变量 ID。 */
  var_id?: string;
  /** const：固定标量值。value===null 表示「空值」常量——真正的 JSON null，不是空字符串 ''、
   *  不是字面量文本 "NULL"、也不是 undefined（undefined=尚未填值的默认占位，语义不同，见
   *  ConditionTree.vue 的 emptyRef()）。后端 expression(v1)/expressionv2(v2) 的 ValueRef.Value
   *  均为 json.RawMessage，本就能承载 JSON null（v2 已有 isNullConst/lowerConstNull 消费点）；
   *  编译期把「字段 = 空值」归一为 IS NULL 等价形态尚未接线，本字段只是
   *  补齐前端类型面、产出正确结构，不在此处做任何前端兜底转换。 */
  value?: string | number | boolean | null;
  /** func / window：函数名（func）+ 参数（func 与 window 入参共用）。 */
  name?: string;
  args?: ValueRef[];
  text?: string;
  refs?: ValueRef[];
  /** 文本表达式 sidecar：本节点由文本模式经 lower-text 降级而来时携带，
   *  记录用户原文供重开时恢复文本模式显示；任何 kind 都可能挂它（func/case/const/字段…）。
   *  执行面永远不读它。 */
  text_source?: TextSource;
  /** window：开窗函数名 + 分区键 + 窗口排序。 */
  win_fn?: string;
  partition_by?: ValueRef[];
  win_order_by?: OrderKey[];
  /** case：多分支（按序首个命中）+ 兜底。 */
  cases?: CaseBranch[];
  else?: ValueRef;
}

/** 带别名的字段引用（join on 用）。 */
export interface FieldRef {
  alias: string;
  field_id: string;
}

export interface SourceTable {
  alias: string;
  source_type: SourceType;
  template_id: string;
  data_table_id: string;
  /** true=本报表当前表单上下文表（运行期物化为临时表参与 JOIN）。 */
  is_context: boolean;
  role?: TableRole;
  /** source_type='view' 时的视图 ID（views-frontend-b2 R7 新增，可选、向后兼容——旧调用方不传即为
   *  undefined，语义等价 source_type='template'/'other' 场景，不影响既有取数动作零感知）。 */
  view_id?: string;
  /** source_type='external' 时的外部数据表登记对象 ID。与 template_id/data_table_id/
   *  view_id 互斥（同 view/staging 约定：template_id/data_table_id 恒空串）。 */
  external_object_id?: string;
  /** 所属应用 ID（跨应用取数）：缺省/空 = 当前应用（旧模型不变）。仅 template 来源支持；
   *  后端 Validate 拒绝 is_context / view 来源携带。执行层据此跨库解析（同实例多应用库）。 */
  app_id?: string;
  /** true=写模式「目标」相关来源：承载写目标记录身份的「隐含
   *  来源」，或已被引用而正式登记的「引用即入源」候选（写目标模板配对的另一张表，主表↔扩展表）。
   *  仍是普通 `is_context:false` 的 kind=catalog 来源（V4 文档层无感知，modelToV4Query 不区分本
   *  标记），只是前端②来源面板据此换一种「目标」分组的虚线展示、且隐含来源不可手动删除；取数模式
   *  恒不设置。判定/维护口径见 ExpressionEditor.vue writeTargetSourcePlanFor 头注释。 */
  is_write_target?: boolean;
}

/** 一条关联条件：左字段 op 右字段。 */
export interface JoinPredicate {
  left: FieldRef;
  op: CompareOp;
  right: FieldRef;
}

/** 两表关联。auto_record_id=true 时由平台自动按 record_id 左关联（UI 锁定、on 为空）。 */
export interface JoinSpec {
  left_alias: string;
  right_alias: string;
  join_type: JoinType;
  auto_record_id: boolean;
  on?: JoinPredicate[];
}

/** 来源段：多表 + 关联。 */
export interface SourceSpec {
  tables: SourceTable[];
  joins: JoinSpec[];
}

/** 一条 where 谓词。right 在 op=is_null/is_not_null（判空算子，无右值）时省略——序列化不携带该字段
 * 。 */
export interface Predicate {
  left: ValueRef;
  op: CompareOp;
  right?: ValueRef;
  /** between/not_between 的第二右值（区间上界，闭区间）。仅这两个算子携带，其余算子缺省、序列化不
   *  携带该字段。落地规则见 applyPredicateOp。 */
  right2?: ValueRef;
  like_mode?: 'contains' | 'pattern';
}

/** 该操作符是否为「无右值」判空算子（is_null/is_not_null）。ConditionTree.vue 据此驱动右值输入的显隐。 */
export function isNullCompareOp(op: CompareOp): boolean {
  return op === 'is_null' || op === 'is_not_null';
}

/** 该操作符是否为区间比较算子。ConditionTree.vue /
 *  ConditionReadonlyView.vue 据此驱动第二右值 right2 的显隐渲染，与 isNullCompareOp 同一惯例。 */
export function isBetweenOp(op: CompareOp): boolean {
  return op === 'between' || op === 'not_between';
}

/** 该值引用是否为「空值」常量（kind=const 且 value===null）。与 isNullCompareOp 是两条并存的判空
 *  写法——一个在算子层（为空/不为空，无右值），一个在值层（字段 = 空值，右值是真正的 null 常量）。
 *  供 ExpressionInput.vue/QuickFieldPicker.vue/ConditionReadonlyView.vue 共用判据，不各自重复写
 *  `v.kind === 'const' && v.value === null`。 */
export function isNullConstRef(v: ValueRef | undefined | null): boolean {
  return !!v && v.kind === 'const' && v.value === null;
}

/**
 * 切换谓词操作符时对 right/right2/like_mode 字段的落地规则（从 ConditionTree.vue 抽出为纯函数，
 * 便于单测，风格同 matchKeyExtract.ts 的抽离约定）：
 * - 切到判空算子(is_null/is_not_null)：删除 right/right2/like_mode——无右值语义，保证序列化不携带
 *   这些字段（优先级最高：即便原本是 between/like，切到判空也一并清空）；
 * - 切到其它算子：若 right 缺失（如刚从判空算子切回）则补一个空 const，避免右侧编辑器绑定 undefined；
 *   已有 right 则原样保留，不丢用户已填的值。
 * - 切到 between/not_between：补 right2（区间第二右值）——已有则保留（between↔
 *   not_between 互切不丢已填值），缺失则补一个空 const（与 right 缺失时的兜底同一形态，不猜测复制
 *   right 的形状——两端语义独立，复制 right 反而可能造成"看起来已经填好"的误导）；
 * - 切离 between/not_between：删除 right2——它是 between 专属字段，其余算子不携带。
 * - 切离 like：删除 like_mode——它是 like 专属字段，其余算子不携带。
 * 不改变入参（返回新对象），避免调用方误共享引用。
 */
export function applyPredicateOp(p: Predicate, op: CompareOp): Predicate {
  const next: Predicate = { ...p, op };
  if (isNullCompareOp(op)) {
    delete next.right;
    delete next.right2;
    delete next.like_mode;
    return next;
  }
  if (!next.right) {
    next.right = { kind: 'const', value: '' };
  }
  if (isBetweenOp(op)) {
    if (!next.right2) {
      next.right2 = { kind: 'const', value: '' };
    }
  } else {
    delete next.right2;
  }
  if (op === 'like') {
    if (next.right.kind === 'const' && typeof next.right.value === 'string' && !next.right.value.includes('%')) {
      next.right = { ...next.right, value: `%${next.right.value}%` };
    }
    if (next.right.kind === 'const' && typeof next.right.value === 'string') {
      next.like_mode = 'pattern';
    } else {
      delete next.like_mode;
    }
  } else {
    delete next.like_mode;
  }
  return next;
}

/** 布尔组：logic 连接 items，negate=true 整组取反（不满足）。items 为「子组或谓词」。 */
export interface ConditionGroup {
  logic: 'and' | 'or';
  negate?: boolean;
  items: ConditionItem[];
}

/** 子组或谓词二选一（互斥）。 */
export interface ConditionItem {
  group?: ConditionGroup;
  predicate?: Predicate;
}

/** 一个目标字段的输出：表达式 + 回填策略。
 *  fill_strategy 可选：取数回填模式必填（overwrite/append/merge/row_match）；写模式（insert/update）
 *  的字段映射不携带（后端写校验拒绝非空 fill_strategy——「查出什么写什么」）。 */
export interface OutputMapping {
  target_field_id: string;
  expression: ValueRef;
  fill_strategy?: FillStrategy;
  /** append/merge 分隔符，缺省 ","。 */
  separator?: string;
  /** 显示名：= V4 暂存列 name，
   *  任意非空文本、目标内唯一，只供界面显示与文本引用解析——非暂存目标不携带本字段。暂存目标下
   *  target_field_id 存的是 column_id（稳定键，物理列名），显示名单独走这里，两者不再共用同一字符串。 */
  target_field_label?: string;
}

/** 清空配置（V4 取数填充规格：范围 × 时机正交）：
 *  mode——mapped 仅清 outputs 映射字段；all 清空扩展表全部数据行（仅明细目标，主表禁用；
 *  「整表替换」= all + 追加写的组合效果）。
 *  timing——before/after 均支持与 all/mapped 任意组合；语义轴为「被清数据是否参与参数构建」：
 *  before=执行开始先物理清 Mirror 值再取参数快照再查询；after=参数快照取完后清空与查询并发。
 *  运行期是物理清值（只清值不删行、公式格跳过），空结果也照样清；清后查询失败=已清状态经统一渲染通知
 *  对用户可见。设计器用「清除方式」「清除时机」两个控件分别编辑 mode/timing。 */
export interface ClearSpec {
  mode: 'none' | 'mapped' | 'all';
  timing: 'before' | 'after';
}

/** 一对按行列匹配的键：来源列（进 SELECT AS m_<seq>）+ 本表扩展表字段。 */
export interface MatchKey {
  /** 来源表达式（source_field 等），进 SELECT AS m_<seq> 只供匹配，不写字段。 */
  source_expr: ValueRef;
  /** 本表扩展表字段 ID，插件读该字段已有值做 join 匹配；新行未命中时回填此字段。 */
  form_field_id: string;
}

/** 写操作类型（写动作扩展，对齐后端 expression.WriteOperation）。
 *  ''(fill)=取数回填（现状，缺省）；insert/update/delete=写动作（新增/修改/删除数据）。 */
export type WriteOperation = '' | 'insert' | 'update' | 'delete';

/** 防重范围（insert 专用）：全表 / 同父内（仅扩展表目标）。 */
export type DedupeScope = 'all' | 'parent';

export interface WriteParentSpec {
  alias?: string;
  value?: ValueRef;
  current_form?: true;
}

/** 目标段：本模板填充数据表 + 逐字段输出。
 *  写模式（operation != ''）下语义变为「写库目标」：目标可为任意模板的主表/扩展表，
 *  fill 专属字段（fill_strategy/clear/match_keys/auto_row_match）禁用。 */
export interface TargetSpec {
  target_template_id: string;
  target_data_table_id: string;
  /** 设计器按目标表权威 table_role 固化的角色。插件 ValidateParams 没有运行期 main_table_id，
   *  依赖此字段在保存期 fail-close 明细表 clear/row-match 等尚无原子协议的模式。 */
  target_table_role?: TableRole;
  outputs: OutputMapping[];
  clear?: ClearSpec;
  match_keys?: MatchKey[];
  /** 自动按行列匹配（仅明细目标，per-target 独立配置，控件在③目标 tab 栏）：
   *  true=从筛选条件自动提取匹配键（此时填充方式不提供「按行列匹配」）；
   *  false/缺省=手动模式，匹配键由 fill_strategy='row_match' 的输出列声明。 */
  auto_row_match?: boolean;
  trim_empty_rows_after_fill?: boolean;
  /** 逐目标「排除重复」：
   *  缺省视为 true（产品默认开）。3.4 引擎不消费本字段（3.4 的去重在顶层 distinct）。 */
  distinct?: boolean;
  /** 逐目标「仅限前 N 条」：>=1；缺省=不限。3.4 引擎不消费（3.4 在顶层 limit）。 */
  take?: number;
  /** 逐目标排序（V4 取数专用，per-target 独立；控件在③目标字段行右侧的「排序」下拉）：
   *  按**本目标的输出字段**排序，`target_field_id` 必须出现在本目标 outputs 里（服务端
   *  extractdoc 解码闸会核对，悬空键整份文档被拒），`direction` 只有 asc/desc——不排序即不出现在数组里。
   *  仅明细目标有意义：主表恒一行 `main:0`，界面不提供该控件，调和时对主表目标一律剥离。
   *  空数组 = 用户把本目标的排序清空了（与"整键缺省"区分：缺省表示本模型没编辑过排序，
   *  适配层回落上一版 V4 文档，见 expressionModelToV4Doc）。
   *  3.4 引擎不消费本字段——3.4 的排序在**顶层 order_by** 且按表达式而非字段 ID（见 ExpressionModel.order_by）。 */
  order_by?: TargetOrderKey[];
  // ── 写模式扩展（写动作专用；operation 为空/缺省时以下字段应为空）──
  /** 写操作类型：''(fill) | insert | update | delete。 */
  operation?: WriteOperation;
  target_alias?: string;
  /** @deprecated 见上方 WriteParentSpec 头注释——决议 ⑧ 撤销「父记录锚定」配置项，编辑器不再产出。 */
  parent?: WriteParentSpec;
  dedupe_field_ids?: string[];
  /** 防重范围：''/all(全表，缺省) | parent(同父内，仅扩展表目标)。 */
  dedupe_scope?: DedupeScope;
  /** 取数填充图表目标：查询结果升维归一化后注入指定图表。
   *  与 outputs 并存、互不影响；旧配置无此字段=零行为（完全向后兼容）。
   *  @deprecated legacy 镜像字段：多目标改造后图表目标已升为 ExpressionModel 顶层 chart_targets（与表目标平级）。
   *  writeTargets() 会把顶层 chart_targets 同步镜像到这里（仅镜像 targets[0]），供未升级的旧读者继续读取；
   *  新代码一律读顶层 model.chart_targets（经 readChartTargets() 归一化）。 */
  chart_targets?: ChartTargetSpec[];
  target_kind?: 'staging';
}

/** 该目标是否为「暂存目标」（Phase B，动作暂存区）：target_kind==='staging'。风格对齐同文件
 *  tableRoleOf/isNullCompareOp（纯判定函数，供 modelTargets.ts / ExpressionEditor.vue 复用）。 */
export function isStagingTarget(t: Pick<TargetSpec, 'target_kind'>): boolean {
  return t.target_kind === 'staging';
}

/** 一个图表取数填充目标：查询结果按 mapping 归一化后注入 chart_id 指向的图表。
 *  chart_form 配置时从图表目录带出（见 ChartCatalogEntry），运行时用于选归一化分支。 */
export interface ChartTargetSpec {
  chart_id: string;
  chart_form: 'categorySeries' | 'nameValue' | 'points';
  mapping: ChartTargetMapping;
  /** 类目/系列/点数截断上限，缺省 1000（取数插件侧兜底默认值）。 */
  row_limit?: number;
}

/** 一个 wide 布局的值列：name_key 是配置期用户填写的系列显示名（非查询列名）。 */
export interface ChartTargetValueColumn {
  name_key: string;
  expression: ValueRef;
}

/** 图表槽位映射（判别联合，按 form 取用对应字段）：
 *  - categorySeries + layout='long'：category + series + value + aggregate
 *  - categorySeries + layout='wide'：category + values（每项 name_key + expression）
 *  - nameValue：name + value + aggregate
 *  - points：x + y + series（可选，按系列名分组多系列） */
export type ChartTargetMapping =
  | {
      form: 'categorySeries';
      layout: 'wide' | 'long';
      category: ValueRef;
      /** wide 专用：每项一系列，name_key=系列显示名。 */
      values?: Array<{ name_key: string; expression: ValueRef }>;
      /** long 专用：系列名列 + 值列。 */
      series?: ValueRef;
      value?: ValueRef;
      /** 同 (类目,系列) 多行折叠方式，缺省 sum；count 时可省 value（计行数）。 */
      aggregate?: 'sum' | 'avg' | 'count' | 'max' | 'min' | 'first';
    }
  | {
      form: 'nameValue';
      name: ValueRef;
      value: ValueRef;
      aggregate?: 'sum' | 'avg' | 'count' | 'max' | 'min' | 'first';
    }
  | {
      form: 'points';
      x: ValueRef;
      y: ValueRef;
      series?: ValueRef;
    };

/** 一条排序键。 */
export interface OrderKey {
  value: ValueRef;
  dir: 'asc' | 'desc';
}

/** 逐目标排序键（V4 取数专用，见 TargetSpec.order_by）：与 V4 文档 `targets[].order_by[]` 逐字同构，
 *  按目标字段 ID 指定，不像 3.4 顶层 OrderKey 那样按表达式匹配。 */
export interface TargetOrderKey {
  target_field_id: string;
  direction: 'asc' | 'desc';
}

/** 统一表达式中间模型。
 *
 * ── 多填充目标改造（目标由单数升级为多数，向后兼容双写策略）──────────────────
 * - `targets`：多填充目标表（新字段）。同一查询结果分别按各自 outputs 写入多张表/写库目标；
 *   下标顺序即目标顺序，`targets[0]` 语义上对齐旧 `target`。
 * - `target`：**legacy 镜像字段**（改为可选）。写侧（writeTargets）恒同步写为 `targets[0]` 的深拷贝，
 *   供尚未升级到 `targets` 的旧读者（历史保存的模型 / 未接线的组件）继续按单目标语义读取，零行为回归。
 *   新代码一律通过 readTargets(model) 读取，不直接访问 target。
 * - `chart_targets`（顶层）：图表目标由 TargetSpec 内嵌字段升为与表目标平级的顶层字段（新字段）。
 * - 读取归一化规则（见 modelTargets.ts）：
 *   readTargets(model)      = model.targets ?? (model.target ? [model.target] : [])
 *   readChartTargets(model) = model.chart_targets ?? model.target?.chart_targets
 *                             ?? model.targets?.[0]?.chart_targets ?? []
 */
export interface ExpressionModel {
  schema_version: number;
  source: SourceSpec;
  where?: ConditionGroup;
  /** @deprecated 已退役：表达式模式不再产出整段 raw WHERE——文本在确认时经
   *  lower-text 降级成结构化 where + where_text_source sidecar；服务端保存闸拒绝非空 where_expr。
   *  字段声明保留仅为让只读渲染/调和逻辑能识别并剥离历史文档里的残留，编辑器**绝不写入**。 */
  where_expr?: ValueRef;
  /** 文本模式 WHERE 的 sidecar：与结构化 where 成对——where 是文本降级后的
   *  结构化组，本字段记录原文 + digest。🔴 二者必须同步维护：引导式编辑改动了 where 就必须清掉本字段
   *  （否则服务端核 digest 会拒）；无 where 时不得单独存在。 */
  where_text_source?: TextSource;
  target: TargetSpec;
  /** 多填充目标表（新字段，多目标改造）：同一查询结果分别按各自 outputs 写入多张表。详见本接口顶部注释。 */
  targets?: TargetSpec[];
  /** 图表取数填充目标（顶层，多目标改造后与表目标 targets 平级）：查询结果升维归一化后注入指定图表。
   *  详见本接口顶部注释与 readChartTargets() 归一化规则。 */
  chart_targets?: ChartTargetSpec[];
  order_by?: OrderKey[];
  /** 分类汇总分组键（SQL GROUP BY）。**已退役字段（07-29 移除手动分组 UI）**：编辑器不再写入，
   *  调和时对存量模型恒剥离；分组键由后端归一化层 DeriveFillGroupBy 自动推导。
   *  类型上保留仅为兼容历史序列化产物的读取与剥离。 */
  group_by?: ValueRef[];
  /** 分组后筛选：对 group_by 聚合结果再做一次筛选，与 where
   *  同型（复用 ConditionGroup）。**编辑器 UI 入口已撤除**：本字段自此改为
   *  仅存量承载——后端 having 面与本字段本身均未退役、不动，但编辑器不再提供任何配置该字段的 UI，
   *  也不再按结构性候选清单主动剥离（原 ExpressionEditor.vue havingCandidatesFor 代理判定已随 UI
   *  一并移除）；reconcile() 对存量文档里的本字段原样透传，保证打开/保存不丢字节。类型上保留仅为
   *  承接历史/其他写入方（如测试脚本、后端迁移）产出的存量文档。 */
  having?: ConditionGroup;
  /** 查询去重；缺省按后端规则视为 true，新建配置显式写入 true。 */
  distinct?: boolean;
  /** 仅取前 N 条；缺省表示不限制。 */
  limit?: number;
}

/** 产出一个空白模型骨架（编辑器新建动作时用）。
 *  注意：**不再默认种入 clear**——clear 属于取数(fill)专属字段，写动作(insert/update/delete)携带
 *  非空 clear 会被后端 validateWriteTarget 拒绝（“写模式不支持清空策略”）。取数节点的 fill 默认值
 *  （auto_row_match / clear=mapped）由取数动作侧（NodeConfigDialog seedFillDefaults）按节点类型注入，
 *  绝不泄漏到写动作节点。 */
export function emptyExpressionModel(targetTemplateId = ''): ExpressionModel {
  return {
    schema_version: EXPRESSION_SCHEMA_VERSION,
    source: { tables: [], joins: [] },
    target: { target_template_id: targetTemplateId, target_data_table_id: '', outputs: [] },
    distinct: true
  };
}

// ── 字段树坞列类型───────
//
// 原定义在 FieldTreeDock.vue 内部；因降级构造器 dockColumns.ts（供 AdvancedExpressionDialog.vue 在
// 拿不到模板归属的 Lite 数据形态下就地构造树坞列）是纯 .ts 文件，不便反向 import 一个 .vue SFC 的
// 类型，故挪到本文件作唯一权威定义。FieldTreeDock.vue 改为从这里 import + 类型重导出（对外 import
// 路径 `from './FieldTreeDock.vue'` 不变，见其 script 顶部说明），不是破坏性改动。

/** 树坞里一张可折叠数据表节点。 */
export interface DockTable {
  /** 字段引用别名：本报表隐式别名（bt*）或来源段显式别名（t1/t2…）。emit 时随 field_id 一并带出，
   *  与 FieldTreePanel 的 pickSource/pickForm 产出的 source_field 语义完全一致。 */
  alias: string;
  /** 数据表展示名（含同表多实例序号后缀等，调用方已算好，直接展示）。 */
  label: string;
  fields: TemplateField[];
  /** 视图来源且宿主不支持视图字段目录时为 true（同 FieldTreePanel 的降级范式，分组保留可见+提示文案）。 */
  viewFieldsUnsupported?: boolean;
  /** 暂存来源但当前画布拓扑取不到「上一步暂存区」列时为 true（同上）。 */
  stagingUnsupported?: boolean;
  /** 外部数据表来源但当前宿主不支持读取外部表字段（未实现 host.getExternalSchema）时为 true（同上，S2b）。 */
  externalFieldsUnsupported?: boolean;
}

/** 树坞一列：列头 + 列内数据表（可能不止一张，如同模板多张来源表共享一列）。 */
export interface DockColumn {
  /** 列头文案（模板名 / 独立来源展示名，由调用方算好）。 */
  header: string;
  /** 列内数据表节点，至少一项。 */
  tables: DockTable[];
}
