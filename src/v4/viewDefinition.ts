/**
 * 视图定义文档（ViewDocumentV4，`kimpo.view/v4`）的 TS 等价类型。
 *
 * 业务口径：
 * - 常规视图 = 一份 V4 查询（来源 + 关联 + 筛选）+ 视图列（每列：稳定列标识 column_id + 显示名
 *   name + 取值表达式）+「排除重复」（缺省视为 true）。
 * - 组合视图 = ≥2 个「数据组」（每组有自己的来源 + 关联 + 筛选，并给每一列一个取值表达式；某组
 *   某列取值为 null 表示该组在这一列输出空值）+ 统一视图列 + 合并方式 set_mode（"union" 去除重复，
 *   缺省；"union_all" 保留重复）。
 * - 视图不提供排序与前 N 条：文档里不存在 order_by / take 字段——本文件复用取数节点文档同款
 *   V4QueryDefinition 类型（结构上仍"认识"这两个字段，与后端 Go 侧复用 extractdoc.QueryDefinition
 *   同一取舍：TS 结构类型天然允许调用方不设置这两个可选字段，深层"出现即拒绝"的校验归服务端
 *   Decode/Validate 原始字节层校验，本文件不重复实现）。
 * - 来源只能是 kind=catalog（数据表，可跨应用）或 kind=view（视图，可跨应用，支持视图嵌套引用
 *   另一个视图）；不许 report/staging/unit 来源；表达式不许引用系统变量、本报表字段、暂存字段。
 *   这些是后端 Decode/Validate 的深层业务规则，本文件（同 nodeDocument.ts/writeNodeDocument.ts
 *   一贯做法）只镜像形状、不重复实现校验。
 * - 列标识 column_id 形如 `col_` + 8 位小写十六进制（与暂存列同一格式，见
 *   ./definitionDoc.ts generateStagingColumnId），就是数据库视图的物理列名，列内唯一；name 非空、
 *   trim 后唯一。数据组 group_id 形如 `g_` + 8 位小写十六进制，label 非空。
 * - 文档不含 view_id / revision：视图身份（挂在哪个视图记录上、修订号）由视图服务持有，不下沉进
 *   本文档——与 ExtractNodeDocumentV4 不含 node_id/revision/definition_id、
 *   ControlQueryDocumentV4 不含 field_id/variant_id/definition_id 同一纪律。
 */
import type { V4ExpressionDocument } from './definition';
import type { V4QueryDefinition } from './nodeDocument';
import { generateStagingColumnId } from './definitionDoc';

/** 视图定义文档 schema_version 字面量常量（对应后端 viewdoc.SchemaVersionV4），供构造/校验处直接
 *  引用，避免各处手写字符串走样。 */
export const VIEW_DOCUMENT_SCHEMA_VERSION = 'kimpo.view/v4';

/** 视图形态：常规视图 / 组合视图（对应后端 viewdoc.ViewType）。 */
export type V4ViewType = 'regular' | 'combined';

/** 组合视图各数据组结果的合并方式（对应后端 viewdoc.SetMode）：union=去除重复（缺省）；
 *  union_all=保留重复。 */
export type V4ViewSetMode = 'union' | 'union_all';

/** 一列视图列的声明：稳定标识 + 显示名。取值表达式不在这里——常规视图的取值在
 *  V4ViewRegularBody.values，组合视图的取值在 V4ViewGroup.values（按 column_id 分别提供，统一
 *  视图列 + 各数据组各自取值这条业务口径不需要在列声明里重复表达一遍表达式）。 */
export interface V4ViewColumn {
  /** 形如 `col_` + 8 位小写十六进制（`^col_[0-9a-f]{8}$`），是数据库视图的物理列名，列内唯一。 */
  column_id: string;
  /** 显示名：非空、trim 后列内唯一。 */
  name: string;
}

/** 常规视图体：一份查询（与取数节点文档同构的 V4QueryDefinition，见 ./nodeDocument.ts）+ 每列一份
 *  取值表达式 + 排除重复开关。 */
export interface V4ViewRegularBody {
  query: V4QueryDefinition;
  /** 键 = column_id，必须恰好覆盖 ViewDocumentV4.columns 声明的全部列，每列一个非空表达式——常规
   *  视图没有"某列输出空值"的概念（那是组合视图 V4ViewGroup.values 用 null 表达才有的语义）。 */
  values: Record<string, V4ExpressionDocument>;
  /** 排除重复；缺省视为 true（对应后端 RegularBody.EffectiveDistinct）。 */
  distinct?: boolean;
}

/** 组合视图的一个数据组：自己的查询 + 每列一份取值表达式（可为 null，表示该组在这一列输出空值）。 */
export interface V4ViewGroup {
  /** 形如 `g_` + 8 位小写十六进制（`^g_[0-9a-f]{8}$`），组合视图内唯一。 */
  group_id: string;
  /** 显示名，非空（组间不强制唯一）。 */
  label: string;
  /** 同 V4ViewRegularBody.query，每组各自独立的来源/关联/筛选。 */
  query: V4QueryDefinition;
  /** 键 = column_id，必须恰好覆盖 ViewDocumentV4.columns 声明的全部列——组合视图要求"给每一列一个
   *  取值表达式"，值可以显式为 null 表示该组在这一列输出空值（两种情况键都必须存在，故用
   *  `V4ExpressionDocument | null` 而非可选属性）。 */
  values: Record<string, V4ExpressionDocument | null>;
}

/** 组合视图体：≥2 个数据组 + 合并方式。 */
export interface V4ViewCombinedBody {
  /** 缺省视为 union（对应后端 CombinedBody.EffectiveSetMode）。 */
  set_mode?: V4ViewSetMode;
  groups: V4ViewGroup[];
}

