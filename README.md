# DSH Chat / Coding — Experimental Preview

An experimental source preview combining a matched DeepSeek Harness fork and the No Workspace plugin. This is a community modification, not an official DeepSeek release or a production security release.

中文说明见下文。Both source trees and their MIT licenses are included. See [SOURCES.md](SOURCES.md) for provenance and [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) before running.

## 功能

- 输入框左下角统一 Chat / Coding 入口。Chat 无需 Workspace；Coding 先选择 Workspace。
- 全局新会话默认 Chat，Workspace 内新建保持 Coding。切换创建或复用对应空白 Session，不改写已有会话 preset、历史或草稿。
- Chat 使用应用当前请求选定的 provider/model 动态身份；工具仅允许受信 `web_search`，不注入 cwd、项目或 Coding 运行上下文。
- 保留原生侧边栏、模型选择、附件、历史、权限与 Workspace 管理。

## 兼容与要求

本预览必须使用本仓库配套的 `harness/` 与 `plugin/`。公开 npm 的 `@deepseek-ai/dsh@0.1.2-rc.1` 或 `dsh-plugin-no-workspace@1.0.1` 不能替代它们。上游版本字段保留以便追溯，不代表本预览已发布到 npm。

- Node.js `^22.19.0 || >=24.0.0`，pnpm **11.7.0**，npm 与 Git。
- 本次目标验证平台为 Windows、Node 24、Microsoft Edge。其他平台未作本预览验收；不要由源码可安装推导为平台通过。
- 可用的 DeepSeek API Key。真实模型与搜索请求可能产生费用，需要网络访问。
- 安装/构建需要访问 npm registry 和依赖下载站点。保留锁文件及上游依赖构建许可配置。

## 安装与构建

下载本源码或 clone 到一个新目录；以下命令从包含本 README 的根目录执行，不使用原 DSH Desktop 安装目录。若尚未安装 pnpm，可用 `npm install --global pnpm@11.7.0`，或已配置好的 Corepack。

```sh
cd harness
pnpm install --frozen-lockfile
cd ../plugin
npm ci
cd ..
node scripts/build.mjs
node scripts/preview.mjs setup
```

无需复制任何既有 node_modules、profile、凭据、运行日志或构建产物。源码 ZIP 不含 `.git` 也应使用同样的步骤。

`setup` 将插件及其可选运行时 peer `@deepseek-ai/dsh-tool-web` 链接到本仓库配套源码。Windows 使用目录 junction；若权限阻止建立链接，需在允许本地目录链接的普通主机终端执行，不应安装另一个公开版本替代。

发布层构建脚本使用上游已有的 `DSH_CLIENT_COMMIT_HASH` 参数：有提交时记录当前 HEAD；源码 ZIP/尚未提交的目录使用 SOURCES.md 中的 Harness 集成基线。后者只表示基线，不是对完整预览源码版本的精确提交标识。

## 配置与启动

在当前终端提供 API Key。PowerShell 示例避免把密钥明文写入命令历史：

```powershell
$previewSecret = Read-Host 'DeepSeek API Key' -AsSecureString
$env:DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new('', $previewSecret).Password
node scripts/preview.mjs start
```

类 Unix shell：通过你自己的 secret manager 或终端环境设置 `DEEPSEEK_API_KEY`，然后执行同一条 Node 启动命令。启动器不读取个人主目录中的凭据文件。

默认监听 `127.0.0.1:56841`，自动打开本地浏览器。可设置 `DSH_PREVIEW_PORT` 更换端口；加 `--no-open` 只在终端显示认证入口。终端 URL 含认证 token，不要分享或提交日志。服务以前台方式运行，按 Ctrl+C 停止；关闭浏览器不会停止服务。PowerShell 结束后可执行 `Remove-Item Env:DEEPSEEK_API_KEY` 清理当前终端变量。

固定使用当前 checkout 的 `.preview/home`、`preview` profile 与 `.preview/runner` cwd，覆盖外部同名 DSH 环境变量，避免读取日常 profile。此目录已被忽略，不应提交或上传。第一次验证请用一次性测试 Workspace；不要添加真实项目。

## 最小体验

1. 打开页面完成初次引导，新建 Chat，选择可用模型并发送消息。
2. 询问当前 provider/model；切换模型后再发下一条消息，身份应对应新请求。
3. 用原生“添加工作区”选择一次性目录；在该 Workspace 内新建会话，确认左下角为 Coding。
4. 让 Coding 读取测试文件，确认实际路径属于该目录；通过左下角入口返回 Chat。

这是配置/数据隔离，**不是操作系统沙箱**。Coding 保留 Standard 文件/命令能力；Chat 工具限制不等于整个进程的安全隔离。

## 验证与已知限制

参见 [VALIDATION.md](VALIDATION.md) 记录本发布候选的实际验证结果；UI-D 的隔离产品体验 Gate 已通过，**DSH 完整仓库 Gate 仍为 FAIL，P1F-C 创建事务缺陷未关闭**。本预览不掩盖或豁免这些失败。完整说明见 [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)。

## License and sources

MIT; retain [Harness copyright](harness/LICENSE), [plugin copyright](plugin/LICENSE), and [third-party notices](harness/THIRD_PARTY_NOTICES.md). Upstream development documentation lives under `harness/`; its standalone install instructions describe upstream, while this root README defines the matched preview setup.
