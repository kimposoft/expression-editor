import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';
import type { ValueRef } from './types';

/**
 * 表达式持久抽屉总线：协调「右侧统一字段抽屉」与「当前激活的表达式输入槽」。
 */
export interface ExpressionDrawerBus {
  /** 当前激活槽 key（用于高亮当前正在编辑的输入）。 */
  activeKey: Ref<string>;
  /** 某输入框被点击时注册自己为激活槽（key 唯一 + 它的插入处理器）。 */
  setActive(key: string, handler: (ref: ValueRef) => void): void;
  /** 抽屉点选一项时调用 → 路由到当前激活槽的处理器。 */
  insert(ref: ValueRef): void;
  /** 清空激活（如关闭/失焦），避免误插。 */
  clear(): void;
}

const KEY: InjectionKey<ExpressionDrawerBus> = Symbol('expression-drawer-bus');

/** 由 ExpressionEditor 提供。返回总线供编辑器把抽屉 insert 接到激活槽。 */
export function provideExpressionDrawer(): ExpressionDrawerBus {
  const activeKey = ref('');
  let handler: ((ref: ValueRef) => void) | null = null;
  const bus: ExpressionDrawerBus = {
    activeKey,
    setActive(key, h) {
      activeKey.value = key;
      handler = h;
    },
    insert(ref) {
      handler?.(ref);
    },
    clear() {
      activeKey.value = '';
      handler = null;
    }
  };
  provide(KEY, bus);
  return bus;
}

/** 由 ExpressionInput 等消费。未在编辑器内时返回 null（容错，单元测试/独立渲染用）。 */
export function useExpressionDrawer(): ExpressionDrawerBus | null {
  return inject(KEY, null);
}
