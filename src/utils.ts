import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Paths ──────────────────────────────────────────────────────────

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_PATH = path.join(OPENCLAW_DIR, 'openclaw.json');
const CRON_DIR = path.join(OPENCLAW_DIR, 'cron');

// ── Types ──────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  workspace: string;
  agentDir: string;
}

export interface Manifest {
  agent_id: string;
  agent_name: string;
  packed_at: string;
  files: string[];
  github_repos: Array<{ name: string; url: string; isFork: boolean }>;
  services_to_rebind: string[];
}

export interface OpenClawConfig {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: AgentConfig[];
  };
  channels?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Config helpers ─────────────────────────────────────────────────

export function loadConfig(): OpenClawConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`❌ Config not found: ${CONFIG_PATH}\n   Is OpenClaw installed?`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

export function findAgent(config: OpenClawConfig, agentId?: string): AgentConfig {
  const agents = config.agents?.list ?? [];
  if (agents.length === 0) {
    throw new Error('❌ No agents configured in openclaw.json');
  }

  if (agentId) {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) {
      const ids = agents.map((a) => a.id).join(', ');
      throw new Error(`❌ Agent "${agentId}" not found. Available: ${ids}`);
    }
    return agent;
  }

  // Default to first agent
  return agents[0];
}

// ── File collection ────────────────────────────────────────────────

export function collectMarkdownFiles(workspace: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(workspace, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entry.name);
    }
  }
  return files;
}

export function collectMemoryDir(workspace: string): string[] {
  const memoryDir = path.join(workspace, 'memory');
  if (!fs.existsSync(memoryDir)) return [];
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        files.push(rel);
      }
    }
  };
  walk(memoryDir, 'memory');
  return files;
}

export function collectDbFiles(workspace: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const rel = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith('.db')) {
        files.push(rel);
      }
    }
  };
  walk(workspace, '');
  return files;
}

export function collectCronFiles(agentId: string): string[] {
  if (!fs.existsSync(CRON_DIR)) return [];
  const files: string[] = [];
  const entries = fs.readdirSync(CRON_DIR, { withFileTypes: true });
  for (const entry of entries) {
    // Include jobs.json and any agent-specific files
    if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files;
}

// ── GitHub repos ───────────────────────────────────────────────────

export function getGitHubRepos(owner: string): Array<{ name: string; url: string; isFork: boolean }> {
  try {
    const output = execSync(`gh repo list ${owner} --json name,url,isFork --limit 100`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return JSON.parse(output);
  } catch (err) {
    console.log('⚠️  Could not fetch GitHub repos (gh CLI not available or not authenticated)');
    return [];
  }
}

// ── Services detection ─────────────────────────────────────────────

export function detectServices(config: OpenClawConfig): string[] {
  const services = new Set<string>();
  const channels = config.channels ?? (config as Record<string, unknown>);

  // Walk the config looking for channel-like keys
  for (const key of Object.keys(config)) {
    if (['feishu', 'discord', 'telegram', 'slack', 'whatsapp', 'github', 'twitter', 'email'].includes(key)) {
      services.add(key);
    }
  }

  // Also check if channels object exists
  if (config.channels && typeof config.channels === 'object') {
    for (const key of Object.keys(config.channels)) {
      services.add(key);
    }
  }

  return Array.from(services);
}

// ── Agent config extraction ────────────────────────────────────────

export function extractAgentConfig(config: OpenClawConfig, agentId: string): Record<string, unknown> {
  const agent = config.agents?.list?.find((a) => a.id === agentId);
  const defaults = config.agents?.defaults ?? {};
  return {
    agent,
    defaults,
  };
}
