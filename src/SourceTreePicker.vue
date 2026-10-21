<script setup lang="ts">
import { computed, h, nextTick, ref, watch } from 'vue';
import { NEmpty, NSpin, NButton, NTree, type TreeOption } from 'naive-ui';
import { KControlSize, KDialog, KDialogFooter, type KControlSizeTiers } from '@kimposoft/ui-kit';
import { useExpressionHost, useT } from './host';
import type { Template, TemplateDataTable, TableRole, ExpressionTreeNode } from './types';
import { tableRoleOf } from './types';

const CLEAR_LINK_TIERS: KControlSizeTiers = { tiny: { height: 18, fontSize: 12, paddingX: 0 } };

/**
 * 来源添加器（树形 Transfer）：左侧「目录 › 模板 › 数据表」树（懒加载数据表），**只到数据表级可选**；
 * 点击数据表加入右侧「已选」列表，**同一数据表可重复加入**（用于对同一表多次关联/处理）。确定后整批加入来源。
 *
 * 树结构走应用真实层级树 host.fetchTree()：目录(category)可嵌套、按 sort_no 排序、目录/模板不同图标；
 * 顶级模板直接在顶层展示（不再折进「未分组」兜底桶）。宿主无 fetchTree（旧桥）时回落扁平分组。
 */
interface SrcNode extends TreeOption {
  nodeKey?: string;
  templateId?: string;
  dataTableId?: string;
  tableName?: string;
  role?: TableRole;
  /** views-frontend-b2 R7：视图叶子标记 + 视图 ID（selectableKinds 含 'view' 时才产出）。 */
  viewId?: string;
  viewName?: string;
  viewType?: 'regular' | 'combined';
  disabledReason?: string;
  /** 跨应用取数：非当前应用子树的节点携带所属应用 ID（应用节点/其下模板/数据表逐层传播）。 */
  appId?: string;
  /** 应用节点标记（「其他应用」下的懒加载子树根，展开时拉该应用层级树）。 */
  isAppNode?: boolean;
  /** Phase B（动作暂存区）：暂存来源虚拟叶子标记——无 templateId/dataTableId/viewId，树顶置顶单节点。 */
  isStaging?: boolean;
  /** S2b（外部数据表来源）：外部数据表叶子标记 + 登记对象 ID/展示名（selectableKinds 含 'external' 时才产出）。 */
  externalObjectId?: string;
  externalName?: string;
}
interface PickedItem {
  templateId: string;
  dataTableId: string;
  name: string;
  role: TableRole;
  kind?: 'table' | 'view' | 'staging' | 'external';
  view_id?: string;
  view_type?: 'regular' | 'combined';
  external_object_id?: string;
  appId?: string;
}

const props = defineProps<{
  currentTemplateId: string;
  /** 取某模板数据表（父级 useExpressionContext.tablesOf，带缓存）。appId=跨应用取数时的目标应用。 */
  tablesOf: (templateId: string, appId?: string) => Promise<TemplateDataTable[]>;
  /** 跨应用取数：true 且宿主实现 listApps 时，树底部追加「其他应用」分组（懒加载各应用层级树，
   *  只到数据表级可选）。缺省 false——写目标等选择器不放开跨应用（跨应用仅允许读来源）。 */
  allowCrossApp?: boolean;
  /** 触发按钮文案（缺省「添加来源」）。写目标复用本选择器时传「选择写目标表」等。 */
  triggerLabel?: string;
  /** 单选模式：勾选一张表即视为唯一目标，已选列表只保留最后一次选择（写目标用）。 */
  single?: boolean;
  selectableKinds?: Array<'table' | 'view' | 'external'>;
  /** 编辑中的视图自身 view_id 清单：命中的视图叶子置灰 + title 提示，防止选择自身形成环。
   *  与下方 disabledViews内部合并判断——两者命中任一即置灰；本 prop
   *  不区分 appId（沿用旧行为：view_id 全局唯一，命中即禁，不论出现在哪个应用子树）。 */
  disabledViewIds?: string[];
  disabledViews?: Array<{ appId?: string; viewId: string; reason: string }>;
  /** 调用方已经选入的物理表 ID。仅命中的 table 叶子置灰；默认不传，保留表达式编辑器允许自连接的旧语义。 */
  disabledTableIds?: string[];
  disabledTableTitle?: string;
  stagingSource?: {
    producerNodeId: string;
    producerLabel: string;
    columns: Array<{ code: string; name: string; type?: string }>;
  } | null;
  /** Phase B：模型内是否已含暂存来源表（一模型至多一张）。true 时树顶暂存虚拟叶子起始即置灰，
   *  防止用户在模型已有一张暂存来源的情况下再次添加第二张。 */
  hasStagingSource?: boolean;
  /** P6c（2026-08-12 权限架构终局裁定②）：true=禁用触发按钮，不打开选择弹窗。由 ExpressionEditor.vue
   *  的 readonly 透传（来源添加器/写目标选择器共用本组件）。缺省 false。 */
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [items: PickedItem[]] }>();

