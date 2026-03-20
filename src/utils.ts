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
  /** Channel configurations with credentials (added in v0.2) */
  channels?: Record<string, unknown>;
  /** Full cron jobs content (added in v0.2) */
  cron_jobs?: CronJob[];
  /** Agent defaults from openclaw.json (added in v0.2) */
  agent_defaults?: Record<string, unknown>;
  /** Models configuration (added in v0.2) */
  models_config?: Record<string, unknown>;
  /** Bindings configuration (added in v0.2) */
  bindings?: Array<Record<string, unknown>>;
}

export interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: Record<string, unknown>;
  sessionTarget?: string;
  wakeMode?: string;
  payload: Record<string, unknown>;
  delivery?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenClawConfig {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: AgentConfig[];
  };
  channels?: Record<string, unknown>;
  models?: Record<string, unknown>;
  bindings?: Array<Record<string, unknown>>;
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
  // Only collect .db files from known tool data directories, not recursively
  // This prevents grabbing test DBs or unrelated data from project subdirs
  const knownPaths = [
    'gogetajob/data/gogetajob.db',
    'flowforge/flowforge.db',
    'data/gogetajob.db',
    'data/flowforge.db',
  ];
  for (const rel of knownPaths) {
    const full = path.join(workspace, rel);
    if (fs.existsSync(full)) {
      files.push(rel);
    }
  }
  // Also check workspace root for any .db files
  try {
    const rootEntries = fs.readdirSync(workspace, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && entry.name.endsWith('.db')) {
        files.push(entry.name);
      }
    }
  } catch {}
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

// ── Cron job content extraction ────────────────────────────────────

/**
 * Load full cron jobs for a specific agent from jobs.json.
 * Returns the actual job objects (not just file names).
 */
export function loadCronJobs(agentId: string): CronJob[] {
  const jobsPath = path.join(CRON_DIR, 'jobs.json');
  if (!fs.existsSync(jobsPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'));
    const jobs: CronJob[] = data.jobs ?? [];
    // Filter to this agent's jobs
    return jobs.filter((j) => j.agentId === agentId);
  } catch {
    return [];
  }
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

// ── Channel config extraction ──────────────────────────────────────

/**
 * Extract channel configurations (including credentials) relevant to an agent.
 * Strips absolute paths but preserves tokens, appIds, appSecrets, etc.
 */
export function extractChannelsConfig(config: OpenClawConfig, agentId: string): Record<string, unknown> {
  if (!config.channels) return {};

  // Deep clone to avoid mutating original
  const channels = JSON.parse(JSON.stringify(config.channels));

  // Strip absolute paths from the cloned config
  stripAbsolutePaths(channels);

  return channels;
}

/**
 * Recursively strip values that look like absolute paths.
 * We preserve tokens, keys, IDs — only remove filesystem paths.
 */
function stripAbsolutePaths(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string' && val.startsWith('/') && (val.includes('/home/') || val.includes('/Users/') || val.includes('/root/'))) {
      // Mark as path-to-regenerate
      obj[key] = `__PATH_PLACEHOLDER__`;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      stripAbsolutePaths(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (val[i] && typeof val[i] === 'object') {
          stripAbsolutePaths(val[i] as Record<string, unknown>);
        }
      }
    }
  }
}

/**
 * Strip absolute paths from agent defaults config.
 * Replaces workspace, agentDir, and other path-like values with placeholders.
 */
export function sanitizeAgentDefaults(defaults: Record<string, unknown>): Record<string, unknown> {
  const sanitized = JSON.parse(JSON.stringify(defaults));
  // Remove workspace — it will be set dynamically on unpack
  delete sanitized.workspace;
  return sanitized;
}

// ── Command helpers ────────────────────────────────────────────────

/**
 * Check if a command exists on the system.
 */
export function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check GitHub CLI auth status.
 * Returns true if authenticated.
 */
export function isGhAuthenticated(): boolean {
  try {
    execSync('gh auth status', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
