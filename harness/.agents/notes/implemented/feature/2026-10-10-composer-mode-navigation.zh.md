# Agent Note: Composer 模式导航插槽

Status: implemented

[English](2026-10-10-composer-mode-navigation.md) | 中文

## 问题

隔离 M1 集成需要原生 composer 内的模式导航入口。独立工具栏重复会话操作，而修改已有 Session preset 可能混淆其历史与能力。

## 决策

`conversation.input.mode` 是 composer bar 下的 single、optional-Session 子插槽。`InputBar` 将其渲染在底部工具行首位，编辑器 inert 时也保留。原生 shell 不提供默认模式控件。

隔离的外部 M1 插件贡献 Chat/Coding 导航。标签读取真实 preset，Workspace 归属单独用于空白会话复用。切换打开匹配的空白 Session，或通过已有 API 创建会话。导航保留草稿，不选择已有 Session 的 preset。Coding 要求明确 Workspace；全局新建打开 Chat。插件隐藏原生空白会话 preset 选择器，避免相冲突的修改语义。

## 考虑过的替代方案

保留附加工具栏会留下重复操作。修改当前 preset 违反会话保留要求。替换 composer 会重复附件、权限、模型选择和滚动的职责。小型声明式插槽保留这些原有职责。

## 影响

M1 插件要求隔离 harness 构建包含该插槽。这是隔离体验构建，不是安全发布版本。后端创建事务和 Chat 工具策略不属于本次修改。原生 Workspace 管理保留在侧边栏；composer 独立于模式标签显示只读归属。

## 隔离展示

原生 hero Workspace 行与头部 preset 标签暴露 data 属性。只有 M1 插件对这些标记应用样式：隐藏重复 Workspace 触发器，同时保留其锚点几何与原生 picker；隐藏 composer 已命名的两种模式对应的头部标签。其他 preset 保留头部标签。插件使用原生字体族、字号偏好、内容宽度轴和滚动容器；仅调整 composer 间距与模式弹窗样式，不替换这些原有职责。只读上下文通过框架 hooks 推导 Workspace 归属，不修改导航或会话数据。

## 验证

只读上下文行使用不透明的原生背景，避免 composer 渐隐区域上方透出对话文字。Chat 在挂载提交后的微任务中恢复已保存的阅读锚点：必须先让祖先 ref 发布原生内容宽度，再采样锚点几何。组件卸载后忽略排队的恢复。新会话底部定位与持续滚动跟随保留原有职责和算法。

输入组件测试验证无 Session 时发送禁用而导航仍可用。插件测试覆盖双向导航、复用、并发操作、失败恢复和基于 preset 的标签。Chat 测试覆盖祖先布局完成后的恢复与卸载取消。隔离浏览器检查响应式布局、原生 125% 页面缩放、长回复、流式跟随、阅读位置恢复与多行草稿保护。这些产品检查不解除独立的仓库完整 Gate。