// host 在 setup 顶层 inject，供异步函数捕获。
const host = useExpressionHost();
// 翻译函数，避免与 buildTree 中 for...of 循环变量 t 冲突，此处命名为 tr。
const tr = useT();

const show = ref(false);
const loading = ref(false);
const treeData = ref<SrcNode[]>([]);
const selected = ref<PickedItem[]>([]);
const confirming = ref(false);
const treeVariant = ref<'hierarchical' | 'flat'>('hierarchical');

const pickerTitle = computed(() => (props.single ? tr('picker.titleSingle') : tr('picker.title')));
const pickerSelectHint = computed(() => (props.single ? tr('picker.selectHintSingle') : tr('picker.selectHint')));
const treeRevision = ref(0);
// 跨应用取数：默认展开的节点 key（当前应用节点——一级应用、二级分类树，进弹窗即见本应用内容）。
const expandedKeys = ref<Array<string | number>>([]);

function loadPickerSize(): { width?: number; height?: number; wr?: number; hr?: number } | null {
  return host.loadEditorPrefs?.()?.sourcePicker ?? null;
}

function savePickerSize(size: { width: number; height: number; wr?: number; hr?: number }): void {
  if (!host.saveEditorPrefs) return;
  const existing = host.loadEditorPrefs?.() ?? null;
  host.saveEditorPrefs({ ...existing, sourcePicker: size });
}

/** KDialog 尺寸记忆适配器：沿用原 EditorPrefs.sourcePicker，用户已记住的尺寸不丢；
 *  memoryKey 只是启用开关，真正的存取键由 EditorPrefs 命名空间决定。 */
const pickerMemoryStore = {
  load: () => loadPickerSize(),
  save: (_key: string, size: { width: number; height: number; wr?: number; hr?: number }) => savePickerSize(size)
};

async function openPicker() {
  // P6c 只读闸：禁用态下不打开选择弹窗（触发按钮同时已 :disabled，这里是键盘/程序化调用的兜底）。
  if (props.disabled) return;
  confirming.value = false;
  show.value = true;
  selected.value = [];
  // 每次会话只保留跨应用的应用根展开态；目录/模板一律从折叠态开始，令自动化和键盘用户
  // 都拥有确定的「展开目录→展开模板→选择叶表」状态机，不受上一次 picker 会话残留影响。
  expandedKeys.value = expandedKeys.value.filter(key => String(key).startsWith('app:'));
  syncDisabledTableLeaves(treeData.value);
  if (treeData.value.length === 0) {
    await buildTree();
  } else {
    // Phase B：树已缓存（不重拉）时，把暂存虚拟叶子的置灰态同步回「模型层面是否已有一张」——
    // 消除上次会话选中暂存来源但未确认就关闭（Cancel）遗留的置灰态（selected 已在上面清空，
    // 本次重开理应以当前模型真实状态为准，见 reenableStagingLeaf 附近说明）。
    const pinned = treeData.value.find(n => (n as SrcNode).isStaging) as SrcNode | undefined;
    if (pinned) pinned.disabled = !!props.hasStagingSource;
  }
}

function syncDisabledTableLeaves(nodes: SrcNode[]): void {
  const disabled = new Set(props.disabledTableIds ?? []);
  for (const node of nodes) {
    if (node.dataTableId) node.disabled = disabled.has(node.dataTableId);
    if (node.children?.length) syncDisabledTableLeaves(node.children as SrcNode[]);
  }
}

watch(show, value => {
  if (value) return;
  confirming.value = false;
  selected.value = [];
});

