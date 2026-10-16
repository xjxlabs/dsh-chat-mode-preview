# Chat Mode P0：契约与兼容性验证

## P1 开工基线复验（2026-09-28）

当前基线为插件 `cc80f6f`、DSH `76fda72`。B0 已由 `cc80f6f` 关闭；下文原始验证中的 B0 FAIL、依赖缺失与未提交说明仅记录当时状态，不代表当前阻塞。

- `node scripts/p0/run.mjs`：退出码 0，路径 3/3、写入 7/7、独立进程恢复 2/2，共 12/12 通过。最新本地证据位于 `scratch/p0-HfdajO/`，不纳入版本控制。
- `npm test`：退出码 0，106/106 通过，包含 B0 的 9 项换行回归测试；构建一致性检查通过。
- 本次提交仅收录本报告、`scripts/p0/**`、`test/p0/**` 共 7 个验证资产；不包含 scratch、日志、运行产物、临时目录或生产代码。DSH 无改动。
- P0 Gate 保持 PASS；未进入 P1，未执行 push/tag。下文能力与验收边界不变，不将控制器层验证升级为产品 E2E 结论。

以下为原始 P0 验证记录。

日期：2026-09-28。插件基线 `3f0fce8`（1.0.1）；DSH 基线 `76fda72`（0.1.2-rc.1）；Windows，Node v24.14.1，Vitest 4.1.8。

## 结论与 Gate

**P0 契约与兼容性 Gate：PASS。** 12 个新增验证用例通过。专用 cwd + 原生 Agent 创建链路 + 正式 flush 可以满足本轮的创建、列表、持久化、独立进程恢复和历史读取要求。未进入 P1，未实现生产 Chat preset、RPC 或 UI。

这个 PASS 限于源码组合/控制器层的兼容性验证，不是 Chat 产品发布验收。**现有客户端构建一致性检查：FAIL**，已确认是未修改的 Windows CRLF 工作树与生成器模板 LF 的差异；未用归一化探针代替原检查宣告通过。完整浏览器/模型/搜索/多平台验收仍未执行。

| Gate | 结果 | 证据 |
| --- | --- | --- |
| G0：P0 隔离，不改变现有生产行为 | PASS | 只新增本报告、`test/p0` 和 `scripts/p0`；DSH 工作树无修改 |
| G1：cwd 与专用根契约 | PASS | 3 个路径测试；缺失/相对根拒绝、独立目录、重复身份拒绝、穿越拒绝、junction 拒绝、Workspace 重叠拒绝 |
| G2：原生生命周期与持久化 | PASS | 写进程 7 个测试；真实 Loader、Session、AgentLoop、JSONL（默认 zstd）、原生 Session 控制器实现 |
| G3：重启恢复和历史 | PASS | 第二个独立 Vitest 进程 2 个测试；冷列表、中文历史、恢复后的 cwd/preset 一致 |
| G4：持久化语义 | PASS | 无 ensureMaterialized；裸 Session + flush 无记录；原生创建 + flush 有记录；注入磁盘失败时 flush 拒绝 |
| G5：扩展点边界明确 | PASS | preset roots 和切换、Workspace 复用有运行反例；Composer 及 API 能力按源码审查分类 |
| G6：现有 Host 回归 | PASS | index 4、persistence 2、robustness 88，共 94 个既有测试通过；这些 mock 测试不等于安全或持久化真实性证明 |
| B0：既有 build-client --check | FAIL（基线问题） | 原始检查仍失败；只读探针证明 LF 归一化后内容一致；生产文件与 HEAD 无 diff |

## 复现与证据

从插件根执行：

```powershell
node scripts/p0/run.mjs
node scripts/p0/check-artifact.mjs
```

runner 默认使用相邻 `deepseek-harness`，可通过 `DSH_SOURCE_ROOT` 指定源码位置。依赖使用 DSH 已安装的 TypeScript/Vitest，不安装包、不读取正式 `.env`、不访问模型 API。子进程环境排除常见 KEY/SECRET/TOKEN/PASSWORD 项，每次分配新 `scratch/p0-*` 和独立 DSH_HOME。所有证据和临时目录保留，不进行递归删除。

最终成功运行：`scratch/p0-CYfKxq/`。其中 `result.json` 记录三个阶段退出状态；`paths.log`、`write.log`、`read.log` 记录输出；`write.json`、`read.json` 是 Vitest 原始结果；`sessions.json` 保存用于第二进程验证的身份、cwd、历史游标；`home/sessions` 保存真实持久化数据。该目录被现有 scratch 规则忽略，不是发布资产。

