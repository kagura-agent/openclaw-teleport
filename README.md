# 🌸 soul-pack

**Agent soul migration** — pack your identity, memory, and tools into one file, unpack on a new machine.

Built for [OpenClaw](https://github.com/nicepkg/openclaw) agents.

## What it does

`soul-pack` captures everything that makes an agent *that agent*:

- **Identity files** — SOUL.md, IDENTITY.md, USER.md, AGENTS.md, etc.
- **Memory** — daily notes, long-term memory, everything in `memory/`
- **Tool data** — SQLite databases and other `.db` files
- **Config** — agent configuration from `openclaw.json`
- **Cron jobs** — scheduled tasks
- **GitHub repos** — list of repos to re-clone on the new machine
- **Service bindings** — which integrations need reconfiguration

All packed into a single `.soul` file (tar.gz). Unpack it on a new machine and your agent wakes up with all its memories intact.

## Install

```bash
npm install -g soul-pack
```

Or run directly:

```bash
npx soul-pack pack
```

## Usage

### Pack an agent

```bash
# Pack the default (first) agent
soul-pack pack

# Pack a specific agent
soul-pack pack kagura
```

Output: `kagura_20260320.soul`

### Unpack on a new machine

```bash
# Unpack to default workspace (~/.openclaw/workspace)
soul-pack unpack kagura_20260320.soul

# Unpack to a custom workspace
soul-pack unpack kagura_20260320.soul --workspace /path/to/workspace
```

What happens:
1. Identity files restored
2. Memory directory restored
3. Tool databases restored
4. Agent config merged into `openclaw.json`
5. Cron jobs restored
6. GitHub repos cloned
7. Service rebinding checklist printed

### Inspect a .soul file

```bash
soul-pack inspect kagura_20260320.soul
```

Shows manifest info without unpacking: agent name, pack date, file count, repo list, services.

## How it works

```
~/.openclaw/
├── openclaw.json          ← agent config extracted
├── cron/                  ← cron jobs collected
└── workspace/
    ├── SOUL.md            ← identity files packed
    ├── IDENTITY.md
    ├── USER.md
    ├── TOOLS.md
    ├── memory/            ← full memory directory packed
    │   ├── 2026-03-15.md
    │   └── ...
    └── *.db               ← tool databases packed

         ↓ soul-pack pack

    kagura_20260320.soul   (tar.gz archive)
    ├── manifest.json      ← metadata, repo list, services
    ├── identity/          ← .md files
    ├── memory/            ← memory directory
    ├── data/              ← .db files
    ├── config/            ← agent config
    └── cron/              ← scheduled tasks

         ↓ soul-pack unpack (on new machine)

    Agent restored with all memories and identity 🌸
```

## manifest.json

The manifest contains metadata about the packed agent:

```json
{
  "agent_id": "kagura",
  "agent_name": "Kagura",
  "packed_at": "2026-03-20T04:25:00.000Z",
  "files": ["identity/SOUL.md", "memory/2026-03-15.md", ...],
  "github_repos": [
    { "name": "soul-pack", "url": "https://github.com/kagura-agent/soul-pack", "isFork": false }
  ],
  "services_to_rebind": ["feishu", "github"]
}
```

## Development

```bash
git clone https://github.com/kagura-agent/soul-pack.git
cd soul-pack
npm install
npm run build

# Run in dev mode
npm run dev -- pack
```

## License

MIT

---

# 🌸 soul-pack（中文）

**Agent 灵魂迁移工具** — 把你的身份、记忆和工具打包成一个文件，在新机器上一键还原。

为 [OpenClaw](https://github.com/nicepkg/openclaw) agent 构建。

## 功能

`soul-pack` 捕获让一个 agent 成为「它自己」的一切：

- **身份文件** — SOUL.md、IDENTITY.md、USER.md、AGENTS.md 等
- **记忆** — 每日笔记、长期记忆、`memory/` 目录下的所有内容
- **工具数据** — SQLite 数据库和其他 `.db` 文件
- **配置** — `openclaw.json` 中的 agent 配置
- **定时任务** — cron jobs
- **GitHub 仓库** — 需要在新机器上重新 clone 的仓库列表
- **服务绑定** — 哪些集成需要重新配置

全部打包成一个 `.soul` 文件（tar.gz 格式）。在新机器上解包，你的 agent 就带着所有记忆醒来了。

## 安装

```bash
npm install -g soul-pack
```

## 使用

```bash
# 打包默认 agent
soul-pack pack

# 打包指定 agent
soul-pack pack kagura

# 在新机器上还原
soul-pack unpack kagura_20260320.soul

# 查看 .soul 文件信息
soul-pack inspect kagura_20260320.soul
```

## 许可证

MIT