function AppIcon() {
  return h('span', { class: 'src-node-icon src-node-icon-app' }, [
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linejoin': 'round'
      },
      [
        h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }),
        h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }),
        h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }),
        h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 })
      ]
    )
  ]);
}
function CategoryIcon() {
  return h('span', { class: 'src-node-icon src-node-icon-category' }, [
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linejoin': 'round'
      },
      [
        h('path', {
          d: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z'
        })
      ]
    )
  ]);
}
function TableIcon() {
  return h('span', { class: 'src-node-icon src-node-icon-table' }, [
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.6,
        'stroke-linejoin': 'round'
      },
      [h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M3 10h18M9 10v10' })]
    )
  ]);
}
function ViewIcon() {
  return h('span', { class: 'src-node-icon src-node-icon-view' }, [
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      },
      [h('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z' }), h('circle', { cx: 12, cy: 12, r: 3 })]
    )
  ]);
}
function CombinedViewIcon() {
  return h('span', { class: 'src-node-icon src-node-icon-view' }, [
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      },
      [h('circle', { cx: 9, cy: 12, r: 6.5 }), h('circle', { cx: 15, cy: 12, r: 6.5 })]
    )
  ]);
}
// Phase B（动作暂存区）：暂存来源虚拟叶子图标——虚线方框+十字，隐喻"内存里的临时列集合"（非物理数据表），
// 中性提示色（同 ViewIcon 色系），与应用/分组/数据表三色区分，避免误读为真实数据表。
function StagingIcon() {
  return h('span', { class: 'src-node-icon src-node-icon-staging' }, [
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      },
      [
        h('rect', {
          x: 3,
          y: 3,
          width: 18,
          height: 18,
          rx: 3,
          'stroke-dasharray': '3 2'
        }),
        h('path', { d: 'M8 12h8M12 8v8' })
      ]
    )
  ]);
}
function ExternalIcon() {
  return h('span', { class: 'src-node-icon src-node-icon-external' }, [
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      },
      [
        // 表格网格（同 TableIcon 的方框+十字分隔语义，缩小让位给右上角外向箭头）。
        h('rect', { x: 3, y: 5, width: 14, height: 14, rx: 2 }),
        h('path', { d: 'M3 11h14M9 11v8' }),
        // 右上角外向箭头：隐喻"数据来自外部"。
        h('path', { d: 'M15 3h6v6M21 3l-7 7' })
      ]
    )
  ]);
}
// 关闭（✕）图标：弹窗右上角关闭按钮 / 已选行右侧移除按钮共用，细十字线随文字色变化。
function CloseIcon() {
  return h(
    'svg',
    {
      class: 'src-close-svg',
      viewBox: '0 0 24 24',
      width: 12,
      height: 12,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round'
    },
    [h('path', { d: 'M6 6l12 12M18 6L6 18' })]
  );
}
// 垃圾桶图标：已选面板头部「清空」按钮专用。
function TrashIcon() {
  return h(
    'svg',
    {
      class: 'src-trash-svg',
      viewBox: '0 0 24 24',
      width: 14,
      height: 14,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    },
    [
      h('path', { d: 'M4 7h16' }),
      h('path', { d: 'M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2' }),
      h('path', { d: 'M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13' }),
      h('path', { d: 'M10 11v6M14 11v6' })
    ]
  );
}

// 默认仅 'table'（现有调用方行为完全不变——为什么：SourceTreePicker 早于视图功能存在，多处宿主/插件
// 调用点未传该 prop，若默认放开 'view' 会让它们意外在树里冒出视图叶子，属于未授权的行为变化）。
const allowViews = computed(() => (props.selectableKinds ?? ['table']).includes('view'));
// S2b（外部数据表来源）：默认不放开——理由同 allowViews，未传该 kind 的既有调用方不应意外冒出外部表叶子。
const allowExternal = computed(() => (props.selectableKinds ?? ['table']).includes('external'));

const viewColumnCountCache = ref<Record<string, number>>({});
function viewColKey(viewId: string, appId?: string): string {
  return `${appId ?? ''}:${viewId}`;
}
/** 拉取某应用（appId 缺省=当前应用）的视图目录、把各视图列数写入上方查表。selectableKinds 未含
 *  'view' 或宿主未实现 listViews 时直接跳过（不发多余请求）；拉取失败静默——不影响树其余部分渲染。 */
async function fetchViewColumnCounts(appId?: string): Promise<void> {
  if (!allowViews.value || typeof host.listViews !== 'function') return;
  try {
    const list = await host.listViews(appId);
    const patch: Record<string, number> = {};
    for (const v of list) {
      if (typeof v.column_count === 'number') patch[viewColKey(v.view_id, appId)] = v.column_count;
    }
    viewColumnCountCache.value = { ...viewColumnCountCache.value, ...patch };
  } catch {
    // 目录拉取失败：静默——受影响的视图叶子标签省略「· N 列」，同其余容错范式。
  }
}

/** 判定某视图叶子（appId 缺省=当前应用）是否应置灰 + 展示原因：
 *  优先命中旧 prop disabledViewIds（不分 appId，沿用既有"选自身防环"语义，见其 prop 注释）；
 *  否则查新 prop disabledViews（按 appId+viewId 精确匹配，reason 为调用方自带文案、原样展示）。
 *  两者都未命中则不禁用。 */
function disabledViewInfo(viewId: string, appId: string | undefined): { disabled: boolean; reason?: string } {
  if ((props.disabledViewIds ?? []).includes(viewId)) {
    return { disabled: true, reason: tr('picker.viewSelfRefDisabled') };
  }
  const hit = (props.disabledViews ?? []).find(d => d.viewId === viewId && d.appId === appId);
  if (hit) return { disabled: true, reason: hit.reason };
  return { disabled: false };
}

