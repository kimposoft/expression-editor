import { afterEach, describe, expect, it } from 'vitest';
import {
  SYSTEM_VARIABLES,
  systemVariablesCatalog,
  setExtraSystemVariables,
  isFieldTypeUnsupported,
  type SystemVariableDef
} from './useExpressionContext';

// systemVariablesRef/extraSystemVariablesRef 是模块级单例：每个用例结束后清空追加项，避免跨用例串味
// （不清空的话，后一个用例会看到前一个用例遗留的追加项，断言会假阳性通过或诡异失败）。
afterEach(() => {
  setExtraSystemVariables(null);
});

describe('systemVariablesCatalog', () => {
  it('①未追加（初值/卸载后）：与宿主内置 fallback 目录（SYSTEM_VARIABLES）逐字节一致', () => {
    expect(systemVariablesCatalog.value).toEqual(SYSTEM_VARIABLES);
  });

  it('②追加不冲突的系统变量：结果＝宿主项 + 追加项，宿主项仍在且顺序不变，追加项排在其后', () => {
    const extra: SystemVariableDef[] = [
      { var_id: 'flow.instance_id', label: '流程实例ID', type: 'string' },
      { var_id: 'node["approve1"].result.approved', label: '审批节点(approve1)结果', type: 'boolean' }
    ];
    setExtraSystemVariables(extra);

    expect(systemVariablesCatalog.value).toEqual([...SYSTEM_VARIABLES, ...extra]);
    // 单独断言"宿主项仍在"：不是整体相等断言的重复，而是显式钉死宿主目录的前缀位置不受影响。
    expect(systemVariablesCatalog.value.slice(0, SYSTEM_VARIABLES.length)).toEqual(SYSTEM_VARIABLES);
  });

  it('③同 var_id 去重：追加项撞上宿主内置 var_id 时静默丢弃，宿主定义不被覆盖', () => {
    const extra: SystemVariableDef[] = [
      // 与宿主内置 'current_user' 撞 var_id，但 label 刻意写成不同文案——用于断言"宿主项优先保留"
      // 不是碰巧文案一样看不出差异。
      { var_id: 'current_user', label: '追加方自己的当前用户（应被丢弃）', type: 'string' },
      { var_id: 'flow.instance_id', label: '流程实例ID', type: 'string' } // 不冲突，应正常追加
    ];
    setExtraSystemVariables(extra);

    const ids = systemVariablesCatalog.value.map(v => v.var_id);
    // 未被追加项复制出第二条同 var_id：整份目录长度＝宿主 5 项 + 仅 1 项不冲突追加。
    expect(systemVariablesCatalog.value.length).toBe(SYSTEM_VARIABLES.length + 1);
    expect(ids.filter(id => id === 'current_user')).toHaveLength(1);

    const hostDefined = SYSTEM_VARIABLES.find(v => v.var_id === 'current_user')!;
    const merged = systemVariablesCatalog.value.find(v => v.var_id === 'current_user')!;
    expect(merged.label).toBe(hostDefined.label); // 宿主定义原样保留，不是追加方那份"应被丢弃"文案
    expect(ids).toContain('flow.instance_id'); // 不冲突的追加项正常生效
  });

  it('④清空（setExtraSystemVariables(null)）：还原为仅宿主目录（对应组件卸载时的收敛动作）', () => {
    setExtraSystemVariables([{ var_id: 'flow.instance_id', label: '流程实例ID', type: 'string' }]);
    expect(systemVariablesCatalog.value.length).toBe(SYSTEM_VARIABLES.length + 1);

    setExtraSystemVariables(null);
    expect(systemVariablesCatalog.value).toEqual(SYSTEM_VARIABLES);
  });

  it('⑤传空数组等价于清空（不是"传了追加项但内容为空"的另一种状态）', () => {
    setExtraSystemVariables([{ var_id: 'flow.instance_id', label: 'x', type: 'string' }]);
    setExtraSystemVariables([]);
    expect(systemVariablesCatalog.value).toEqual(SYSTEM_VARIABLES);
  });
});

describe('SYSTEM_VARIABLES 静态镜像与后端 动作网关.SystemVariableCatalog() 对齐', () => {
  it('12 项 var_id/label/type 与后端目录逐条一致（含 current_user 标签修正 + current_user_name + E6 六条）', () => {
    expect(SYSTEM_VARIABLES).toEqual([
      { var_id: 'current_user', label: '当前用户ID', type: 'string' },
      { var_id: 'current_user_name', label: '当前用户姓名', type: 'string' },
      { var_id: 'current_user_dept', label: '当前用户所在部门', type: 'string' },
      { var_id: 'current_time', label: '当前时间', type: 'datetime' },
      { var_id: 'today', label: '今天', type: 'datetime' },
      { var_id: 'record_id', label: '当前记录ID', type: 'string' },
      { var_id: 'current_user_login', label: '当前用户登录名', type: 'string' },
      { var_id: 'current_user_role', label: '当前用户角色', type: 'string' },
      { var_id: 'current_user_org_name', label: '当前用户所在部门名称', type: 'string' },
      { var_id: 'current_user_org_code', label: '当前用户所在部门编码', type: 'string' },
      { var_id: 'record_status_draft', label: '记录状态-草稿', type: 'string' },
      { var_id: 'record_status_submitted', label: '记录状态-已提交', type: 'string' }
    ]);
  });
});

describe('isFieldTypeUnsupported', () => {
  it('空名单：任意类型都不命中', () => {
    expect(isFieldTypeUnsupported('attachment', [])).toBe(false);
    expect(isFieldTypeUnsupported('text', [])).toBe(false);
    expect(isFieldTypeUnsupported(undefined, [])).toBe(false);
  });

  it("传 ['attachment']：attachment 命中，其余类型（含 image）不命中——调用方需要什么类型自己列全", () => {
    expect(isFieldTypeUnsupported('attachment', ['attachment'])).toBe(true);
    expect(isFieldTypeUnsupported('image', ['attachment'])).toBe(false);
    expect(isFieldTypeUnsupported('text', ['attachment'])).toBe(false);
  });

  it('大小写/前后空白不敏感（归一化口径同 types.ts isSourceTreeHiddenFieldDataType）', () => {
    expect(isFieldTypeUnsupported('attachment', ['  Attachment  '])).toBe(true);
    expect(isFieldTypeUnsupported('ATTACHMENT', ['  Attachment  '])).toBe(true);
  });

  it('不同调用互不影响（纯函数无共享状态，天然免疫模块单例的跨实例串扰问题）', () => {
    expect(isFieldTypeUnsupported('attachment', ['attachment'])).toBe(true);
    // 紧接着换一份不含 attachment 的名单调用：不会残留上一次调用的状态。
    expect(isFieldTypeUnsupported('attachment', ['image'])).toBe(false);
    expect(isFieldTypeUnsupported('attachment', [])).toBe(false);
  });
});
