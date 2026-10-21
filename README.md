# @kimposoft/expression-editor

Kimpo 统一表达式编辑器：基于 Vue 3、Naive UI 与 CodeMirror 6 的表达式 / 条件 / 取数配置编辑组件，供 Kimpo 宿主与插件前端复用。

Kimpo expression editor components (Vue 3 + Naive UI + CodeMirror 6): expression input, condition tree, source/field pickers, join designer and the V4 document adapters.

> 当前为预览版（`1.1.0-tp.x`，dist-tag `next`），API 仍可能调整。

## 内容

- 组件：`ExpressionEditor`（取数 / 写入 / 条件配置主编辑器）、`AdvancedExpressionDialog` / `AdvancedExpressionPanel`（文本模式编辑，CodeMirror 6）、`ConditionTree` / `ConditionEditorDialog` / `ConditionReadonlyView`、`SourceTreePicker`、`FieldTreeDock` / `FieldTreePanel` / `QuickFieldPicker`、`JoinDesignerDialog` / `JoinSettingsPanel`、`FieldMultiPickDialog`、`OperatorFunctionBar` 等。
- 宿主接口：编辑器不直连后端，所有数据（应用 / 数据表 / 字段目录、语法检查、预览等）经注入的 `ExpressionHost` 取得（`provideExpressionHost` / `EXPRESSION_HOST`）。
- 模型与工具：表达式模型类型、V4 取数 / 写入文档与编辑模型之间的往返适配、文本模式函数目录、语法检查、引用序列化等纯函数。
- 多语言：内置 zh-CN / zh-TW / en-US / ja-JP 四语系统文本，也可由宿主注入翻译函数。

## 安装

```sh
npm i @kimposoft/expression-editor@next @kimposoft/ui-kit@next
```

对等依赖（需由你的工程提供）：`vue ^3`、`naive-ui ^2`、`@kimposoft/ui-kit ^1.1.0-tp.2`。CodeMirror 6 相关包作为普通依赖自动安装。

## 使用

本包以 TypeScript 与 Vue 单文件组件（`.vue`）源码发布（`exports` 指向 `src/index.ts`），需要用能编译 TS 与 `.vue` 的构建工具，例如 Vite + `@vitejs/plugin-vue`。

```ts
import { ref } from 'vue';
import { ExpressionEditor, emptyExpressionModel, provideExpressionHost, type ExpressionHost } from '@kimposoft/expression-editor';

// 在父组件 setup 中注入宿主实现（必需方法：listTemplates / listTables / listFields / compilePreview / lowerText / loadCatalog，其余可选）
provideExpressionHost(host satisfies ExpressionHost);
const model = ref(emptyExpressionModel());
```

```vue
<ExpressionEditor v-model="model" template-id="当前模板 ID" />
```

组件内部使用 Naive UI 的 `useMessage` / `useDialog`，请在应用外层放置 `<n-message-provider>` 与 `<n-dialog-provider>`。

`ExpressionHost` 各方法的语义见 `src/host.ts` 的类型注释；未实现的可选方法会让对应功能静默降级。

## 开发

```sh
npm install
npm run typecheck   # vue-tsc 类型检查
npm test            # vitest 单测
npm run build       # 库模式构建检查（产物在 dist/，不随包发布）
```

## 协议

[Apache License 2.0](LICENSE)。Copyright 2026 金宝量行（无锡）软件有限公司。

本包依赖的 Vue、Naive UI、CodeMirror 6 均为 MIT 协议，不随本包打包分发。