function mapTreeChildren(nodes: ExpressionTreeNode[], appId?: string): SrcNode[] {
  const sorted = [...nodes].sort((a, b) => a.sort_no - b.sort_no);
  const out: SrcNode[] = [];
  for (const n of sorted) {
    if (n.node_type === 'category') {
      const children = mapTreeChildren(n.children ?? [], appId);
      if (children.length === 0) continue; // 空目录（无模板/视图后代）不进树
      out.push({
        key: `cat:${appId ?? ''}:${n.node_key}`,
        nodeKey: n.node_key,
        label: n.node_name,
        selectable: false,
        prefix: CategoryIcon,
        children
      });
    } else if (n.node_type === 'resource' && n.resource_type === 'template' && n.resource_id) {
      if (n.query_mode) continue;
      out.push({
        key: `tpl:${n.resource_id}`,
        label: n.node_name + (!appId && n.resource_id === props.currentTemplateId ? tr('picker.currentTemplate') : ''),
        selectable: false,
        isLeaf: false,
        prefix: TableIcon,
        templateId: n.resource_id,
        appId
      });
    } else if (allowViews.value && n.node_type === 'resource' && n.resource_type === 'view' && n.resource_id) {
      const viewType = n.resource_subtype === 'combined' || n.resource_subtype === 'regular' ? n.resource_subtype : undefined;
      const typeText = viewType === 'combined' ? tr('picker.viewCombined') : viewType === 'regular' ? tr('picker.viewRegular') : tr('picker.viewGeneric');
      // 列数：查 fetchViewColumnCounts 按 appId 预拉的 listViews 目录；取不到时省略「· N 列」。
      const colCount = viewColumnCountCache.value[viewColKey(n.resource_id, appId)];
      const colSuffix = typeof colCount === 'number' ? ` · ${colCount}${tr('picker.columnCountUnit')}` : '';
      const { disabled, reason } = disabledViewInfo(n.resource_id, appId);
      // 置灰原因做成叶子后的可见小标签（而非仅 hover title）：本组件树节点 label 是纯文本渲染
      // （无自定义 vnode label 插槽），沿用现有"信息拼进 label 字符串"的惯例（同本文件模板/数据表
      // 叶子的「（主表 · N 字段）」「（本模板）」等后缀手法）。
      const reasonSuffix = disabled && reason ? ` · ${reason}` : '';
      out.push({
        key: `view:${appId ?? ''}:${n.resource_id}`,
        label: `${n.node_name}（${typeText}${colSuffix}）${reasonSuffix}`,
        selectable: false,
        isLeaf: true,
        disabled,
        disabledReason: reason,
        // NTree 无内置 title 属性，置灰节点靠 nodeProps 里再补一层 title（见 nodeProps）。
        prefix: viewType === 'combined' ? CombinedViewIcon : ViewIcon,
        viewId: n.resource_id,
        viewName: n.node_name,
        viewType,
        appId
      });
    } else if (allowExternal.value && n.node_type === 'resource' && n.resource_type === 'external-table' && n.resource_id) {
      out.push({
        key: `external:${appId ?? ''}:${n.resource_id}`,
        label: `${n.node_name}（${tr('picker.externalGeneric')}）`,
        selectable: false,
        isLeaf: true,
        prefix: ExternalIcon,
        externalObjectId: n.resource_id,
        externalName: n.node_name,
        appId
      });
    }
    // 其他资源类型不进来源树。
  }
  return out;
}

/** Phase B（动作暂存区）：把暂存来源虚拟叶子置顶拼进树数据。stagingSource 为空（当前节点无上一步
 *  暂存区可选）时原样返回，不新增节点——与其它 kind 不同，暂存来源不走 host 端点，纯前端拼装。
 *  disabled=true（模型已含一张暂存来源，见 props.hasStagingSource）时置灰，一模型至多一张。 */
function withStagingPinned(nodes: SrcNode[]): SrcNode[] {
  if (!props.stagingSource) return nodes;
  const pinned: SrcNode = {
    key: 'staging:pinned',
    label: props.stagingSource.producerLabel,
    selectable: false,
    isLeaf: true,
    disabled: !!props.hasStagingSource,
    prefix: StagingIcon,
    isStaging: true
  };
  return [pinned, ...nodes];
}

/** 首选：应用真实层级树（目录嵌套 + sort_no 顺序 + 顶级模板置顶层）；数据表层懒加载（on-load）。
 *  跨应用取数开启时改为两级结构：一级=所有应用（当前应用置顶、默认展开），二级=各应用目录/模板树。 */
async function buildTree() {
  loading.value = true;
  try {
    if (typeof host.fetchTree === 'function') {
      try {
        const [tree] = await Promise.all([host.fetchTree(), fetchViewColumnCounts()]);
        const currentChildren = mapTreeChildren(tree.children ?? []);
        const appLevel = await buildAppLevelTree(currentChildren);
        treeVariant.value = 'hierarchical';
        treeData.value = withStagingPinned(appLevel ?? currentChildren);
        return;
      } catch {
        // 旧宿主桥无 fetchTree / 树端点失败 → 回落扁平分组。
      }
    }
    await buildTreeFlat();
  } finally {
    loading.value = false;
  }
}

/** 跨应用取数：产出「一级=应用、二级=分类/模板」树。当前应用置顶且子树即时挂载（默认展开）；
 *  其他应用懒加载（展开时 fetchTree(appId)）。未开启 allowCrossApp / 宿主未实现 listApps /
 *  拉取失败 / 清单为空 → 返回 null（维持单应用平铺的旧行为）。 */
