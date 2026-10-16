# Chat Mode P1 实施记录

日期：2026-10-02。插件开工基线 `b11d132`；DSH 基线 `76fda72`。本文件按阶段记录实际实现与 Gate，不将后续阶段计划写成已完成能力。

## P1A：受控目录与真实持久化

结果：PASS。

- Host 必须获得明确、绝对的 `DSH_HOME`/`dshHome`；默认根为 `<DSH_HOME>/runtime/chat`，允许显式绝对 `chatRuntimeRoot`。
- 运行根拒绝卷根、用户主目录、进程 cwd、DSH_HOME 及其祖先，并拒绝与 Host Workspace Registry 中路径双向重叠；路径链中的链接或非目录拒绝。
- Host 生成 UUID Session ID，独占创建 `<chatRuntimeRoot>/<session-id>`，不接受调用方提供的 cwd、Session ID 或 preset。
- 创建通过原生 `sessionController.create` 装配 Agent，固定请求 `no-workspace-chat` preset；随后执行 `sessions.flush(session)`，并通过 `sessionPersistence.stat` 核对持久化的 ID、cwd 与 preset 后才返回成功。
- 定向 Node 测试 81/81 通过；P0/真实 DSH 组合 Gate 为路径 3/3、写入 8/8、独立进程恢复 2/2；`npm test` 93/93、`npm run check:package` 和独立 `build-client --check` 均通过。

P1A 不包含正式 preset 内容、工具隔离、认证 RPC 或 DSH 上游扩展点；这些能力分别属于 P1B、P1C、P1D。当前旧 HTTP 写入口仅临时调用新的服务端受控创建函数，将在 P1C 删除。

## P1B：受信任 Chat preset 与工具边界

结果：PASS。

- 插件发布内置 `no-workspace-chat` preset root，并以 `system` trust 显式加入现有 preset roster；保留 `standard` 默认以及 shipped/user roots。
- Chat 创建前解析并核对 preset 的 ID、trust、health 与真实 composition 路径；同名 user preset 或非插件路径不能被当作 Chat。
- Chat composition 只装配完整普通对话 persona、`web_search` 与自动 compaction/tool-result pruning；不装配 Shell、FS、代码搜索、Skill、Subagent、Workflow、Goal、Plan 或 PTC。
- 模型 prompt assembly 最终只投影 `web_search`。agent-scope 单调执行 guard 对任何其他已注册工具 fail-closed，覆盖后续全局与局部工具注册，拒绝发生在工具 body 前。
- 没有使用 `tools.restrict()`：真实 Loader 证明 preset sibling rows 并行装配，restriction 注册时不能安全依赖 `web_search` 已存在；空 allowlist 又会屏蔽合法搜索。最终 schema filter + monotonic guard 直接覆盖“不可见且不可执行”的安全要求，避免引入只为排序存在的额外 service。
- 真实 DSH preset 装配定向测试 5/5 通过；`npm test` 96/96、P0 Gate 13/13、`npm run check:package` 与独立 `build-client --check` 均通过。DSH 工作树无修改。

P1B 不包含认证 RPC、旧 HTTP 写入口移除或 preset 切换锁定；这些分别属于 P1C 与 P1D。

## P1C：认证 Connection RPC

结果：PASS。

- Host 只注册认证 Connection 的专用 `/no-workspace` RPC channel，不再注入 `webServer`，旧 generic HTTP status/create/detach handler 已从生产代码移除。
- `openChat` 只接受空对象；`cwd`、`sessionId`、`agentPreset` 以及任意额外字段均以 `gateway/bad-request` 拒绝，创建副作用为零。服务端继续独占生成 ID、分配 cwd、固定 preset 并完成持久化。
- `detach` 只接受单一 `sessionId` 字段，通过 Host Workspace Registry 执行；未知 endpoint、非法 payload 与已取消请求返回结构化 RPC failure。
- Client 注入 `@deepseek-ai/dsh-client-connection`，只调用 `connection.rpc.call('/no-workspace', 'openChat'|'detach', payload)`；不再直接 `fetch` 写入口。可复用空白 Session 额外要求投影 preset 为 `no-workspace-chat`，Standard blank 不会被误复用。
- 真实 DSH Connection 测试验证了不可信 Host 为 403、可信但未认证为 401、Cookie 认证后正常调用、恶意 openChat 字段无副作用，以及旧裸 `{}` HTTP body 不能作为 RPC envelope 分发。
- P1 专项 8/8、`npm test` 87/87、P0 Gate 13/13、package check 与独立 build-client check 均通过。DSH 工作树无修改。