最终结果为路径 3/3、写入 7/7、读取恢复 2/2。正常测试进程结束后由第二进程重新装配服务；此外写阶段在关闭原 Agent 前，用另一真实 JSONL provider 读取刚 flush 的数据，排除了“只靠 teardown 才落盘”的假阳性。没有进行强杀、断电或实际模型回答测试。

测试组合从生成的 `cordis.yml` 经真实 Loader + Include 装载。测试模块表只将模块名映射到 DSH 源码，未 mock 持久化、AgentLoop、列表或历史实现。调用原生 SessionCommandController/ApiSessionAgentController 等内部实现，因此不把它称为经过 HTTP、认证 RPC 或完整 web profile 的 E2E。默认模型选择是无网络 fixture；历史通过合法 Session 事件写入；搜索方法不在测试范围。两个空 preset `p0-chat-contract` / `p0-alternative` 只用于证明装配身份和恢复，不包含正式 Chat 功能。

最初的实验启动遇到沙箱 spawn EPERM，随后通过限定命令的提权重试运行。调试阶段修正了测试启动参数、Vitest ESM/源码别名，以及历史事件的 surfaceOp 标记；早期失败日志保留，未把它们计为 DSH 产品缺陷。

## 已验证的 cwd 契约

1. SessionHeader 的 cwd 在核心层可选，但不满足当前 Web Session 的完整契约：冷列表跳过缺省 cwd，历史读取和 API Agent 恢复拒绝它。负例已经真实持久化，故拒绝不是因为测试记录未保存。
2. 原生创建省略 cwd 不是得到无目录 Session，而是使用控制器的默认 cwd；生产 SessionController 用 process.cwd() 构造这个默认值。实验将默认值指向测试目录，验证了选择行为，不把真实工作目录作为测试写入目标。
3. Chat 的 cwd 在创建时设置并持久化，恢复使用原头部，不因启动 cwd、Workspace 选择或后续配置变化重新分配。
4. `No Workspace` 不要求 cwd 缺省。专用目录不注册 Workspace，Session 仍可列出、读取和恢复。实验组合没有 Workspace 实例，不代表已验证完整 Workspace Registry 的并发行为。
5. cwd 只提供目录身份和下游默认路径，不构成 Shell/文件工具权限控制。Chat 工具隔离仍属 P1。

### 专用根的确定规则

默认值固定为 `<明确的 DSH_HOME>/runtime/chat`，每个 Session 的目录为该根下服务端生成的 UUID Session ID。允许显式绝对路径覆盖 `chatRuntimeRoot`；配置字段缺省才使用默认值，空串、相对路径和非法值必须失败。

P0 明确采用严格策略：没有明确、非空、绝对的 DSH_HOME 输入时失败，不自行调用会回退到 `~/.dsh` 的 resolveDshHome()，也不调用 homedir()/process.cwd()/Workspace 来补值。如果后续产品允许 DSH 自身默认 home，必须由启动层显式传入已解析的有效 home，不能在插件中悄悄放宽规则。显式 DSH_HOME 位于用户目录下并不等于将用户主目录当作 cwd；最终 cwd 始终是专用 Session 子目录。

运行根不能是盘根、用户主目录、当前进程目录、DSH_HOME 本身或其祖先；与已知 Workspace 路径双向重叠也拒绝。P1 服务端从真实 Registry 提供 Workspace 路径，不能信任 Client 的列表。配置校验不通过时只报错，不自动迁到其他目录。

分配实验检查路径链上的链接/非目录，独占创建 Session 子目录，再用 realpath 校验归属。已测试 Windows junction 重定向被拒绝。它没有证明可抵抗同一账户的并发目录替换，也不提供 Windows ACL 沙箱；P1 应复核私有目录权限、规范化的 Workspace 路径和恢复时目录检查。日志、凭据、preset 不存入 cwd 子目录。恢复时路径缺失/被替换应明确报错，禁止自动改 cwd；归档不删除目录，自动清理不在 MVP 内。

## ensureMaterialized 与 flush 的真实语义

当前插件 `lib/index.js` 使用 `sessions.create()` 创建裸 Session，并有条件调用 `sessionPersistence.ensureMaterialized()`。DSH 当前源码没有这个方法。既有 persistence.test.mjs 自己提供该 mock，因此通过只能证明“存在此方法时会调用”，不能证明真实 DSH 已保存。

真实后端实验结果：当前插件创建返回成功后调用 `sessions.flush(session)`，返回值甚至可以为 true，但 `sessionPersistence.stat(id)` 仍为 undefined，第二进程也没有记录。原因是 flush 的 true 仅代表有持久化监听器参与，不代表该 Session 已取得写句柄。不能仅用返回 true 判定成功。