async function buildAppLevelTree(currentChildren: SrcNode[]): Promise<SrcNode[] | null> {
  if (!props.allowCrossApp || typeof host.listApps !== 'function') return null;
  try {
    const apps = (await host.listApps()).filter(a => a.app_id);
    if (apps.length === 0) return null;
    const current = apps.find(a => a.is_current);
    // 当前应用节点：清单里查不到名称（权限收敛等边缘）时回落通用文案「当前应用」。
    const currentKey = `app:${current?.app_id ?? 'current'}`;
    const currentLabel = current?.app_name ? `${current.app_name}${tr('picker.currentApp')}` : tr('picker.thisApp');
    const nodes: SrcNode[] = [];
    if (currentChildren.length > 0) {
      nodes.push({
        key: currentKey,
        label: currentLabel,
        selectable: false,
        prefix: AppIcon,
        children: currentChildren
      });
    }
    const others = apps.filter(x => !x.is_current);
    const prefetched = await Promise.all(
      others.map(async a => {
        try {
          const [root] = await Promise.all([host.fetchTree!(a.app_id), fetchViewColumnCounts(a.app_id)]);
          return mapTreeChildren(root.children ?? [], a.app_id);
        } catch {
          return null;
        }
      })
    );
    others.forEach((a, i) => {
      const children = prefetched[i];
      if (children && children.length === 0) return; // 预取成功但无可选来源：隐藏该应用
      nodes.push({
        key: `app:${a.app_id}`,
        label: a.app_name || a.app_id,
        selectable: false,
        isLeaf: false,
        prefix: AppIcon,
        appId: a.app_id,
        isAppNode: true,
        // 预取成功即挂上子树（onLoad 只在 children 未定义时触发，不会重复拉取）。
        ...(children ? { children } : {})
      });
    });
    expandedKeys.value = currentChildren.length > 0 ? [currentKey] : [];
    return nodes;
  } catch {
    return null; // 应用清单拉取失败：静默退回单应用（不阻断选择器主功能）
  }
}

/** 回落：拉全部模板按文件夹一层分组（旧行为，宿主桥不支持 fetchTree 时用）。 */
async function buildTreeFlat() {
  treeVariant.value = 'flat';
  const templates = await host.listTemplates({ recursive: true });
  const byFolder = new Map<string, { name: string; tpls: Template[] }>();
  for (const t of templates) {
    const key = t.folder_node_id || 'root';
    if (!byFolder.has(key))
      byFolder.set(key, {
        name: t.folder_node_name || tr('picker.ungrouped'),
        tpls: []
      });
    byFolder.get(key)!.tpls.push(t);
  }
  treeData.value = withStagingPinned(
    [...byFolder.entries()].map(([fid, g]) => ({
      key: `folder:${fid}`,
      nodeKey: fid,
      label: g.name,
      selectable: false,
      prefix: CategoryIcon,
      children: g.tpls.map<SrcNode>(t => ({
        key: `tpl:${t.template_id}`,
        label: t.template_name + (t.template_id === props.currentTemplateId ? tr('picker.currentTemplate') : ''),
        selectable: false,
        isLeaf: false,
        prefix: TableIcon,
        templateId: t.template_id
      }))
    }))
  );
}

function replaceNodeChildren(nodes: SrcNode[], key: string | number, children: SrcNode[]): SrcNode[] {
  return nodes.map(node => {
    if (node.key === key) return { ...node, children };
    if (!node.children?.length) return node;
    const next = replaceNodeChildren(node.children as SrcNode[], key, children);
    return next.some((child, index) => child !== node.children?.[index]) ? { ...node, children: next } : node;
  });
}

/** 懒加载：应用节点展开→拉该应用层级树（跨应用取数）；模板节点展开→拉其数据表为叶子。 */
async function onLoad(node: TreeOption): Promise<void> {
  const n = node as SrcNode;
  if (n.key === undefined) return;
  const nodeKey = n.key;
  // 其他应用节点：懒加载该应用的目录/模板树（数据表层再懒加载一层）。失败置空子树，不炸选择器。
  if (n.isAppNode && n.appId) {
    let children: SrcNode[];
    let loaded = false;
    try {
      const [root] = await Promise.all([host.fetchTree!(n.appId), fetchViewColumnCounts(n.appId)]);
      children = mapTreeChildren(root.children ?? [], n.appId);
      loaded = true;
    } catch {
      children = [];
    }
    if (loaded && children.length === 0) {
      treeData.value = treeData.value.filter(item => item.key !== nodeKey);
      expandedKeys.value = expandedKeys.value.filter(key => key !== nodeKey);
      treeRevision.value += 1;
      return;
    }
    node.children = children;
    treeData.value = replaceNodeChildren(treeData.value, nodeKey, children);
    if (!expandedKeys.value.includes(nodeKey)) expandedKeys.value = [...expandedKeys.value, nodeKey];
    treeRevision.value += 1;
    return;
  }
  if (!n.templateId) return;
  const tables = await props.tablesOf(n.templateId, n.appId);
  const children = tables.map<SrcNode>(t => {
    // 角色以后端权威 table_role 为准（撞号的 sort_no 会把明细误判成主表）。
    const role = tableRoleOf(t, tables);
    return {
      key: `tbl:${n.templateId}:${t.data_table_id}`,
      label: `${t.table_name}（${role === 'main' ? tr('picker.mainTable') : tr('picker.detailTable')} · ${t.field_count}${tr('editor.fieldCountSuffix')}）`,
      isLeaf: true,
      // 数据表叶子沿用与模板同一枚蓝色表格徽标（见 TableIcon 注释）。
      prefix: TableIcon,
      templateId: n.templateId,
      dataTableId: t.data_table_id,
      tableName: t.table_name,
      role,
      appId: n.appId,
      disabled: (props.disabledTableIds ?? []).includes(t.data_table_id)
    };
  });
  node.children = children;
  // Naive Tree 的 lazy callback 收到的是 tree-mate 保存的 raw option；只原地写 children 不一定
  // 能触发外层 data prop 的依赖更新。替换顶层数组让已加载叶子在同一轮稳定渲染，避免 API 已成功
  // 但 UI 仍停在未展开模板的假空态。
  treeData.value = replaceNodeChildren(treeData.value, nodeKey, children);
  if (!expandedKeys.value.includes(nodeKey)) expandedKeys.value = [...expandedKeys.value, nodeKey];
  treeRevision.value += 1;
}