P1C 不锁定 Chat preset 的 resume/recompose/select 装配路径；该服务端准入属于 P1D。

## P1D：最小 preset 装配准入扩展点

结果：PASS。

- DSH `AgentPresets` 新增 effect-scoped、单调拒绝的 `guard()` 扩展点；输入包含 create/resume/recompose 操作、Agent、Session、当前 live preset 与目标 preset。任一 guard 返回原因即以 `agent-preset/denied` 拒绝，其他 guard 不能强制放行。
- `mount()` 和 `recompose()` 都在 `ensureStanding()` 前执行准入检查；拒绝不加载目标 composition、不改变 binding、不发出 `tools/change`，`select()` 继续在原串行队列的执行点调用受保护的 `recompose()`，拒绝后不写 `agent-preset/selected`。
- API Session Controller 对 create、resume 与 fork-create 显式传递操作类型，不从 Session 当前状态猜测。无 guard 时既有 mount/recompose 行为不变，其他直接 mount 调用默认按 create 处理。
- 插件只注册自身规则：若 durable header 或当前 live composition 为 `no-workspace-chat`，目标必须仍为该 preset；Standard 和其他 preset 不受限制。规则随插件 fiber 卸载，不在 DSH 中硬编码 Chat ID，也没有引入通用 Chat/Coding 状态机。
- DSH 定向测试 61/61、相关 TypeScript 编译、完整 `pnpm run lint`、文档快速检查 15/15 与文档图校验通过；最小上游扩展点提交为 `22e4ee5`。受影响 DSH 包全量测试有 627/628 项通过，唯一未执行成功的是既有 Windows symlink discovery 用例，当前账户创建 symlink 返回 `EPERM`，没有产品断言失败。
- 插件真实 DSH 组合测试 11/11、`npm test` 90/90、P0 Gate 13/13、package check、独立 `build-client --check` 与两个仓库 `git diff --check` 均通过。P1D Gate 为 PASS；Windows symlink 环境限制保留为已披露的非产品阻塞，不降低或跳过任何 Chat 准入断言。

## P1E：完整 Gate 与恢复完整性

结果：PASS。

### 已验证事实

- 真实 Agent 的首次普通对话请求及 compaction 辅助请求暴露的工具集合都严格等于 `['web_search']`。Shell、FS/代码搜索、Skill、Subagent、Workflow、Goal、Plan 与 `run_code` 均由服务端 guard fail-closed；全局或 agent-local 后注册的工具既不进入模型 schema，也不能绕过执行 guard，拒绝发生在工具 body 前且副作用计数保持为零。
- 在未配置搜索 Provider 的运行时中，`web_search` 返回工具错误，但 Agent 随后仍能完成普通对话；compaction 能生成并持久化 summary，不依赖 Shell、文件读取或代码搜索工具。
- 使用真实 JSONL 写入 Chat 历史，销毁第一个 Context 后由全新 Context 恢复同一 Chat；历史、cwd、preset 与单工具边界保持一致。
- P1E 发现并关闭一个恢复缺口：此前 Chat 只锁定 preset，没有在 resume 时重新验证 durable cwd。插件现在通过第二个 P1D admission guard 校验服务端 UUID、`header.id`、`chatRuntimeRoot/<session-id>` 直属关系、路径链、目录类型与 realpath 归属；cwd 越界或目录被文件替换时，以 `agent-preset/denied` 在 Session/Agent 发布前拒绝。
- 客户端会复用受信 preset 的空白 Chat，并将并发新建动作合并到同一个 in-flight `openChat`；服务端并发创建使用互不重复的 ID；flush 或持久化元数据核验失败不得返回成功，显式重试使用新的服务端身份。

### 环境限制

