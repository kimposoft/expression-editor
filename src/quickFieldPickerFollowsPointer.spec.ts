/**
 *
 * 两段链路：
 * ① ExpressionInput.activate(evtOrOpts?: MouseEvent | {x?, y?, drawerOnly?})——值区点击把原生
 *   MouseEvent 传入，记录 clientX/clientY 作为面板定位点；opts.x/y 是程序化坐标，优先于鼠标事件；
 *   都没有（键盘触发 / 无上次记录的「插完跳下一行」）时回落既有 trigger 锚点定位。
 * ② QuickFieldPicker.vue 新增 x/y 坐标定位 props，透传给 naive-ui NPopover 的同名手动定位 props
 *   （均传入才生效，判据同 NPopover 自身 positionManuallyRef）；面板按估算尺寸钳制在视口内，
 *   避免点击靠近右/下边缘时被裁切到视口外。
 *
 * 本文件钉：A 真实 DOM 点击（带 clientX/clientY）→ 面板收到对应坐标；B activate() 无参数 → 坐标
 * 回落 undefined（锚点定位不受影响）；activate({x,y}) 程序化坐标 → 面板按该坐标定位（不依赖鼠标
 * 事件）；C QuickFieldPicker 视口钳制（x 接近 window.innerWidth 时被钳，不透传裸值）；D x/y 均未
 * 传入时 QuickFieldPicker 原样透传 undefined 给 NPopover（既有锚点弹出路径不受影响）。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import ExpressionInput from './ExpressionInput.vue';
import QuickFieldPicker from './QuickFieldPicker.vue';

/** 捕获传入的 props，不渲染任何内容——本文件只关心「⊞ 面板收到什么定位坐标」，不关心其内部
 *  UI（搜索框/字段列表等），避免额外去桩 NInput/NEmpty 等无关组件。 */
const QuickFieldPickerStub = defineComponent({
  name: 'QuickFieldPickerStub',
  props: ['show', 'title', 'sourceTables', 'formTables', 'dockColumns', 'allowNullConst', 'x', 'y'],
  emits: ['update:show', 'pick'],
  setup() {
    return () => null;
  }
});

const NPopoverStub: Component = defineComponent({
  name: 'NPopoverStub',
  props: ['show', 'trigger', 'placement', 'showArrow', 'width', 'x', 'y', 'onClickoutside'],
  emits: ['update:show'],
  setup() {
    return () => null;
  }
});