/** 视图定义文档顶层模型：一组视图列 + 常规视图体或组合视图体（二选一，由 view_type 判别）。 */
export interface V4ViewDocument {
  schema_version: 'kimpo.view/v4';
  view_type: V4ViewType;
  /** 本视图对外暴露的列清单（列顺序即物理视图的列顺序），至少 1 列。 */
  columns: V4ViewColumn[];
  /** 仅 view_type='regular' 时非空。 */
  regular?: V4ViewRegularBody;
  /** 仅 view_type='combined' 时非空。 */
  combined?: V4ViewCombinedBody;
}

/** 判别守卫：view_type='regular' 且 regular 段非空。窄化后 doc.regular 类型收紧为必有（非
 *  undefined），供调用方安全解构。 */
export function isRegularView(doc: V4ViewDocument): doc is V4ViewDocument & { regular: V4ViewRegularBody } {
  return doc.view_type === 'regular' && !!doc.regular;
}

/** 判别守卫：view_type='combined' 且 combined 段非空。窄化后 doc.combined 类型收紧为必有。 */
export function isCombinedView(doc: V4ViewDocument): doc is V4ViewDocument & { combined: V4ViewCombinedBody } {
  return doc.view_type === 'combined' && !!doc.combined;
}

/** 生成一份空白的查询定义（无来源、无关联、无筛选，选项取默认值：distinct=false，
 *  business_timezone 首版固定 'UTC'——与 ./emptyNodeDocument.ts emptyExtractNodeDocument 同口径）。
 *  对外导出：./viewModelAdapter.ts 反向翻译时，遇到"文档此前没有这份查询"（如常规/组合互切、
 *  组合视图新增数据组）需要一个合法的兜底基底，同一份实现两处共用。 */
export function emptyViewQuery(): V4QueryDefinition {
  return { sources: [], joins: [], options: { distinct: false, business_timezone: 'UTC' } };
}

/** 常规视图体「排除重复」的生效取值：未提供（undefined）时按产品默认视为 true；显式提供时按字面值
 *  ——与后端 viewdoc.RegularBody.EffectiveDistinct 同一口径，供调用方渲染开关的"当前实际生效状态"
 *  （区别于"用户是否碰过这个开关"这一持久化语义，见 V4RegularViewModel.distinct 字段注释）。 */
export function effectiveViewDistinct(distinct: boolean | undefined): boolean {
  return distinct ?? true;
}

/** 组合视图合并方式的生效取值：未提供（undefined）时按产品默认视为 'union'；显式提供时按字面值
 *  ——与后端 viewdoc.CombinedBody.EffectiveSetMode 同一口径。 */
export function effectiveViewSetMode(setMode: V4ViewSetMode | undefined): V4ViewSetMode {
  return setMode ?? 'union';
}

/** 构造一份空白常规视图文档：无列、query 为空查询、values 为空映射、distinct 不显式写（缺省视为
 *  true，交由消费方按 EffectiveDistinct 同款口径解释未提供的情形，与后端指针语义一致——本文件不
 *  在"空白初始态"就垫一个 `true` 字面量，避免让"用户还没碰过这个开关"与"用户显式打开"无法区分）。 */
export function emptyRegularView(): V4ViewDocument {
  return {
    schema_version: VIEW_DOCUMENT_SCHEMA_VERSION,
    view_type: 'regular',
    columns: [],
    // distinct 显式写 true：生效值本来就是 true
    // （effectiveViewDistinct(undefined) === true，后端 RegularBody.EffectiveDistinct 同口径），
    // 但"缺键"这个态依赖读侧每一处都记得套 effective* 才不会读成 false。新建视图直接把产品默认
    // 落成显式值，任何读侧（含将来新增的）拿到的都是同一个答案，不再有"未配置"这层歧义。
    // 存量视图的缺键态语义不变，仍由 effectiveViewDistinct 解释——本改动只影响新建。
    regular: { query: emptyViewQuery(), values: {}, distinct: true }
  };
}

/** 构造一份空白组合视图文档：默认两个数据组（组合视图硬性要求 ≥2 组，见 CombinedBody.groups
 *  minItems:2）——空文档就该是"结构合法、待填内容"的形态，不留用户需要自己点两次"添加数据组"
 *  才能满足最低要求的中间态。两组各自的 query/values 均为空（列尚未声明，values 映射为空
 *  对象——与 columns=[] 一致，等用户加列时再按 column_id 补齐每组的取值）。 */
export function emptyCombinedView(): V4ViewDocument {
  return {
    schema_version: VIEW_DOCUMENT_SCHEMA_VERSION,
    view_type: 'combined',
    columns: [],
    combined: {
      groups: [
        { group_id: generateDataGroupId(), label: '', query: emptyViewQuery(), values: {} },
        { group_id: generateDataGroupId(), label: '', query: emptyViewQuery(), values: {} }
      ]
    }
  };
}

/** 生成一个新的视图列稳定键（`col_` + 8 位小写十六进制）：复用暂存列生成器同一套配方——视图列
 *  column_id 与暂存列 column_id 是同一物理约束（`^col_[0-9a-f]{8}$`，都是"进 DDL 的物理列名"），
 *  没必要另起一套随机数生成逻辑，见 ./definitionDoc.ts generateStagingColumnId 头注释。 */
export function generateViewColumnId(): string {
  return generateStagingColumnId();
}

/** 生成一个新的数据组稳定键（`g_` + 8 位小写十六进制）：实现照抄 generateStagingColumnId 同一套
 *  crypto.getRandomValues/Math.random 回落写法，仅前缀不同（组合视图专属，数据表/暂存列的生成器
 *  都不适用这个前缀）。 */
export function generateDataGroupId(): string {
  const bytes = new Uint8Array(4);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `g_${hex}`;
}
