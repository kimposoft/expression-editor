import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import FieldTreeDock from './FieldTreeDock.vue';
import type { DockColumn, TemplateField } from './types';

const field = (id: string, name: string): TemplateField => ({
  field_id: id, field_code: id, field_name: name, data_type: 'text', display_style: 'text', sort_no: 0,
  is_searchable: true, is_filterable: true, is_sortable: true, is_list_visible: true
});
const current: DockColumn = { header: '本报表', tables: [{ alias: 'bt0', label: '订单', fields: [field('amount', '金额')] }] };
const sources: DockColumn[] = [
  { header: '客户模板', tables: [{ alias: 't1', label: '客户', fields: [field('customer', '客户名称')] }] },
  { header: '库存模板', tables: [{ alias: 't2', label: '库存', fields: [field('stock', '库存数量')] }] }
];
const mounted: VueWrapper[] = [];
function dock(compact = true, props: Partial<{ currentColumn: DockColumn; sourceColumns: DockColumn[] }> = {}) {
  const wrapper = mount(FieldTreeDock, { attachTo: document.body, props: { currentColumn: current, sourceColumns: sources, compact, showFunctions: true, ...props } });
  mounted.push(wrapper);
  return wrapper;
}
const header = (wrapper: VueWrapper, key: string) => wrapper.findAll('.ftd-col-header').find(node => node.attributes('data-card-key') === key)!;
const body = (wrapper: VueWrapper, key: string) => wrapper.findAll('.ftd-col-body').find(node => node.attributes('data-card-key') === key)!;
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); });

describe('共享表达式整卡折叠', () => {
  it('低高度只展开首个可用卡，每张卡独立收放；内容保活且 aria-controls 正确', async () => {
    const wrapper = dock();
    expect(header(wrapper, 'current').attributes('aria-expanded')).toBe('true');
    for (const key of ['source:t1', 'source:t2', 'vars']) {
      const button = header(wrapper, key);
      expect(button.element.tagName).toBe('BUTTON');
      expect(button.attributes('type')).toBe('button');
      expect(button.attributes('aria-expanded')).toBe('false');
      expect(button.attributes('aria-controls')).toBe(body(wrapper, key).attributes('id'));
      expect(body(wrapper, key).isVisible()).toBe(false);
      await button.trigger('click');
      expect(button.attributes('aria-expanded')).toBe('true');
      expect(body(wrapper, key).isVisible()).toBe(true);
    }
    const customer = body(wrapper, 'source:t1').find('.ftd-field').element;
    await header(wrapper, 'source:t1').trigger('click');
    expect(body(wrapper, 'source:t1').isVisible()).toBe(false);
    expect(body(wrapper, 'source:t1').find('.ftd-field').element).toBe(customer);
    expect(header(wrapper, 'source:t2').attributes('aria-expanded')).toBe('true');
  });

  it('搜索打开已折叠命中卡；搜索内手动收放不改原状态，清空/插入后可恢复', async () => {
    const wrapper = dock();
    const input = wrapper.find('.ftd-search input');
    await input.setValue('客户名称');
    expect(body(wrapper, 'source:t1').isVisible()).toBe(true);
    await header(wrapper, 'source:t1').trigger('click');
    expect(body(wrapper, 'source:t1').isVisible()).toBe(false);
    await input.setValue('客户');
    expect(body(wrapper, 'source:t1').isVisible()).toBe(true);
    await body(wrapper, 'source:t1').find('.ftd-field').trigger('click');
    expect(wrapper.emitted('pick')?.at(-1)).toEqual([{ kind: 'source_field', alias: 't1', field_id: 'customer' }]);
    (wrapper.vm as unknown as { clearSearch(): void }).clearSearch();
    await wrapper.vm.$nextTick();
    expect(body(wrapper, 'source:t1').isVisible()).toBe(false);
    await header(wrapper, 'source:t1').trigger('click');
    await input.setValue('库存');
    await input.trigger('keydown', { key: 'Escape' });
    expect(body(wrapper, 'source:t1').isVisible()).toBe(true);
    expect(body(wrapper, 'source:t2').isVisible()).toBe(false);
  });

  it('变量/函数同样参与全局搜索，字段与函数行用原生按钮保留键盘激活语义', async () => {
    const wrapper = dock();
    await wrapper.find('.ftd-search input').setValue('SUM');
    expect(body(wrapper, 'vars').isVisible()).toBe(true);
    expect(body(wrapper, 'vars').find('.n-empty').exists()).toBe(false);
    const fn = body(wrapper, 'vars').find('.ftd-fn');
    expect(fn.element.tagName).toBe('BUTTON');
    await fn.trigger('click');
    expect(wrapper.emitted('pick-function')).toHaveLength(1);
    expect(body(wrapper, 'current').findAll('.ftd-field')).toHaveLength(0);
  });

  it('宽裕高度默认全展开，但保留本次会话手动状态；来源重排不串状态', async () => {
    const wrapper = dock(false);
    expect(wrapper.findAll('.ftd-col-header').every(node => node.attributes('aria-expanded') === 'true')).toBe(true);
    await header(wrapper, 'source:t1').trigger('click');
    await wrapper.setProps({ compact: true, sourceColumns: [...sources].reverse() });
    expect(header(wrapper, 'source:t1').attributes('aria-expanded')).toBe('false');
    await wrapper.setProps({ compact: false });
    expect(header(wrapper, 'source:t1').attributes('aria-expanded')).toBe('false');
    expect(header(wrapper, 'source:t2').attributes('aria-expanded')).toBe('true');
    const fresh = dock(false);
    expect(header(fresh, 'source:t1').attributes('aria-expanded')).toBe('true');
  });

  it('同一宿主中多个编辑器的 aria-controls 不串卡片', () => {
    const wrapper = mount(defineComponent({ setup: () => () => h('div', [
      h(FieldTreeDock, { currentColumn: current, sourceColumns: sources }),
      h(FieldTreeDock, { currentColumn: current, sourceColumns: sources })
    ]) }));
    mounted.push(wrapper);
    const ids = wrapper.findAll('.ftd-col-body').map(node => node.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('本报表为空时首个有用来源展开；无来源时变量卡展开', () => {
    const wrapper = dock(true, { currentColumn: { header: '本报表', tables: [] } });
    expect(header(wrapper, 'source:t1').attributes('aria-expanded')).toBe('true');
    const empty = dock(true, { currentColumn: { header: '本报表', tables: [] }, sourceColumns: [] });
    expect(header(empty, 'vars').attributes('aria-expanded')).toBe('true');
  });

  it('搜索恢复与容器变矮隐藏焦点内容时，焦点回卡头而非留在隐藏字段', async () => {
    const wrapper = dock();
    await wrapper.find('.ftd-search input').setValue('客户');
    const customer = body(wrapper, 'source:t1').find('.ftd-field').element as HTMLElement;
    customer.focus();
    expect(document.activeElement).toBe(customer);
    (wrapper.vm as unknown as { clearSearch(): void }).clearSearch();
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(header(wrapper, 'source:t1').element);
    await wrapper.setProps({ compact: false });
    (body(wrapper, 'source:t2').find('.ftd-field').element as HTMLElement).focus();
    await wrapper.setProps({ compact: true });
    expect(document.activeElement).toBe(header(wrapper, 'source:t2').element);
  });
});