describe('ExpressionInput.activate() 记录点击坐标 → 透传给 QuickFieldPicker', () => {
  function mountInput() {
    return mount(ExpressionInput, {
      props: {
        modelValue: null,
        sourceTables: [],
        formTables: [],
        slotKey: 'row-1',
        preferQuickPick: true
      },
      global: { stubs: { QuickFieldPicker: QuickFieldPickerStub } }
    });
  }

  it('A：真实 DOM 点击（带 clientX/clientY）打开面板 → QuickFieldPicker 收到同一坐标', async () => {
    const wrapper = mountInput();
    await wrapper.find('.expr-input').trigger('click', { clientX: 300, clientY: 200 });

    const qfp = wrapper.findComponent(QuickFieldPickerStub);
    expect(qfp.props('show')).toBe(true);
    expect(qfp.props('x')).toBe(300);
    expect(qfp.props('y')).toBe(200);
  });

  it('直接点值区（不经宿主行级点击）打开 → emit quick-pick-open 上报定位点；无坐标回落锚点时不发（用户 09-09 三次反馈：连续选择层叠起点）', async () => {
    const wrapper = mountInput();
    await wrapper.find('.expr-input').trigger('click', { clientX: 300, clientY: 200 });
    expect(wrapper.emitted('quick-pick-open')?.at(-1)).toEqual([{ x: 300, y: 200 }]);

    const plain = mountInput();
    (plain.vm as unknown as { activate: (arg?: unknown) => void }).activate();
    await plain.vm.$nextTick();
    expect(plain.emitted('quick-pick-open')).toBeUndefined();
  });

  it('B：activate() 无参数（键盘触发 / 插完跳下一行的程序化调用）→ x/y 回落 undefined', async () => {
    const wrapper = mountInput();
    (wrapper.vm as unknown as { activate: (arg?: unknown) => void }).activate();
    await wrapper.vm.$nextTick();

    const qfp = wrapper.findComponent(QuickFieldPickerStub);
    expect(qfp.props('show')).toBe(true);
    expect(qfp.props('x')).toBeUndefined();
    expect(qfp.props('y')).toBeUndefined();
  });

  it('activate({x,y}) 程序化坐标→ 面板按该坐标定位，不依赖鼠标事件', async () => {
    const wrapper = mountInput();
    (wrapper.vm as unknown as { activate: (arg?: unknown) => void }).activate({ x: 300, y: 236 });
    await wrapper.vm.$nextTick();

    const qfp = wrapper.findComponent(QuickFieldPickerStub);
    expect(qfp.props('show')).toBe(true);
    expect(qfp.props('x')).toBe(300);
    expect(qfp.props('y')).toBe(236);
  });

  it('先带坐标点开、再程序化 activate() 重开 → 坐标显式清空，不沿用上一次点击位置', async () => {
    const wrapper = mountInput();
    await wrapper.find('.expr-input').trigger('click', { clientX: 300, clientY: 200 });
    expect(wrapper.findComponent(QuickFieldPickerStub).props('x')).toBe(300);

    (wrapper.vm as unknown as { activate: (arg?: unknown) => void }).activate();
    await wrapper.vm.$nextTick();
    const qfp = wrapper.findComponent(QuickFieldPickerStub);
    expect(qfp.props('x')).toBeUndefined();
    expect(qfp.props('y')).toBeUndefined();
  });

  it('opts.drawerOnly=true（宿主行级点击程序化调用）仍不打开 ⊞ 快捷面板：签名放宽不影响既有分支', async () => {
    const wrapper = mountInput();
    (wrapper.vm as unknown as { activate: (arg?: unknown) => void }).activate({ drawerOnly: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(QuickFieldPickerStub).props('show')).toBe(false);
  });
});

describe('QuickFieldPicker：x/y 坐标定位 props 透传与视口钳制', () => {
  function mountPicker(x?: number, y?: number) {
    return mount(QuickFieldPicker, {
      props: { show: false, sourceTables: [], formTables: [], x, y },
      global: { stubs: { Popover: NPopoverStub } }
    });
  }

  it('手动定位模式下显式传 on-clickoutside，触发后 emit update:show=false（用户 09-09 反馈：面板可重复打开）', async () => {
    const wrapper = mountPicker(300, 200);
    const popover = wrapper.findComponent(NPopoverStub);
    const handler = popover.props('onClickoutside') as (() => void) | undefined;
    expect(typeof handler).toBe('function');
    handler!();
    expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false]);
  });

  it('D：x/y 均未传入 → 原样透传 undefined 给 NPopover（既有 trigger 锚点定位不受影响）', () => {
    const wrapper = mountPicker();
    const popover = wrapper.findComponent(NPopoverStub);
    expect(popover.props('x')).toBeUndefined();
    expect(popover.props('y')).toBeUndefined();
  });

  it('x/y 均传入且未越界 → 原样透传给 NPopover（等同 naive-ui 手动定位模式）', () => {
    const wrapper = mountPicker(300, 200);
    const popover = wrapper.findComponent(NPopoverStub);
    expect(popover.props('x')).toBe(300);
    expect(popover.props('y')).toBe(200);
  });

  it('C：clientX 接近 window.innerWidth 时 x 被钳（不透传裸值，钳制到「视口宽 − 面板宽 − 边距」内）', () => {
    const nearRightEdge = window.innerWidth - 4;
    const wrapper = mountPicker(nearRightEdge, 200);
    const popover = wrapper.findComponent(NPopoverStub);
    const x = popover.props('x') as number;
    expect(x).toBeLessThan(nearRightEdge);
    expect(x).toBeLessThanOrEqual(window.innerWidth - 360 - 8);
  });

  it('clientY 接近 window.innerHeight 时 y 同理被钳', () => {
    const nearBottomEdge = window.innerHeight - 4;
    const wrapper = mountPicker(300, nearBottomEdge);
    const popover = wrapper.findComponent(NPopoverStub);
    const y = popover.props('y') as number;
    expect(y).toBeLessThan(nearBottomEdge);
  });

  it('只传 x 不传 y（不完整坐标）→ 视为未定位，两者都回落 undefined', () => {
    const wrapper = mountPicker(300, undefined);
    const popover = wrapper.findComponent(NPopoverStub);
    expect(popover.props('x')).toBeUndefined();
    expect(popover.props('y')).toBeUndefined();
  });
});
