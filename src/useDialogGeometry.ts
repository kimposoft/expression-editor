/**
 * 弹窗几何（拖动移动 / 右下角缩放 / 最大化还原 / 尺寸记忆）。
 *
 * 构建约束：宿主经别名直连 ui-kit 源码；插件（表格编辑器插件 / kimpo-workflow / kimpo-action-designer 等）
 * 构建时 `@kimposoft/ui-kit` 被外部化为全局 KimpoUi（运行时用宿主注入的那一份），所以本包被打进插件 bundle 后
 * 不会再带一份几何实现。几何的原规格说明与历史注释见 ui-kit 内同名文件。
 */
export {
  useDialogGeometry,
  type DialogGeometry,
  type DialogResizeDirection,
  type UseDialogGeometryOptions,
  type UseDialogGeometryReturn
} from '@kimposoft/ui-kit';