/** 给每个节点挂点击：叶子(数据表/视图/暂存来源)→加入已选（数据表允许重复；视图同表规则一致；
 *  暂存来源一模型至多一张，选中后立即本会话内置灰，见下方 isStaging 分支）；非叶仅展开。
 *  置灰视图叶子（disabledViewIds 命中）不响应点击，并补 title 提示（NTree 无内置 title 支持）。 */
function nodeProps(info: { option: TreeOption }) {
  const o = info.option as SrcNode;
  const props_: Record<string, unknown> = {
    onClick: () => {
      if (o.disabled) return;
      if (o.isLeaf && o.dataTableId && o.templateId) {
        // appId：其他应用的数据表携带其应用 ID（跨应用取数）；当前应用恒 undefined。
        const item: PickedItem = {
          templateId: o.templateId,
          dataTableId: o.dataTableId,
          name: o.tableName ?? '',
          role: o.role ?? 'detail',
          kind: 'table',
          appId: o.appId
        };
        // single 模式（写目标）：已选列表只保留最后一次选择；否则允许重复累加（多来源关联）。
        selected.value = props.single ? [item] : [...selected.value, item];
      } else if (o.isLeaf && o.viewId) {
        // appId：其他应用的视图携带其应用 ID（跨应用取数）；当前应用恒 undefined，
        // 与上方 table 分支同一口径。view_type 随树节点 resource_subtype 透传，供来源行/已选面板
        // 展示常规/组合标签；旧宿主桥未下发时为 undefined，消费方回落通用「视图」展示。
        const item: PickedItem = {
          templateId: '',
          dataTableId: '',
          name: o.viewName ?? '',
          role: 'detail',
          kind: 'view',
          view_id: o.viewId,
          view_type: o.viewType,
          appId: o.appId
        };
        selected.value = props.single ? [item] : [...selected.value, item];
      } else if (o.isLeaf && o.externalObjectId) {
        // S2b：外部数据表叶子。template_id/data_table_id 恒空串（同 view 分支）；不设置 role——
        // 外部表没有主/明细语义（理由同 view）。允许重复加入（与数据表/视图一致，供多次关联/处理）。
        // appId：跨应用叶子携带所属应用 ID，与 view 分支同一处理，当前应用恒
        // undefined（见 PickedItem.appId 头注释）。
        const item: PickedItem = {
          templateId: '',
          dataTableId: '',
          name: o.externalName ?? '',
          role: 'detail',
          kind: 'external',
          external_object_id: o.externalObjectId,
          appId: o.appId
        };
        selected.value = props.single ? [item] : [...selected.value, item];
      } else if (o.isLeaf && o.isStaging) {
        // Phase B：暂存来源，无 templateId/dataTableId/view_id，name 直接取 producerLabel（即节点 label）。
        const item: PickedItem = {
          templateId: '',
          dataTableId: '',
          name: (o.label as string) ?? '',
          role: 'detail',
          kind: 'staging'
        };
        selected.value = props.single ? [item] : [...selected.value, item];
        // 至多一张：本次会话内选过一次后立即置灰该叶子，防止重复添加第二张暂存来源（removeSel/clearAll 撤回时复原）。
        o.disabled = true;
      }
    }
  };
  // 自动化与无障碍消费者必须按服务端稳定身份选择来源，不能把 table_name 当作身份。
  // 这些属性只暴露现有节点数据，不改变展示文本或点击语义；名称发生避重后仍可精确定位。
  if (o.nodeKey) {
    props_['data-source-kind'] = 'category';
    props_['data-node-key'] = o.nodeKey;
  } else if (!o.isLeaf && o.templateId) {
    props_['data-source-kind'] = 'template';
    props_['data-template-id'] = o.templateId;
  } else if (o.isLeaf && o.dataTableId && o.templateId) {
    props_['data-source-kind'] = 'table';
    props_['data-template-id'] = o.templateId;
    props_['data-table-id'] = o.dataTableId;
    props_['data-table-role'] = o.role ?? 'detail';
    props_['data-source-disabled'] = o.disabled ? 'true' : 'false';
  } else if (o.isLeaf && o.viewId) {
    props_['data-source-kind'] = 'view';
    props_['data-view-id'] = o.viewId;
    if (o.appId) props_['data-app-id'] = o.appId;
  } else if (o.isLeaf && o.externalObjectId) {
    props_['data-source-kind'] = 'external';
    props_['data-external-object-id'] = o.externalObjectId;
    if (o.appId) props_['data-app-id'] = o.appId;
  }
  if (o.viewId && o.disabled) props_.title = o.disabledReason ?? tr('picker.viewSelfRefDisabled');
  else if (o.isStaging) props_.title = tr('picker.stagingSource');
  else if (o.dataTableId && o.disabled && props.disabledTableTitle) props_.title = props.disabledTableTitle;
  return props_;
}