原生 AgentLoop 创建会建立持久化写所有权，随后 `sessions.flush(session)` 排空并等待落盘。此路径在另一个 provider、第二进程中都可读取；注入后端 persistBatch 失败时，flush 拒绝，不能返回“创建成功”。

P1 正式流程确定为：

```text
校验配置/已知 Workspace 路径
→ 服务端生成 ID，独占分配 Chat cwd
→ sessionController.create({ 服务端 ID, cwd, agentPreset: 固定 chat })
→ 原生创建链路先装配 preset，再发布 Agent
→ sessions.flush(该 Session)
→ 验证该身份已有持久化记录
→ 返回成功
```

后端采用必需依赖和明确失败，不再以可选 ensureMaterialized 兜底。失败后不能悄悄返回成功，也不能对已发布或部分落盘 Session 随意删目录；P1 需定义可重试的同操作身份及失败结果，避免网络重试重复创建。服务级 `sessionPersistence.flush()` 会刷新所有活动写句柄，不是单 Session 创建的首选。

## 扩展点调查

| 能力 | 当前公开方式 | 实证/限制 | 是否必须改 DSH |
| --- | --- | --- | --- |
| Chat cwd、创建、flush | 原生 SessionController.create、SessionStore.flush | 本轮通过原生控制器实现和真实后端验证 | 否 |
| preset 注册 | agent-presets.config.roots + 文件发现 | 实验根可发现并装配两个 fixture preset；没有动态 registerRoot API | 否，显式合并部署配置即可 |
| 固定 Chat preset | 服务端创建时传入 preset | 原生 factory setup 在发布前 mount | 创建本身不需要 |
| Chat 空白会话锁定 | select 只有“已开始 turn 后锁定” | 实测空白 fixture 可切换，开始 turn 后拒绝；public recompose 也可直接重绑定 | 是，若要求完整服务端不可切换保证 |
| Workspace 默认 preset | 配置全局 default=standard | 可变全局设置只能约定默认，不能保证该路径永久 Standard | 配置受控时可避免；严格保证需要窄策略 |
| Workspace 空白复用 | 原生 connectWorkspace | 实测复用 p0-alternative 空白；新建只传 workspaceId，无 preset | 保留原生实现并严格要求 Standard 时需要 |
| Composer 精准解锁 | 公共 slots 支持组件贡献/替换 | ConversationRoot 自己计算 inert，并在此时压住 composerBlock；当前没有原因感知的解锁策略 | 保留原生 Composer 且不改私有 entry 时需要 |
| 创建/解绑认证传输 | connection.rpc.handle / Client rpc.call | 源码确认 Host/Origin + 浏览器认证；本轮未实施 RPC | 否；生成 Typert namespace 不是必须 |

用户 preset roots 采用先发现的 ID 优先。P1 应校验 chat 的来源和装配身份，发现同名冲突应失败，不能只检查 ID 字符串。根配置 patch 会替换整个 config，必须保留 default、其他 roots 和 include 开关；本轮不引入动态注册系统。

公开 slots 可以整块替换组件，但不提供“包裹原生组件并读取全部阻塞原因”的稳定接口。当前插件修改 priority-0 entry 的 component/inject 属于现有兼容性包装，不应作为新的正式扩展点。Composer 本项为源码结论，未做浏览器渲染验证。

## 必须修改插件的内容（后续阶段）

- 将裸 Session 创建迁到原生 SessionController 创建链路；使用必需持久化依赖、单 Session flush 和真实落盘检查。
- 服务端拥有 ID/cwd/preset；使用明确 DSH_HOME 派生的运行根，并在分配、恢复时校验归属；移除 homedir fallback。
- 新增受信任 chat preset 与执行端工具边界；复用只接受实际 chat、目录合格、空白、空闲、顶层且未归档的 Session。
- 创建/解绑迁到认证 Connection RPC；旧 HTTP 写入口不可留下旁路。解绑只改 membership，不改 cwd/preset/history。
- UI 后续明确 Chat/Coding 与 Workspace 两个维度；按实际 preset 投影展示，不能按分组推断模式。

## 必须修改 DSH 的最小设计（本轮未实现）

以下“必须”以保留原生组件/导航且提供服务端强保证为前提；不采用私有方法 monkey patch，也不复制整套 UI。

