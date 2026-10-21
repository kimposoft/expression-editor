/**
 * 取数节点文档（ExtractNodeDocumentV4，见 ./nodeDocument.ts）的「空白初始态」构造与形状守卫。
 *
 * 背景：动作设计器壳（plugins/kimpo-action-designer/frontend/src/designer/NodeConfigDialog.vue）
 * 把取数节点参数键从 3.4 的 expression 迁到 extract_v4 后，需要在①节点首次挂载 V4 配置面（旧节点
 * params.extract_v4 尚不存在）与②草稿值形状被判定为非法（如残留旧 expression 结构）两种场景下，
 * 兜底出一份**类型完整、语义上"什么都还没配"**的文档，交给 V4TargetTabs 等编辑组件渲染。
 *
 * 与 ./definitionDoc.ts 的 buildDefinition（从用户输入组装 ExtractDefinitionV4）不同——本文件不接收
 * 任何入参，只产出常量形状的空文档，也不做深层校验（深校验归宿主保存闸，插件/共享包侧只做浅层
 * 形状识别，见 isExtractNodeDocument）。
 */
import type { V4ExtractNodeDocument } from './nodeDocument';

/**
 * 构造一份空白取数节点文档：无来源、无关联、无目标，选项取默认值（distinct=false，
 * business_timezone 首版固定 'UTC'，与 V4QueryOptions 类型口径一致）。
 *
 * schema_version/syntax_profile 直接写字面量常量（与 nodeDocument.ts/definitionDoc.ts 现有写法一致）
 * ——不经 NODE_DOCUMENT_SCHEMA_VERSION 变量中转，避免 const 声明被 TS 宽化为 string 导致字面量类型
 * 校验失效。
 */
export function emptyExtractNodeDocument(): V4ExtractNodeDocument {
  return {
    schema_version: 'kimpo.extract-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [],
      joins: [],
      options: {
        distinct: false,
        business_timezone: 'UTC'
      }
    },
    targets: []
  };
}

/**
 * 类型守卫：仅做浅层形状识别（对象 + schema_version 字面量匹配 + query 为对象 + targets 为数组），
 * 不深查 sources/joins/targets 内部结构——足够用来在壳侧区分"这是一份 V4 文档草稿"还是"这是别的
 * 东西（undefined、旧 expression 结构、用户手改出的畸形值等）"，深层结构校验仍归宿主保存闸。
 */
export function isExtractNodeDocument(v: unknown): v is V4ExtractNodeDocument {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const candidate = v as Record<string, unknown>;
  if (candidate.schema_version !== 'kimpo.extract-node/v4') {
    return false;
  }
  if (typeof candidate.query !== 'object' || candidate.query === null) {
    return false;
  }
  if (!Array.isArray(candidate.targets)) {
    return false;
  }
  return true;
}