/** Phase B：暂存来源叶子若因本会话选中而置灰，撤回已选（移除/清空）时复原可再选（一模型至多一张，
 *  撤回后应恢复可再次添加）。model 层面「已有一张」的初始置灰（props.hasStagingSource）不受此影响。 */
function reenableStagingLeaf() {
  const pinned = treeData.value.find(n => (n as SrcNode).isStaging) as SrcNode | undefined;
  if (pinned && !props.hasStagingSource) pinned.disabled = false;
}

function selectedViewTypeLabel(item: PickedItem): string {
  if (item.view_type === 'combined') return tr('picker.viewCombined');
  if (item.view_type === 'regular') return tr('picker.viewRegular');
  return tr('picker.viewGeneric');
}

function removeSel(i: number) {
  const removed = selected.value[i];
  selected.value = selected.value.filter((_, idx) => idx !== i);
  if (removed?.kind === 'staging') reenableStagingLeaf();
}
// 已选面板头部「清空」：一次性清空整批已选。
function clearAll() {
  const hadStaging = selected.value.some(s => s.kind === 'staging');
  selected.value = [];
  if (hadStaging) reenableStagingLeaf();
}
async function confirm() {
  if (confirming.value) return;
  confirming.value = true;
  await nextTick();
  const snapshot = selected.value.map(item => ({ ...item }));
  if (snapshot.length === 0) {
    confirming.value = false;
    return;
  }
  emit('select', snapshot);
  show.value = false;
}
</script>

<template>
  <NButton
    data-testid="expression-add-source"
    :data-source-picker-role="single ? 'write-target' : 'source'"
    size="tiny"
    class="add-src-btn"
    :disabled="disabled"
    @click="openPicker"
  >
    {{ triggerLabel ?? tr('picker.addSource') }}
  </NButton>
  <!-- 外壳迁到 KDialog：standard 档、可最大化 / 缩放 / 记忆尺寸（沿用 EditorPrefs.sourcePicker）；
       点遮罩无动作；Esc 由弹层栈仲裁（还原最大化 → 关闭）。
       原 data-kimpo-dialog-layer="nested" 标记退役：本层自己登记进 KLayerStack；FormRuntimeDialog / ActionDesignerDialog
       的「更上层可见浮层」判定仍靠 .n-modal-container 命中，兼容。
       src-picker-card / src-footer 类名保留作稳定选择器（宿主与 E2E 测试锚点）；data-* 状态属性经 KDialog 透传到外壳。 -->
  <KDialog
    size-preset="M"
    :show="show"
    :title="pickerTitle"
    class="src-picker-card"
    :data-source-tree-ready="loading ? 'false' : 'true'"
    :data-source-tree-variant="treeVariant"
    :data-selected-count="selected.length"
    :default-size="{ width: 830, height: 670 }"
    memory-key="expression-editor-source-picker"
    :memory-store="pickerMemoryStore"
    flush
    @update:show="v => (show = v)"
  >
    <!-- 中部：左树 / 右已选，等宽分栏，中缝描边分隔（参照 entity-picker 的 pk-col-divided 惯例） -->
    <div class="src-body">
      <div class="src-tree-pane src-col-divided">
        <NSpin :show="loading" class="src-spin">
          <NEmpty v-if="treeData.length === 0 && !loading" size="small" :description="tr('picker.noTemplates')" />
          <!-- 树数据就绪后才挂载 NTree，并以受控 expandedKeys 保留懒加载展开状态。 -->
          <NTree
            :key="treeRevision"
            v-else-if="treeData.length > 0"
            block-line
            expand-on-click
            :selectable="false"
            :data="treeData as any"
            :expanded-keys="expandedKeys"
            @update:expanded-keys="keys => (expandedKeys = keys)"
            :on-load="onLoad"
            :node-props="nodeProps"
          />
        </NSpin>
      </div>
      <div class="src-sel-pane">
        <div class="src-sel-head">
          <span class="src-sel-title">{{ tr('picker.selected') }}{{ selected.length }}）</span>
          <KControlSize v-if="selected.length > 0" include-button :tiers="CLEAR_LINK_TIERS">
            <NButton text type="error" size="tiny" class="src-clear-btn" @click="clearAll">
              <span class="src-clear-btn-inner">
                <span>{{ tr('picker.clear') }}</span>
                <TrashIcon />
              </span>
            </NButton>
          </KControlSize>
        </div>
        <NEmpty v-if="selected.length === 0" size="small" :description="pickerSelectHint" />
        <div v-else class="src-sel-list">
          <div
            v-for="(s, i) in selected"
            :key="i"
            class="src-sel-row"
            :data-source-kind="s.kind ?? 'table'"
            :data-template-id="s.templateId || undefined"
            :data-table-id="s.dataTableId || undefined"
            :data-table-role="s.dataTableId ? s.role : undefined"
          >
            <TableIcon />
            <span class="src-sel-name">{{ s.name }}</span>
            <span v-if="s.kind === 'view'" class="src-sel-type">{{ selectedViewTypeLabel(s) }}</span>
            <button type="button" class="src-sel-remove" :aria-label="tr('common.delete')" @click="removeSel(i)">
              <CloseIcon />
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <!-- 底部：取消 / 确认，KDialogFooter 小档；确认文案带已选数量 -->
      <KDialogFooter
        class="src-footer"
        :confirm-text="`${tr('picker.confirm')}${selected.length}）`"
        :confirm-disabled="selected.length === 0 || confirming"
        @cancel="show = false"
        @confirm="confirm"
      />
    </template>
  </KDialog>
