# 🌸 openclaw-teleport

**Agent soul migration** — pack your identity, memory, and tools into one file, unpack on a new machine and your agent comes back to life.

Built for [OpenClaw](https://github.com/nicepkg/openclaw) agents.

> ⚠️ **SECURITY WARNING:** `.soul` files contain **plaintext credentials** — API tokens, app secrets, Discord bot tokens, Feishu app keys, etc. Treat them like password files. **Never** commit to git, share publicly, or upload to untrusted storage.

## What it does

`openclaw-teleport` captures everything that makes an agent *that agent*:

- **Workspace** — entire workspace directory (identity files, memory, daily notes, workflows, skills, tool configs — everything except git repo subdirectories)
- **Config** — agent configuration from `openclaw.json`
- **Channel credentials** — Discord tokens, Feishu app secrets, all channel configs
- **Cron jobs** — full scheduled task definitions (not just file names)
- **GitHub repos** — list of repos to re-clone on the new machine
- **Service bindings** — which integrations to restore

All packed into a single `.soul` file (tar.gz). On a new machine, `unpack` does a **full one-command restoration**:

1. ✅ Installs OpenClaw (if missing)
2. ✅ Restores full workspace (files, memory, workflows, skills, databases)
3. ✅ Writes agent config + channel credentials to `openclaw.json` (including gateway, models, bindings, extraDirs)
4. ✅ Restores cron jobs
5. ✅ Restores credentials (pairing records, `.env`)
6. ✅ Restores session history (`.jsonl` files)
7. ✅ Clones GitHub repos (auto-detects forks)
8. ✅ Starts the OpenClaw gateway
9. ✅ Prints a welcome summary

## Prerequisites

- **Node.js** and **npm** installed on the new machine
- Network connectivity
- (Optional) **GitHub CLI** (`gh`) for repo cloning

## Install

```bash
npm install -g openclaw-teleport
```

Or run directly:

```bash
npx openclaw-teleport pack
```

## Usage

### Pack an agent

```bash
# Pack the default (first) agent
openclaw-teleport pack

# Pack a specific agent
openclaw-teleport pack kagura
```

Output: `kagura_20260320.soul`

The `.soul` file contains **all credentials** needed to restore the agent on another machine. Keep it safe.

### Unpack on a new machine

```bash
# Full one-command restore to default workspace (~/.openclaw/workspace)
openclaw-teleport unpack kagura_20260320.soul

# Restore to a custom workspace
openclaw-teleport unpack kagura_20260320.soul --workspace /path/to/workspace
```

What happens:
1. **OpenClaw check** — installs via `npm install -g openclaw` if missing
2. **Workspace restored** — full directory structure (identity, memory, workflows, skills, databases)
3. **Config written** — agent config + channel credentials merged into `openclaw.json` (gateway, models, bindings, extraDirs all restored)
4. **Cron jobs restored** — full job definitions written to `~/.openclaw/cron/jobs.json`
5. **Credentials restored** — pairing records (`~/.openclaw/credentials/`) and `.env` file
6. **Session history restored** — `.jsonl` session files to `~/.openclaw/agents/<id>/sessions/`
7. **GitHub repos cloned** — using `git clone` (git repo subdirectories that were skipped during pack)
8. **Gateway started** — `openclaw gateway start`
9. **Welcome summary** — file counts, repo status, configured services

### Inspect a .soul file

```bash
openclaw-teleport inspect kagura_20260320.soul
```

Shows manifest info without unpacking: agent name, pack date, file count, repo list, channels, cron jobs, services.

### Snapshot the entire OpenClaw instance

While `pack`/`unpack` operate on a **single agent**, `snapshot` captures the **entire `~/.openclaw/` directory** — all agents, configs, credentials, and sessions in one file.

```bash
# Pack a full instance snapshot
openclaw-teleport snapshot pack

# Pack to a custom output path
openclaw-teleport snapshot pack -o /tmp/my-backup.snapshot
```

Output: `~/.openclaw/backups/openclaw_YYYYMMDD.snapshot`

Skips: `node_modules`, `.git`, `dist`, `__pycache__`, `.venv`, `backups`, and git repo subdirectories inside agent workspaces (those are cloned on restore).

```bash
# Restore from a snapshot (requires empty ~/.openclaw/ or --force)
openclaw-teleport snapshot restore openclaw_20260405.snapshot
openclaw-teleport snapshot restore openclaw_20260405.snapshot --force
```

What happens:
1. **Files restored** — entire `~/.openclaw/` directory rebuilt from the archive
2. **Path correction** — all paths in `openclaw.json` adjusted from the original home directory to the new one
3. **Repos cloned** — workspace git repos re-cloned from their remotes
4. **Gateway started** — `openclaw gateway start`

```bash
# Inspect a snapshot without restoring
openclaw-teleport snapshot inspect openclaw_20260405.snapshot
```

Shows hostname, pack date, file count, agent list, repo list, and contents breakdown.

## How it works

```
~/.openclaw/
├── openclaw.json          ← agent config + channels extracted
├── cron/jobs.json         ← full cron job definitions
└── workspace/
    ├── SOUL.md            ← identity files
    ├── IDENTITY.md
    ├── USER.md
    ├── TOOLS.md
    ├── HEARTBEAT.md
    ├── NUDGE.md
    ├── beliefs-candidates.md
    ├── memory/            ← daily notes + long-term memory
    │   ├── 2026-03-15.md
    │   └── ...
    ├── skills/            ← custom skills
    ├── flowforge/         ← git repo (skipped, cloned on unpack)
    └── knowledge-base/    ← git repo (skipped, cloned on unpack)

         ↓ openclaw-teleport pack

    kagura_20260324.soul   (tar.gz archive)
    ├── manifest.json      ← metadata, repos, channels, cron jobs
    ├── workspace/         ← full workspace (minus git repos)
    │   ├── SOUL.md
    │   ├── memory/
    │   ├── skills/
    │   └── ...
    ├── config/            ← agent config
    ├── cron/              ← cron files
    ├── credentials/       ← pairing records + .env
    └── sessions/          ← session history (.jsonl files)

         ↓ openclaw-teleport unpack (on new machine)

    1. Install OpenClaw (if needed)
    2. Restore workspace files
    3. Write config + credentials to openclaw.json
       (channels, models, bindings, gateway, extraDirs)
    4. Restore cron jobs
    5. Restore credentials (pairing records, .env)
    6. Restore session history (.jsonl)
    7. Clone GitHub repos
    8. Start gateway
    9. "Welcome back, Kagura 🌸"
```

## manifest.json

The manifest contains metadata and embedded configurations:

```json
{
  "agent_id": "kagura",
  "agent_name": "Kagura",
  "packed_at": "2026-03-20T04:25:00.000Z",
  "files": ["workspace/SOUL.md", "workspace/memory/2026-03-15.md", "..."],
  "github_repos": [
    { "name": "openclaw-teleport", "url": "https://github.com/kagura-agent/openclaw-teleport", "isFork": false }
  ],
  "services_to_rebind": ["feishu", "discord"],
  "channels": {
    "discord": { "enabled": true, "accounts": { "..." } },
    "feishu": { "enabled": true, "accounts": { "..." } }
  },
  "cron_jobs": [
    { "id": "...", "name": "My scheduled task", "schedule": { "..." } }
  ],
  "agent_defaults": { "model": { "..." } },
  "models_config": { "..." },
  "bindings": [ { "..." } ],
  "gateway": { "..." },
  "extra_dirs_relative": ["kagura-skills"]
}
```

## Security

⚠️ **The `.soul` file contains sensitive credentials in plaintext:**

- Discord bot tokens
- Feishu app IDs and secrets
- Any other channel API keys
- Cron job payloads (which may reference internal systems)
- Pairing records and `.env` environment variables
- Session history

⚠️ **The `.snapshot` file contains the same sensitive data** — it captures the entire `~/.openclaw/` directory including all of the above.

**Best practices:**
- Add `*.soul` and `*.snapshot` to your `.gitignore`
- Transfer `.soul` files via encrypted channels (SSH, encrypted USB, etc.)
- Delete `.soul` files after unpacking on the target machine
- Consider encrypting with `gpg` for storage: `gpg -c agent.soul` / `gpg -c instance.snapshot`

## Development

```bash
git clone https://github.com/kagura-agent/openclaw-teleport.git
cd openclaw-teleport
npm install
npm run build

# Run in dev mode
npm run dev -- pack
npm run dev -- unpack agent.soul
npm run dev -- snapshot pack
npm run dev -- snapshot restore instance.snapshot
```

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=kagura-agent/openclaw-teleport&type=Date)](https://star-history.com/#kagura-agent/openclaw-teleport&Date)
