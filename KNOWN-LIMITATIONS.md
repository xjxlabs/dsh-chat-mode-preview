# Known limitations / 已知限制

- **Experimental Preview only.** 本版本只供隔离环境中的源码体验，不是正式安全版，也不是官方 DeepSeek 产品发布。
- **P1F-C 创建事务缺陷尚未关闭。** 创建/失败清理路径尚未获得正式完整验收；正常对话成功不能证明创建操作的原子性、失败回滚或异常恢复完全正确。C0.1 的 SDK 初始化排障暂停，本版本没有混入原工作树的未提交基础设施修复。
- **DSH 完整仓库 Gate：FAIL。** 原 Windows 环境已知 Chromium 可执行文件缺失、Bash/PowerShell 工具预期及快照差异、symlink EPERM 在 UI-A 前后均复现。没有刷新快照、调整测试预期、延长超时或添加重试来获得通过。产品 Gate 与完整仓库 Gate 分开报告。
- **配套源码依赖。** 本插件依赖 P1D preset admission、P1F-B registration/final-projection 和 M1.1 mode slot 等宿主改动。不能安装到任意公开 DSH 版本并承诺同样功能。
- **隔离边界。** 独立 DSH_HOME/profile/cwd 避免混用配置与数据，不提供 OS 沙箱。Coding 具有 Standard 工具能力；Chat 仅投影受信 web_search，但不能防御任意同进程插件篡改。
- **隐私与费用。** 模型服务接收请求内容；搜索使用外部服务。`.preview/` 含会话、认证信息和本地路径，不得上传。截图和错误日志分享前须脱敏。
- **平台范围。** 本发布候选仅按 VALIDATION.md 所列平台和场景验收；跨平台安装、发行安装包和全部原生会话功能不在已验证声明内。
- **报告边界。** VALIDATION.md 中未验证或失败项不计 PASS。正式交付仍需事务缺陷关闭及完整仓库 Gate 恢复；此预览不承诺正式交付日期。
