<script setup lang="ts">
import { computed } from 'vue';

/**
 * 字段数据类型小图标（2026-09-02 随 QuickFieldPicker 尾标改版新增）。
 *
 * 职责单一：把 TemplateField.data_type（后端字段数据类型字符串）归一化成一个 12×12 内联 SVG
 * 图标——包内没有图标库依赖（ExpressionEditor 既有惯例即手写内联 SVG，如条件面板的 ✕），
 * 故此处同样用内联 SVG 自绘，不引入外部图标依赖。
 *
 * 归一化口径：按后端实际在用的 data_type 取值集合映射（text/legacy-text/number/int/integer/
 * decimal/bigint/date/datetime/time/boolean/bool/attachment/user/dept/select/reference），
 * 大小写不敏感；未识别的未来类型回落通用「字段」图标（fail-safe，不报错不空白）。
 * 特殊值 'variable'：系统变量行专用（QuickFieldPicker 变量分组传入），不是后端字段类型。
 * data_type 未传/为空（Lite 快照可能缺省）同样回落通用图标。
 */
const props = defineProps<{
  /** 字段数据类型原文（可缺省——Lite 形态字段快照不保证携带）；'variable'=系统变量专用键。 */
  dataType?: string | null;
}>();

type IconKey =
  | 'text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'boolean'
  | 'attachment'
  | 'user'
  | 'select'
  | 'reference'
  | 'variable'
  | 'generic';

/** data_type 原文 → 图标键。同义/子类合并：整数与小数同为 number；user/dept 同为人员类。 */
const TYPE_TO_ICON: Record<string, IconKey> = {
  'text': 'text',
  'legacy-text': 'text',
  'string': 'text',
  'number': 'number',
  'int': 'number',
  'integer': 'number',
  'bigint': 'number',
  'decimal': 'number',
  'date': 'date',
  'datetime': 'datetime',
  'time': 'time',
  'boolean': 'boolean',
  'bool': 'boolean',
  'attachment': 'attachment',
  'user': 'user',
  'dept': 'user',
  'select': 'select',
  'reference': 'reference',
  'variable': 'variable'
};

const iconKey = computed<IconKey>(() => TYPE_TO_ICON[(props.dataType ?? '').trim().toLowerCase()] ?? 'generic');
</script>

<template>
  <!-- title=data_type 原文：图标只表意类别，悬停仍可看到精确类型（未识别类型尤其需要）。 -->
  <span class="fti" :class="`fti-${iconKey}`" :title="dataType ?? ''" aria-hidden="true">
    <!-- 文本：字母 A -->
    <svg v-if="iconKey === 'text'" viewBox="0 0 12 12" width="12" height="12">
      <text x="6" y="9.5" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor">A</text>
    </svg>
    <!-- 数值（整数/小数统一）：# -->
    <svg v-else-if="iconKey === 'number'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <path d="M4.5 1.5L3.5 10.5M8.5 1.5L7.5 10.5M2 4.2h8.5M1.5 7.8H10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
    <!-- 日期：日历框 + 顶部双耳 -->
    <svg v-else-if="iconKey === 'date'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <rect x="1.5" y="2.5" width="9" height="8" rx="1.2" stroke="currentColor" stroke-width="1.1" />
      <path d="M1.5 5h9M4 1v2.5M8 1v2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
    <!-- 日期时间：日历框内加一个点（与纯日期区分） -->
    <svg v-else-if="iconKey === 'datetime'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <rect x="1.5" y="2.5" width="9" height="8" rx="1.2" stroke="currentColor" stroke-width="1.1" />
      <path d="M1.5 5h9M4 1v2.5M8 1v2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
      <circle cx="6" cy="7.8" r="1.3" fill="currentColor" />
    </svg>
    <!-- 时间：钟面 -->
    <svg v-else-if="iconKey === 'time'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <circle cx="6" cy="6" r="4.7" stroke="currentColor" stroke-width="1.1" />
      <path d="M6 3.5V6l1.8 1.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <!-- 布尔：对勾方框 -->
    <svg v-else-if="iconKey === 'boolean'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.6" stroke="currentColor" stroke-width="1.1" />
      <path d="M3.8 6.1l1.6 1.7 2.9-3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <!-- 附件：回形针 -->
    <svg v-else-if="iconKey === 'attachment'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <path
        d="M7.8 3.2L4.4 6.6a1.6 1.6 0 002.3 2.3l3.4-3.4a2.7 2.7 0 00-3.8-3.8L2.9 5.1a3.8 3.8 0 000 5.4"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
      />
    </svg>
    <!-- 人员/部门：头 + 肩 -->
    <svg v-else-if="iconKey === 'user'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <circle cx="6" cy="4" r="2.2" stroke="currentColor" stroke-width="1.1" />
      <path d="M1.8 11a4.4 4.4 0 018.4 0" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
    <!-- 选项：列表三行（首行带点） -->
    <svg v-else-if="iconKey === 'select'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <circle cx="2.4" cy="3" r="0.9" fill="currentColor" />
      <path d="M5 3h5.5M5 6h5.5M5 9h5.5M1.6 6h1.6M1.6 9h1.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
    </svg>
    <!-- 引用：链环 -->
    <svg v-else-if="iconKey === 'reference'" viewBox="0 0 12 12" width="12" height="12" fill="none">
      <path
        d="M5 7l2-2M4.2 8.5l-.9.9a1.9 1.9 0 01-2.7-2.7l1.8-1.8a1.9 1.9 0 012.7 0M7.8 3.5l.9-.9a1.9 1.9 0 012.7 2.7L9.6 7.1a1.9 1.9 0 01-2.7 0"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
      />
    </svg>
    <!-- 系统变量：@ -->
    <svg v-else-if="iconKey === 'variable'" viewBox="0 0 12 12" width="12" height="12">
      <text x="6" y="9.5" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor">@</text>
    </svg>
    <!-- 通用兜底：菱形（未识别/缺省类型） -->
    <svg v-else viewBox="0 0 12 12" width="12" height="12" fill="none">
      <rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1" transform="rotate(45 6 6)" stroke="currentColor" stroke-width="1.1" />
    </svg>
  </span>
</template>

<style scoped>
.fti {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: rgb(var(--text-hint-color));
}
</style>
