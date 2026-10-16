# DSH Chat / Coding plugin — Experimental Preview

This plugin is distributed with a matched Harness source tree. Follow the [root installation and startup guide](../README.md), not an npm install into your daily Desktop profile.

本插件必须配合本源码预览中的 Harness。功能包括无 Workspace Chat、输入框左下角 Chat/Coding 切换、按请求动态模型身份，以及仅允许受信 web_search 的 Chat 工具边界。Coding 保留原生 Standard 能力；已有会话 preset、历史与草稿不会被模式导航改写。

The inherited package version 1.0.1 identifies the upstream baseline, not a published M1.1 package. Public Harness 0.1.2-rc.1 alone lacks required admission, tool-registration and mode-slot extensions.

Build and focused plugin checks: `npm ci`, `npm run build`, `npm test`. Optional integration runners require `DSH_SOURCE_ROOT` set to the absolute path of the sibling `harness` directory. They do not imply the full Harness Gate passes.

See [known limitations](../KNOWN-LIMITATIONS.md), [candidate validation](../VALIDATION.md) and [source provenance](../SOURCES.md). P1F-C creation transactions remain unresolved; this is not a production security release.

[MIT License](LICENSE), copyright SpookySandwich.
