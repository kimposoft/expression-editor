/**
 *
 * 选择「hook 而非组件」：
 * 1. 本包既有可复用逻辑均以 composable 形式沉淀（useExpressionContext.ts 的 useExpressionContext /
 *    expressionDrawerBus.ts 的 provideExpressionDrawer·useExpressionDrawer），本文件延续同一约定；
 * 3. 纯函数式状态机不依赖 Vue 组件实例（不注册 onBeforeUnmount 等生命周期钩子），单测无需挂载组件即可
 *    直接调用 onPointerDown/onReset 断言，成本最低。
 */
import { ref, type Ref } from 'vue';

export interface UseResizableSplitOptions {
  /** 初始高度（px）：通常取自宿主持久化偏好（ExpressionHost.loadEditorPrefs）或设计默认值。
   *  超出 [minHeight, maxHeight] 时会被立即钳制，不会以越界值渲染首帧。 */
  initialHeight: number;
  resetHeight: number;
  /** 允许的最小高度（px）。 */
  minHeight: number;
  /** 允许的最大高度（px）。 */
  maxHeight: number;
}

export interface UseResizableSplitReturn {
  /** 当前高度（px，响应式），驱动上区域 :style="{ height: `${height}px` }"。 */
  height: Ref<number>;
  /** 是否正在拖拽中：拖拽期间调用方应关掉高度的 CSS transition（否则跟手有回弹感），
   *  对齐 ActionDesigner.vue 的 .ad-right.resizing 用法。 */
  resizing: Ref<boolean>;
  /** 绑定到把手的 @pointerdown。 */
  onPointerDown: (e: PointerEvent) => void;
  /** 绑定到把手的 @dblclick，复位到 resetHeight。 */
  onReset: () => void;
}

/** 纵向可拖拽分隔条的状态与交互逻辑（不含渲染）。 */
export function useResizableSplit(options: UseResizableSplitOptions): UseResizableSplitReturn {
  const { initialHeight, resetHeight, minHeight, maxHeight } = options;

  /** 把任意高度钳制进 [minHeight, maxHeight]。 */
  function clamp(v: number): number {
    return Math.min(maxHeight, Math.max(minHeight, v));
  }

  const height = ref(clamp(initialHeight));
  const resizing = ref(false);

  function onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    resizing.value = true;
    const startY = e.clientY;
    const startHeight = height.value;
    const move = (ev: PointerEvent) => {
      // 向下拖 = 增高：高度增量取起点与当前指针的垂直位移差（与 ActionDesigner 的水平位移换算同理，
      // 纵向分栏把手直接跟随指针方向，无需像其"面板在右侧"那样反向取差）。
      height.value = clamp(startHeight + (ev.clientY - startY));
    };
    const up = () => {
      resizing.value = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onReset(): void {
    height.value = clamp(resetHeight);
  }

  return { height, resizing, onPointerDown, onReset };
}
