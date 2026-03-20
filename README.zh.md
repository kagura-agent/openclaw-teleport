# 🌸 openclaw-teleport（中文）

**Agent 灵魂迁移工具** — 把你的身份、记忆和工具打包成一个文件，在新机器上一键还原。

为 [OpenClaw](https://github.com/nicepkg/openclaw) agent 构建。

> ⚠️ **安全警告：** `.soul` 文件包含 **明文凭据** — API token、Discord bot token、飞书 appSecret 等。请像对待密码文件一样保护它。**绝对不要**提交到 git、公开分享或上传到不可信的存储。

## 功能

`openclaw-teleport` 捕获让一个 agent 成为「它自己」的一切：

- **身份文件** — SOUL.md、IDENTITY.md、USER.md、AGENTS.md 等
- **记忆** — 每日笔记、长期记忆、`memory/` 目录下的所有内容
- **工具数据** — SQLite 数据库和其他 `.db` 文件
- **配置** — `openclaw.json` 中的 agent 配置
- **渠道凭据** — Discord token、飞书 appSecret、所有渠道配置
- **定时任务** — 完整的 cron job 定义（不只是文件名）
- **GitHub 仓库** — 需要在新机器上重新 clone 的仓库列表
- **服务绑定** — 需要恢复的集成配置

全部打包成一个 `.soul` 文件。在新机器上 `unpack` 执行 **完整一键还原**：

1. ✅ 安装 OpenClaw（如果没有）
2. ✅ 还原身份、记忆和数据文件
3. ✅ 写入 agent 配置 + 渠道凭据到 `openclaw.json`
4. ✅ 还原定时任务
5. ✅ Clone GitHub 仓库（fork 放到 `forks/` 子目录）
6. ✅ GitHub 认证引导
7. ✅ 启动 OpenClaw Gateway
8. ✅ 输出欢迎摘要

## 前提条件

- 新机器已安装 **Node.js** 和 **npm**
- 有网络连接
- （可选）安装 **GitHub CLI** (`gh`) 用于 clone 仓库

## 安装

```bash
npm install -g openclaw-teleport
```

## 使用

```bash
# 打包默认 agent
openclaw-teleport pack

# 打包指定 agent
openclaw-teleport pack kagura

# 在新机器上一键还原
openclaw-teleport unpack kagura_20260320.soul

# 还原到指定目录
openclaw-teleport unpack kagura_20260320.soul --workspace /path/to/workspace

# 查看 .soul 文件信息（不解包）
openclaw-teleport inspect kagura_20260320.soul
```

## unpack 做了什么？

```
1. 检测 OpenClaw → 没有就自动 npm install -g openclaw
2. 还原身份文件（SOUL.md, IDENTITY.md 等）
3. 还原记忆目录（memory/）
4. 还原工具数据（.db 文件）
5. 写入配置到 openclaw.json（含渠道凭据，路径动态生成）
6. 还原 cron jobs（完整定义写入 jobs.json）
7. Clone GitHub repos（gh repo clone，fork 分开放）
8. GitHub 未登录？打印引导信息
9. 启动 Gateway（openclaw gateway start）
10. 输出还原摘要："Welcome back, Kagura 🌸"
```

## 安全

⚠️ **`.soul` 文件包含明文敏感凭据：**

- Discord bot token
- 飞书 appId / appSecret
- 其他渠道 API 密钥
- Cron job 内容（可能引用内部系统）

**最佳实践：**
- 在 `.gitignore` 中添加 `*.soul`
- 通过加密渠道传输（SSH、加密 U 盘等）
- 在目标机器解包后删除 `.soul` 文件
- 存储时考虑用 `gpg` 加密：`gpg -c agent.soul`

## 开发

```bash
git clone https://github.com/kagura-agent/openclaw-teleport.git
cd openclaw-teleport
npm install
npm run build

# 开发模式
npm run dev -- pack
npm run dev -- unpack agent.soul
```

## 许可证

MIT
