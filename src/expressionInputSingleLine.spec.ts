import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import ExpressionInput from './ExpressionInput.vue';
import type { TemplateField, ValueRef } from './types';

/**
 * ExpressionInput.vue 单测：
 *   A. 默认模式（singleLine 缺省 false）：抽出 ExpressionTokens 后，DOM 结构/类名与抽取前一致
 *     。
 *   B. singleLine=true：胶囊区域溢出检测（ResizeObserver 比较 scrollWidth/clientWidth）驱动
 *      「…」指示；溢出时悬停约 300ms 弹出完整表达式浮层，未溢出/未到时长不弹出。
 *
 * happy-dom 不做真实布局，scrollWidth/clientWidth 恒为 0——溢出场景需要：
 *   1) 全局桩 ResizeObserver，捕获真实传入的回调，供测试手动调用模拟一次 resize；
 *   2) 用 Object.defineProperty 在目标元素上覆写 scrollWidth/clientWidth。
 */

const F_QTY = { field_id: 'fld_qty', field_name: '数量', data_type: 'number' } as TemplateField;
const SOURCE_TABLES = [{ alias: 't1', dataTableId: 'tbl_src', name: '物料', fields: [F_QTY] }];

function mountInput(overrides: {
  modelValue?: ValueRef | null;
  sourceTables?: typeof SOURCE_TABLES;
  singleLine?: boolean;
  advanced?: boolean;
}) {
  return mount(ExpressionInput, {
    props: {
      modelValue: overrides.modelValue ?? null,
      sourceTables: overrides.sourceTables ?? [],
      formTables: [],
      slotKey: 'slot-1',
      singleLine: overrides.singleLine ?? false,
      advanced: overrides.advanced ?? false
    }
  });
}

describe('ExpressionInput 默认模式（singleLine 缺省 false）：DOM 与抽取前一致', () => {
  it('有值：渲染 .tok 片段（表主题色类），不出现任何 singleLine 专属元素', () => {
    const wrapper = mountInput({
      modelValue: { kind: 'source_field', alias: 't1', field_id: 'fld_qty' } as ValueRef,
      sourceTables: SOURCE_TABLES,
      advanced: true
    });
    const toks = wrapper.findAll('.tok');
    expect(toks.length).toBeGreaterThan(0);
    expect(toks[0].classes()).toContain('tok-source_field');
    expect(toks[0].text()).toBe('{物料.数量}');

    // singleLine 专属结构一律不出现。
    expect(wrapper.find('.expr-tokens-row').exists()).toBe(false);
    expect(wrapper.find('.expr-tokens-clip').exists()).toBe(false);
    expect(wrapper.find('[data-testid="expr-overflow-ellipsis"]').exists()).toBe(false);
    expect(document.body.querySelector('[data-testid="expr-tokens-popover"]')).toBeNull();

    expect(wrapper.find('[data-testid="expr-fx-entry"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="expr-clear"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('空值：渲染 .expr-empty-dash 占位（唯一定义处已搬到 ExpressionTokens.vue，视觉不变）', () => {
    const wrapper = mountInput({ modelValue: null });
    expect(wrapper.find('.expr-empty-dash').exists()).toBe(true);
    expect(wrapper.find('.tok').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('ExpressionInput singleLine：溢出检测 + 悬浮浮层（自绘，非 NPopover）', () => {
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    cb: () => void;
    constructor(cb: () => void) {
      this.cb = cb;
      FakeResizeObserver.instances.push(this);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 把胶囊裁切区量成「溢出」（scrollWidth > clientWidth）并推一次 ResizeObserver 回调。 */
  async function forceOverflow(wrapper: ReturnType<typeof mountInput>): Promise<void> {
    const clipEl = wrapper.find('.expr-tokens-clip').element as HTMLElement;
    Object.defineProperty(clipEl, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(clipEl, 'clientWidth', { value: 100, configurable: true });
    FakeResizeObserver.instances[0].cb();
    await nextTick();
  }

  it('未溢出（happy-dom 默认 scrollWidth=clientWidth=0）：不显示「…」，悬停也不弹浮层', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountInput({ singleLine: true, modelValue: { kind: 'const', value: '短文本' } as ValueRef });
      await nextTick();
      await nextTick();

      expect(wrapper.find('.expr-tokens-clip').exists()).toBe(true);
      expect(wrapper.find('[data-testid="expr-overflow-ellipsis"]').exists()).toBe(false);

      await wrapper.find('.expr-tokens-row').trigger('mouseenter');
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(document.body.querySelector('[data-testid="expr-tokens-popover"]')).toBeNull();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('溢出：显示「…」；悬停不足 300ms 不弹，满 300ms 弹出完整表达式浮层；移出即收起', async () => {
    vi.useFakeTimers();
    try {
      const longText = '一段很长很长很长很长的文本用来测试单行模式的溢出检测逻辑是否正确工作';
      const wrapper = mountInput({ singleLine: true, modelValue: { kind: 'const', value: longText } as ValueRef });
      await nextTick();
      await nextTick();

      // 装观察器时机：singleLine=true 从挂载起就该有一个实例在观察胶囊区域。
      expect(FakeResizeObserver.instances).toHaveLength(1);
      await forceOverflow(wrapper);
      expect(wrapper.find('[data-testid="expr-overflow-ellipsis"]').exists()).toBe(true);

      const row = wrapper.find('.expr-tokens-row');
      await row.trigger('mouseenter');
      vi.advanceTimersByTime(200);
      await nextTick();
      expect(document.body.querySelector('[data-testid="expr-tokens-popover"]'), '不足 300ms 不该弹出').toBeNull();

      vi.advanceTimersByTime(150); // 累计 350ms，越过 300ms 阈值。
      await nextTick();
      const popoverEl = document.body.querySelector('[data-testid="expr-tokens-popover"]');
      expect(popoverEl).not.toBeNull();
      expect(popoverEl?.textContent).toContain(longText);

      await row.trigger('mouseleave');
      await nextTick();
      expect(document.body.querySelector('[data-testid="expr-tokens-popover"]')).toBeNull();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('宽度恢复（scrollWidth ≤ clientWidth）后再次触发：「…」消失，且不再能弹出浮层', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountInput({ singleLine: true, modelValue: { kind: 'const', value: '一段较长的文本内容用于测试' } as ValueRef });
      await nextTick();
      await nextTick();
      await forceOverflow(wrapper);
      expect(wrapper.find('[data-testid="expr-overflow-ellipsis"]').exists()).toBe(true);

      // 容器变宽（如视图设计器拖宽列）：clientWidth 追上 scrollWidth，再次触发观察器回调应清掉指示。
      const clipEl = wrapper.find('.expr-tokens-clip').element as HTMLElement;
      Object.defineProperty(clipEl, 'clientWidth', { value: 320, configurable: true });
      FakeResizeObserver.instances[0].cb();
      await nextTick();
      expect(wrapper.find('[data-testid="expr-overflow-ellipsis"]').exists()).toBe(false);

      await wrapper.find('.expr-tokens-row').trigger('mouseenter');
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(document.body.querySelector('[data-testid="expr-tokens-popover"]')).toBeNull();
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('非 singleLine 模式不装 ResizeObserver（零额外开销）', async () => {
    const wrapper = mountInput({ singleLine: false, modelValue: { kind: 'const', value: '文本' } as ValueRef });
    await nextTick();
    expect(FakeResizeObserver.instances).toHaveLength(0);
    wrapper.unmount();
  });
});
