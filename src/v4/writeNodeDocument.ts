/**
 * V4（表达式引擎(表达式引擎) V4 引擎）写节点文档（WriteNodeDocumentV4 文档形状）的 TS 等价类型。
 *
 * 背景：三写动作（新增/修改/删除数据）的配置从 3.4 参数键 `expression` 硬切到 V4 写节点文档参数键
 * `write_v4`。设计态路线沿取数已验证的「V4 权威模型 +
 * 3.4 ExpressionEditor 挂载体」——记录控制器插件的配置面挂共享包 ExpressionEditor 本体，由适配器
 * （./writeModelAdapter.ts）在本文件定义的 V4 文档与 3.4 ExpressionModel 之间正反翻译。
 *
 * query 段直接复用取数节点文档的 V4QueryDefinition（sources/joins/filter/options 四件套，形状与
 * ExtractNodeDocumentV4.query 完全一致，见 ./nodeDocument.ts 头注释「取数节点」承载的查询语义在此
 * 同样适用——写节点的 query 用于「查询待更新/删除的行」（update/delete）或「查询插入所需的源数据」
 * (insert 可选来源)。
 *
 * 本子目录（src/v4/）与包内既有 ExpressionHost/types.ts 完全独立并存——不改动、不复用后者的任何
 * 已有导出语义（沿用 ./nodeDocument.ts 头注释里的约定）。
 */
import type { V4ExpressionDocument } from './definition';
import type { V4QueryDefinition } from './nodeDocument';

/** 写节点文档 schema_version 字面量常量，供构造/校验处直接引用，避免各处手写字符串走样。 */
export const WRITE_NODE_DOCUMENT_SCHEMA_VERSION = 'kimpo.write-node/v4';

/** 写操作类型：新增/修改/删除数据三选一，与 Go 侧 WriteNodeDocumentV4.Operation 同值。 */
export type V4WriteOperation = 'insert' | 'update' | 'delete';

/** 写目标（本次写库的目标表身份）——目标先行：三个操作统一先选
 *  目标数据表，落 template_id/data_table_id（跨模板写目标表由前端直接给出身份，不经来源段指认）；
 *  目标模板的表按「隐含来源」/「引用即入源」两档进 query.sources，均由后端按 data_table_id 匹配，
 *  不依赖本字段。
 *  @deprecated instance_id：决议 ⑧ 之前 update/delete 落此字段（指向 query.sources 里某条来源实例
 *  的 instance_id，即"查询它并写它"，3.4 TargetSpec.target_alias 的 alias≡instance_id 约定）——
 *  本字段只为读兼容存量 update/delete 文档保留（读入时按 query.sources 里该实例的 data_table_id/
 *  template_id 折算成新形状），保存不再写出；新文档不应携带。 */
export interface V4WriteTarget {
  data_table_id?: string;
  template_id?: string;
  /** @deprecated 见上方类型注释——仅供读兼容存量 update/delete 文档，保存不再写出。 */
  instance_id?: string;
}

/** 一条字段赋值（insert 的写入列 / update 的 SET 列）：写模式的表达式恒 purpose='output'，不携带
 *  fill_strategy（写模式「查出什么写什么」，与取数填充的多策略语义不同，见 3.4 OutputMapping 注释）。 */
export interface V4WriteAssignment {
  target_field_id: string;
  expression: V4ExpressionDocument;
}

export type V4WriteParentKind = 'none' | 'current_form' | 'instance' | 'expression';

/** @deprecated 见上方 V4WriteParentKind 注释——决议 ⑧ 撤销，本类型只为读兼容存量文档保留。 */
export interface V4WriteParent {
  kind: V4WriteParentKind;
  /** 仅 kind='instance' 时携带：query.sources 里某条来源的 instance_id。 */
  instance_id?: string;
  /** 仅 kind='expression' 时携带：父 record_id 的值表达式（purpose='output'）。 */
  expression?: V4ExpressionDocument;
}

/** 防重范围：全表 / 同父内（仅 insert→扩展表目标的 scope='parent' 有意义）。 */
export type V4WriteDedupeScope = 'all' | 'parent';

export interface V4WriteDedupe {
  field_ids: string[];
  scope: V4WriteDedupeScope;
}

/** 写节点文档（WriteNodeDocumentV4 文档形状 TS 等价类型）。 */
export interface V4WriteNodeDocument {
  schema_version: 'kimpo.write-node/v4';
  syntax_profile: 'kimposql.mssql/v1';
  /** 查询定义：来源 + 关联 + 筛选 + 选项，与取数节点文档同型（见 ./nodeDocument.ts V4QueryDefinition）。
   *  update/delete 用其 filter 定位待写行；insert 可选携带来源供赋值表达式引用。 */
  query: V4QueryDefinition;
  operation: V4WriteOperation;
  target: V4WriteTarget;
  assignments: V4WriteAssignment[];
  /** @deprecated 决议 ⑧ 撤销「父记录锚定」，新文档不再写出本字段（编辑器读入即忽略）；仅供读兼容
   *  存量文档——旧格式非 none 的 parent 保存时被后端具名拒绝，须重配。 */
  parent?: V4WriteParent;
  /** 唯一键防重：仅 insert 可选；update/delete 不携带。 */
  dedupe?: V4WriteDedupe;
  /** 最大影响行数上限：与节点 params 的兄弟键同义，由动作设计器「选项」浮层维护，适配器只原样透传
   *  不参与模型正反翻译（见 ./writeModelAdapter.ts 头注释）。 */
  max_affected_rows?: number;
}

/**
 * 构造一份空白写节点文档：无来源、无关联、无赋值，选项取默认值（distinct=false，
 * business_timezone 首版固定 'UTC'，与取数节点 emptyExtractNodeDocument 同口径）。
 *
 * schema_version/syntax_profile 直接写字面量常量（不经 WRITE_NODE_DOCUMENT_SCHEMA_VERSION 变量中转，
 * 避免 const 声明被 TS 宽化为 string 导致字面量类型校验失效，同 nodeDocument.ts emptyExtractNodeDocument
 * 写法）。target/parent/dedupe 均不预置任何字段——"什么都还没配"的写目标本就该是空对象/缺省。
 */
export function emptyWriteNodeDocument(op: V4WriteOperation): V4WriteNodeDocument {
  return {
    schema_version: 'kimpo.write-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [],
      joins: [],
      options: {
        distinct: false,
        business_timezone: 'UTC'
      }
    },
    operation: op,
    target: {},
    assignments: []
  };
}

/**
 * 类型守卫：仅做浅层形状识别（对象 + schema_version 字面量匹配 + query 为对象 + operation 是三值
 * 之一），不深查 sources/joins/assignments 内部结构——足够用来在壳侧区分"这是一份 V4 写节点文档
 * 草稿"还是"这是别的东西（undefined、旧 expression 结构、用户手改出的畸形值等）"，深层结构校验
 * 仍归宿主保存闸（同 ./emptyNodeDocument.ts isExtractNodeDocument 的颗粒度约定）。
 */
export function isWriteNodeDocument(v: unknown): v is V4WriteNodeDocument {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const candidate = v as Record<string, unknown>;
  if (candidate.schema_version !== WRITE_NODE_DOCUMENT_SCHEMA_VERSION) {
    return false;
  }
  if (typeof candidate.query !== 'object' || candidate.query === null) {
    return false;
  }
  if (candidate.operation !== 'insert' && candidate.operation !== 'update' && candidate.operation !== 'delete') {
    return false;
  }
  return true;
}