</template>

<style scoped>
.add-src-btn {
  color: rgb(var(--text-secondary-color, 102 102 102));
}

/* 窗口外壳 / 标题栏 / 页脚 / 缩放手柄由 KDialog + KDialogFooter 提供，这里只留内容区业务样式。 */

.src-body {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: 1fr 1fr;
}
.src-col-divided {
  /* 列右缘中缝分隔线：与 entity-picker 的 pk-col-divided 同一套「描边/浅色2」规格 */
  border-right: 1px solid rgb(var(--border-lighter-color, 235 238 245));
}
.src-tree-pane {
  height: 100%;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 24px;
}
.src-spin {
  display: block;
}
/* 树行圆角 + hover 浅色底：naive-ui 内部节点结构版本间略有差异，
   两个可能的内容层选择器都覆盖，确保样式生效。 */
.src-tree-pane :deep(.n-tree-node-content) {
  border-radius: 4px;
}
.src-tree-pane :deep(.n-tree-node-content:hover) {
  background-color: rgb(var(--primary-color) / 0.05) !important;
}
/* 三级节点图标徽标：24×24、圆角 4px（设计系统「圆角/小」），三色分别对应应用/分组/数据表 */
.src-tree-pane :deep(.src-node-icon) {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border-radius: 4px;
  vertical-align: -6px;
}
.src-tree-pane :deep(.src-node-icon-app) {
  background: rgb(var(--success-color) / 0.15);
  color: rgb(var(--success-color));
}
.src-tree-pane :deep(.src-node-icon-category) {
  background: rgb(var(--warning-color) / 0.15);
  color: rgb(var(--warning-color));
}
.src-tree-pane :deep(.src-node-icon-table) {
  background: rgb(var(--primary-50-color, 230 246 255) / 0.5);
  color: rgb(var(--primary-color));
}
.src-tree-pane :deep(.src-node-icon-view) {
  background: rgb(var(--fill-light-color, 245 247 250));
  color: rgb(var(--text-secondary-color, 102 102 102));
}
/* Phase B（动作暂存区）：暂存来源虚拟叶子同 view 走中性提示色（同一"非常规数据表"语义分组）。 */
.src-tree-pane :deep(.src-node-icon-staging) {
  background: rgb(var(--fill-light-color, 245 247 250));
  color: rgb(var(--text-secondary-color, 102 102 102));
}
/* S2b（外部数据表来源）：同 view/staging 走中性提示色——外部表在设计器里"当普通表用"，
   图标只做来源类型区分，不额外强调。 */
.src-tree-pane :deep(.src-node-icon-external) {
  background: rgb(var(--fill-light-color, 245 247 250));
  color: rgb(var(--text-secondary-color, 102 102 102));
}

.src-sel-pane {
  display: flex;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  padding: 16px 24px;
  overflow-y: auto;
}
.src-sel-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.src-sel-title {
  color: rgb(var(--base-text-color));
  font-size: 14px;
  font-weight: 500;
}
/* 「清空」文字链接内部：文字 + 垃圾桶图标，间距 4（沿用改前 gap）；高 / 字号 / 内边距由 CLEAR_LINK_TIERS 钉定 */
.src-clear-btn-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.src-sel-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.src-sel-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 4px;
  background: rgb(var(--primary-50-color, 230 246 255) / 0.5);
}
.src-sel-row :deep(.src-node-icon-table) {
  background: transparent;
  color: rgb(var(--primary-color));
}
.src-sel-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: rgb(var(--base-text-color));
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.src-sel-type {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 10px;
  background: rgb(var(--fill-light-color, 245 247 250));
  color: rgb(var(--text-secondary-color, 102 102 102));
  font-size: 11px;
}
.src-sel-remove {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(var(--text-secondary-color, 102 102 102));
  cursor: pointer;
}
.src-sel-remove:hover {
  color: rgb(var(--base-text-color));
}

</style>