1. **preset 装配准入。** 在 agent-presets 增加 effect-scoped 的拒绝式 guard 注册点。输入包含操作类型 create/resume/recompose、Session/Agent 身份、当前及目标 preset；没有规则时保持原行为，任一拒绝即拒绝。检查位于实际装配/重绑定操作内部，并在加载目标 preset 前执行，覆盖 select 和直接 recompose；select 继续使用现有串行队列并在执行点重检。不能只加“selected 之后”通知，也不能只在 RPC 门口过滤。Chat 插件提供自身规则，DSH 不硬编码 chat ID。测试必须覆盖并发 select、直接 recompose、恢复和拒绝后无部分装配。
2. **Workspace 导航策略。** 在原生 connectWorkspace 的创建与复用决策处提供窄策略贡献，服务端确定 Workspace 路径的默认 preset，Client 只使用服务端策略和已有 Session 投影筛选候选。原生 draft 转移、open、single-flight 和错误回滚保留。Chat 插件要求初始 standard，不能靠 Client 任意 agentPreset 参数实现保证。无策略时原行为不变，多贡献冲突明确报错。原生 preset seat 的 staged 选择还需在导航边界消费/清除，避免选择完成后反向覆盖；属于 P2。
3. **Composer 组织前置条件。** 在 ConversationRoot 的 inert 计算前增加一个明确的 workspace-free admission 输入（通过正式数据/策略贡献提供）。仅豁免缺 Workspace，不豁免“无 Session”、恢复未就绪、模型等其他阻塞；composerBlock 必须继续参与计算。UI 不自行推断服务端安全许可，策略不等于工具权限。无贡献时行为不变；属于 P2。

不新增全局 Chat/Coding 状态机，不修改 AgentLoop，不扩大 SessionHeader 格式，不在 P0 实现以上接口。接口名字在设计层尚未成为公共 API；实施时应按 DSH 自有 service/effect 风格落地。

## 可避免的 DSH 修改

- 不必令所有 Web Session 支持 cwd 缺省：隔离目录已通过当前契约。
- 不必新增持久化后端或 ensureMaterialized；不必修改 JSONL 格式和恢复逻辑。
- 不必为了外部插件新增生成式 Remote namespace；正式 Connection RPC 已可使用。
- 不必动态注入 preset roots；首版使用显式配置并检查冲突。
- 不必改写 Standard preset、编排 AgentLoop，或复制原生 Workspace 浏览器。
- 若只要求“受控部署的默认 Standard”，配置约束可暂时代替 Workspace 策略；但不能因此宣称覆盖了任意已有非 Standard 空白 Session 的复用。

## P1 精确实施边界

P1 只做后端闭环：生产化受控目录解析/校验、真实 Session 创建与持久化、chat preset（对话 + web_search + 必要 compaction）、模型 schema 与执行 guard、认证创建/解绑 RPC，以及 Chat preset 装配准入所必需的最小上游改动。执行 guard 不应依赖 UI；chat 不可用或身份不匹配时失败，不回退 Standard。

不在 P1 做 Composer、Workspace picker、sidebar 的正式 UI 改造；严格 Standard 复用/导航及 staged preset 的 UI 协调进入 P2。P1 可通过服务测试和认证 RPC 验收，不要求提前开放产品入口。冷启动自动 Chat、历史迁移、自动目录清理、完整 cwd-less 支持继续排除。

P1 Gate 必须新增：真实认证拒绝/参数拒绝、真实 chat 装配与执行拒绝、全局/局部插件工具泄漏反例、首次模型请求的工具集合、普通对话 compaction、搜索失败、并发创建重试与部分持久化失败、目录替换恢复拒绝。P0 的空 preset、合成历史、内部控制器调用不能代替这些验证。

完整发布前仍须解决 B0 构建一致性问题、补全插件 Client 依赖环境与浏览器回归。本轮未安装依赖；现有插件 Client 测试需要的本地 node_modules 缺失，因此没有宣称完整 npm test 或浏览器测试通过。

## 关键源码定位

- 插件：`lib/index.js:103`（裸 Session 创建/可选 ensureMaterialized），`test/persistence.test.mjs:5`（mock）。
- DSH：`packages/core/session/src/index.ts:1075`（flush 参与者语义）；`packages/core/agent-loop/src/index.ts:754`（建立 stored handle 后发布）；`packages/session/session-persistence/tests/live-write-contract.ts:86`（无写句柄不持久化）。
- DSH：`packages/api/session-controller/src/commands.ts:73`（cwd/preset 选择）；`agent.ts:416`（恢复拒绝无 cwd）；`list.ts:159`（冷列表过滤）；`history.ts:203`（历史拒绝无 cwd）。
- DSH：`packages/preset/agent-presets/src/index.ts:104`（roots）、`:650`（recompose）、`:694`（select）；`packages/client/ui-workspace/src/client/navigation.ts:90`（复用/创建）；`packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx:324`（inert）。
- DSH：`packages/util/home-paths/src/index.ts:87`（官方 home resolver 有默认 home fallback）；`packages/client/connection/src/rpc-host.ts:152`（认证通道）。

未 commit、push 或 tag。所有 P0 文件保持为本地新增，供评审。