DSH 受影响三包全量测试共 639 项，其中 638 项通过；唯一未执行成功的是既有 Windows symlink discovery 用例，当前账户创建 symlink 返回 `EPERM`。它不是产品断言失败，也不计为 PASS。Chat 自身的 junction 分配拒绝、cwd 越界、目录替换与 junction 重定向恢复拒绝，以及全部 preset/tool admission 断言均已实际执行通过；除此之外没有产品相关失败。

### 已知残余风险

当前 `openChat` 请求为空 payload，RPC handler 不接收稳定的 operation key。因此 P1E 的“重试可控”只表示 Client 空白复用和 concurrent single-flight、服务端唯一身份、持久化失败不报成功以及显式重试有确定结果，**不表示 RPC 响应丢失后的严格幂等或 exactly-once**。若服务端已成功而响应在客户端收到前丢失，后续新 RPC 不能由 Host 严格证明属于同一操作。本阶段不临时增加 operationId、时间窗口缓存或隐式全局复用。

### P1 完整 Gate

| Gate | 结果 | 证据与边界 |
| --- | --- | --- |
| 首次模型请求工具集合正确 | PASS | 真实 Agent 请求 schema 严格为 `web_search` |
| compaction 工具边界 | PASS | 辅助请求同样严格为 `web_search`，未出现 Shell/FS/`run_code` |
| 非允许工具 fail-closed 且无副作用 | PASS | 禁止能力执行测试与动态 `read_file` 恶意调用均在 body 前拒绝 |
| 后续全局/局部工具注册不能泄漏 | PASS | P1 组合 Gate 同时验证 schema 与执行 guard |
| Chat 搜索失败仍可普通聊天 | PASS | 无搜索 Provider 的工具错误后继续生成普通回复 |
| 创建、flush、重启与历史恢复 | PASS | 原生创建、单 Session flush、真实 JSONL、独立 Context/进程恢复 |
| cwd 越界、替换或链接重定向拒绝 | PASS | 恢复负例与分配期 junction 负例均 fail-closed |
| Chat preset 不可切换/recompose | PASS | select、直接 recompose、resume 与并发队列准入测试 |
| Standard Coding Agent 无回归 | PASS | DSH preset/Session Controller 定向回归 |
| 认证 RPC 边界 | PASS | Host/Origin、Cookie、非法参数与旧 HTTP 旁路负例 |
| 并发、重试、部分持久化失败可控 | PASS（有限语义） | 唯一 ID、Client single-flight、失败不报成功、显式重试；不宣称响应丢失后的 RPC exactly-once |
| 项目与上游 Gate | PASS | P1/P1E、P0、`npm test`、build-client、package、DSH 定向测试/类型/lint/文档 Gate |

P1E 专项真实 Gate 3/3、既有 P1 组合 Gate 11/11、DSH Standard/preset 回归 21/21、插件 `npm test` 93/93、P0 Gate 13/13。`build-client --check`、package check、DSH 完整 typecheck/lint、文档快速 Gate 15/15 与文档图 6/6 均通过。文档 Gate 首次运行的两个内部裸 Git 调用受到仓库 dubious ownership 拒绝；使用仅限当前进程的 `safe.directory` 配置重跑后 15/15 通过，没有修改全局 Git 配置。

## P1 结论与 P2 入口

P1 后端闭环达到 Gate：Chat 使用受控 cwd、受信 preset、单工具模型/执行边界、认证 RPC、真实持久化和 fail-closed 恢复；Standard Coding Agent 的既有装配路径保持可用。P1 未实现 Composer、Workspace Picker、Sidebar、Chat-first 冷启动、Chat 历史迁移到 Coding，也未实现 P2 Workspace 导航/复用策略。

P2 的精确入口条件是：以已通过的 P1 服务端边界为前提，仅设计原生 Workspace 导航策略和 Composer 的 workspace-free admission；继续由服务端决定 Workspace Session 的 Standard preset，保留原生 draft/open/single-flight/回滚，并为 staged preset 的消费与清理增加测试。P2 不应弱化 Chat 工具 guard、cwd 准入或认证 RPC，也不能把 Chat 历史原地切换为 Coding Session。
