#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";

// src/pack.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
import * as os2 from "node:os";
import { execSync as execSync2 } from "node:child_process";

// src/utils.ts
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
var OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");
var CONFIG_PATH = path.join(OPENCLAW_DIR, "openclaw.json");
var CRON_DIR = path.join(OPENCLAW_DIR, "cron");
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`\u274C Config not found: ${CONFIG_PATH}
   Is OpenClaw installed?`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}
function findAgent(config, agentId) {
  const agents = config.agents?.list ?? [];
  if (agents.length === 0) {
    throw new Error("\u274C No agents configured in openclaw.json");
  }
  if (agentId) {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) {
      const ids = agents.map((a) => a.id).join(", ");
      throw new Error(`\u274C Agent "${agentId}" not found. Available: ${ids}`);
    }
    return agent;
  }
  return agents[0];
}
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".venv", "venv"]);
function isGitRepo(dirPath) {
  return fs.existsSync(path.join(dirPath, ".git"));
}
function collectWorkspaceFiles(workspace) {
  const files = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (isGitRepo(fullPath)) continue;
        walk(fullPath, rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  walk(workspace, "");
  return files;
}
function collectCronFiles(agentId) {
  if (!fs.existsSync(CRON_DIR)) return [];
  const files = [];
  const entries = fs.readdirSync(CRON_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files;
}
function loadCronJobs(agentId) {
  const jobsPath = path.join(CRON_DIR, "jobs.json");
  if (!fs.existsSync(jobsPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
    const jobs = data.jobs ?? [];
    return jobs.filter((j) => j.agentId === agentId);
  } catch {
    return [];
  }
}
function detectWorkspaceRepos(workspace) {
  const repos = [];
  let entries;
  try {
    entries = fs.readdirSync(workspace, { withFileTypes: true });
  } catch {
    return repos;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(workspace, entry.name);
    if (!fs.existsSync(path.join(fullPath, ".git"))) continue;
    let url = "";
    try {
      url = execSync("git remote get-url origin", {
        cwd: fullPath,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 1e4
      }).trim();
    } catch {
      continue;
    }
    repos.push({
      name: entry.name,
      url,
      relativePath: entry.name
    });
  }
  return repos;
}
function detectServices(config) {
  const services = /* @__PURE__ */ new Set();
  const channels = config.channels ?? config;
  for (const key of Object.keys(config)) {
    if (["feishu", "discord", "telegram", "slack", "whatsapp", "github", "twitter", "email"].includes(key)) {
      services.add(key);
    }
  }
  if (config.channels && typeof config.channels === "object") {
    for (const key of Object.keys(config.channels)) {
      services.add(key);
    }
  }
  return Array.from(services);
}
function extractAgentConfig(config, agentId) {
  const agent = config.agents?.list?.find((a) => a.id === agentId);
  const defaults = config.agents?.defaults ?? {};
  return {
    agent,
    defaults
  };
}
function extractChannelsConfig(config, agentId) {
  if (!config.channels) return {};
  const channels = JSON.parse(JSON.stringify(config.channels));
  stripAbsolutePaths(channels);
  return channels;
}
function stripAbsolutePaths(obj) {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string" && val.startsWith("/") && (val.includes("/home/") || val.includes("/Users/") || val.includes("/root/"))) {
      obj[key] = `__PATH_PLACEHOLDER__`;
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      stripAbsolutePaths(val);
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        if (val[i] && typeof val[i] === "object") {
          stripAbsolutePaths(val[i]);
        }
      }
    }
  }
}
function sanitizeAgentDefaults(defaults) {
  const sanitized = JSON.parse(JSON.stringify(defaults));
  delete sanitized.workspace;
  return sanitized;
}
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// src/pack.ts
var OPENCLAW_DIR2 = path2.join(os2.homedir(), ".openclaw");
var CRON_DIR2 = path2.join(OPENCLAW_DIR2, "cron");
async function pack(agentId, outputPath) {
  console.log("\n\u{1F338} openclaw-teleport \u2014 packing agent soul...\n");
  const config = loadConfig();
  const agent = findAgent(config, agentId);
  console.log(`\u{1F4E6} Agent: ${agent.name} (${agent.id})`);
  console.log(`\u{1F4C2} Workspace: ${agent.workspace}
`);
  if (!fs2.existsSync(agent.workspace)) {
    throw new Error(`\u274C Workspace not found: ${agent.workspace}`);
  }
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const soulName = `${agent.id}_${date}`;
  const tmpDir = path2.join(os2.tmpdir(), `openclaw-teleport-${soulName}`);
  const stageDir = path2.join(tmpDir, "soul");
  if (fs2.existsSync(tmpDir)) {
    fs2.rmSync(tmpDir, { recursive: true });
  }
  fs2.mkdirSync(stageDir, { recursive: true });
  const allFiles = [];
  console.log("\u{1F4C2} Collecting workspace files...");
  const wsFiles = collectWorkspaceFiles(agent.workspace);
  for (const f of wsFiles) {
    const src = path2.join(agent.workspace, f);
    const dst = path2.join(stageDir, "workspace", f);
    fs2.mkdirSync(path2.dirname(dst), { recursive: true });
    fs2.copyFileSync(src, dst);
    allFiles.push(`workspace/${f}`);
  }
  console.log(`   \u2705 ${wsFiles.length} files (skipped git repo subdirs)`);
  try {
    const topEntries = fs2.readdirSync(agent.workspace, { withFileTypes: true });
    const skippedRepos = [];
    for (const entry of topEntries) {
      if (entry.isDirectory()) {
        const gitDir = path2.join(agent.workspace, entry.name, ".git");
        if (fs2.existsSync(gitDir)) {
          skippedRepos.push(entry.name);
        }
      }
    }
    if (skippedRepos.length > 0) {
      console.log(`   \u23ED\uFE0F  Skipped git repos (will clone on unpack): ${skippedRepos.join(", ")}`);
    }
  } catch {
  }
  console.log("\u2699\uFE0F  Extracting agent config...");
  const agentConfig = extractAgentConfig(config, agent.id);
  const configPath = path2.join(stageDir, "config", "agent-config.json");
  fs2.mkdirSync(path2.dirname(configPath), { recursive: true });
  fs2.writeFileSync(configPath, JSON.stringify(agentConfig, null, 2));
  allFiles.push("config/agent-config.json");
  console.log("   \u2705 Agent config saved");
  console.log("\u23F0 Collecting cron jobs...");
  const cronFiles = collectCronFiles(agent.id);
  for (const f of cronFiles) {
    const src = path2.join(CRON_DIR2, f);
    const dst = path2.join(stageDir, "cron", f);
    fs2.mkdirSync(path2.dirname(dst), { recursive: true });
    fs2.copyFileSync(src, dst);
    allFiles.push(`cron/${f}`);
  }
  console.log(`   \u2705 ${cronFiles.length} cron files`);
  console.log("\u{1F4AC} Collecting session history...");
  const sessionsDir = path2.join(OPENCLAW_DIR2, "agents", agent.id, "sessions");
  let sessionCount = 0;
  let sessionBytes = 0;
  if (fs2.existsSync(sessionsDir)) {
    const sessionFiles = fs2.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    for (const f of sessionFiles) {
      const src = path2.join(sessionsDir, f);
      const dst = path2.join(stageDir, "sessions", f);
      fs2.mkdirSync(path2.dirname(dst), { recursive: true });
      fs2.copyFileSync(src, dst);
      allFiles.push(`sessions/${f}`);
      sessionCount++;
      sessionBytes += fs2.statSync(src).size;
    }
  }
  const sessionSizeMB = (sessionBytes / 1024 / 1024).toFixed(1);
  console.log(`   \u2705 ${sessionCount} sessions (${sessionSizeMB} MB)`);
  console.log("\u{1F510} Collecting credentials...");
  const credDir = path2.join(OPENCLAW_DIR2, "credentials");
  let credCount = 0;
  if (fs2.existsSync(credDir)) {
    const credFiles = fs2.readdirSync(credDir).filter((f) => f.endsWith(".json"));
    for (const f of credFiles) {
      const src = path2.join(credDir, f);
      const dst = path2.join(stageDir, "credentials", f);
      fs2.mkdirSync(path2.dirname(dst), { recursive: true });
      fs2.copyFileSync(src, dst);
      allFiles.push(`credentials/${f}`);
      credCount++;
    }
  }
  console.log(`   \u2705 ${credCount} credential files`);
  const envFile = path2.join(OPENCLAW_DIR2, ".env");
  if (fs2.existsSync(envFile)) {
    const dst = path2.join(stageDir, "credentials", ".env");
    fs2.mkdirSync(path2.dirname(dst), { recursive: true });
    fs2.copyFileSync(envFile, dst);
    allFiles.push("credentials/.env");
    console.log("   \u2705 .env file collected");
  }
  console.log("\u23F0 Extracting cron job definitions...");
  const cronJobs = loadCronJobs(agent.id);
  console.log(`   \u2705 ${cronJobs.length} cron jobs for ${agent.id}`);
  console.log("\u{1F419} Detecting workspace repos...");
  const repos = detectWorkspaceRepos(agent.workspace);
  console.log(`   \u2705 ${repos.length} repos found`);
  const services = detectServices(config);
  console.log(`\u{1F517} Services to rebind: ${services.length > 0 ? services.join(", ") : "none"}`);
  console.log("\u{1F511} Extracting channel credentials...");
  const channelsConfig = extractChannelsConfig(config, agent.id);
  const channelCount = Object.keys(channelsConfig).length;
  console.log(`   \u2705 ${channelCount} channel(s) saved`);
  const agentDefaults = sanitizeAgentDefaults(config.agents?.defaults ?? {});
  const modelsConfig = config.models ?? {};
  const bindingsConfig = config.bindings ?? [];
  const gatewayConfig = config.gateway ?? {};
  const extraDirsRelative = [];
  const skillsConfig = config.skills;
  const loadConfig22 = skillsConfig?.load;
  const extraDirs = loadConfig22?.extraDirs;
  if (extraDirs && Array.isArray(extraDirs)) {
    for (const dir of extraDirs) {
      const resolvedDir = path2.resolve(dir);
      const resolvedWorkspace = path2.resolve(agent.workspace);
      if (resolvedDir.startsWith(resolvedWorkspace + path2.sep)) {
        const rel = path2.relative(resolvedWorkspace, resolvedDir);
        extraDirsRelative.push(rel);
        console.log(`   \u{1F4C1} extraDir (workspace-relative): ${rel}`);
      } else {
        console.log(`   \u26A0\uFE0F  extraDir outside workspace (not portable): ${dir}`);
      }
    }
  }
  const manifest = {
    agent_id: agent.id,
    agent_name: agent.name,
    packed_at: (/* @__PURE__ */ new Date()).toISOString(),
    files: allFiles,
    github_repos: repos,
    extra_dirs_relative: extraDirsRelative.length > 0 ? extraDirsRelative : void 0,
    services_to_rebind: services,
    channels: channelsConfig,
    cron_jobs: cronJobs,
    agent_defaults: agentDefaults,
    models_config: modelsConfig,
    bindings: bindingsConfig,
    gateway: gatewayConfig
  };
  const manifestPath = path2.join(stageDir, "manifest.json");
  fs2.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const outputFile = outputPath ? path2.resolve(outputPath) : path2.resolve(`${soulName}.soul`);
  console.log("\n\u{1F4E6} Packing soul archive...");
  execSync2(`tar -czf "${outputFile}" -C "${tmpDir}" soul`, {
    encoding: "utf-8"
  });
  fs2.rmSync(tmpDir, { recursive: true });
  const stats = fs2.statSync(outputFile);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log("\n" + "\u2550".repeat(50));
  console.log("\u{1F338} Soul packed successfully!");
  console.log("\u2550".repeat(50));
  console.log(`\u{1F4E6} File:     ${outputFile}`);
  console.log(`\u{1F4CF} Size:     ${sizeMB} MB`);
  console.log(`\u{1F194} Agent:    ${agent.name} (${agent.id})`);
  console.log(`\u{1F4DD} Files:    ${allFiles.length}`);
  console.log(`\u{1F419} Repos:    ${repos.length}`);
  console.log(`\u{1F517} Services: ${services.join(", ") || "none"}`);
  console.log(`\u{1F511} Channels: ${channelCount}`);
  console.log(`\u{1F4AC} Sessions: ${sessionCount} (${sessionSizeMB} MB raw)`);
  console.log(`\u23F0 Cron:     ${cronJobs.length} jobs`);
  console.log(`\u{1F4C5} Packed:   ${manifest.packed_at}`);
  console.log("\u2550".repeat(50));
  console.log("\n\u26A0\uFE0F  SECURITY WARNING: The .soul file contains credentials");
  console.log("   (API tokens, app secrets). Treat it like a password file.");
  console.log("   Do NOT commit it to git or share publicly.\n");
}

// src/commands.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
import * as os3 from "node:os";
import { execSync as execSync3 } from "node:child_process";
var OPENCLAW_DIR3 = path3.join(os3.homedir(), ".openclaw");
var CONFIG_PATH2 = path3.join(OPENCLAW_DIR3, "openclaw.json");
var CRON_DIR3 = path3.join(OPENCLAW_DIR3, "cron");
function extractManifest(soulFile) {
  const tmpDir = path3.join(os3.tmpdir(), `soul-unpack-${Date.now()}`);
  fs3.mkdirSync(tmpDir, { recursive: true });
  execSync3(`tar -xzf "${path3.resolve(soulFile)}" -C "${tmpDir}"`, { encoding: "utf-8" });
  const manifestPath = path3.join(tmpDir, "soul", "manifest.json");
  if (!fs3.existsSync(manifestPath)) {
    fs3.rmSync(tmpDir, { recursive: true });
    throw new Error("\u274C Invalid .soul file: manifest.json not found");
  }
  const manifest = JSON.parse(fs3.readFileSync(manifestPath, "utf-8"));
  return { tmpDir, manifest };
}
function ensureOpenClaw() {
  console.log("\u{1F527} Checking OpenClaw installation...");
  if (commandExists("openclaw")) {
    try {
      const version = execSync3("openclaw --version", { encoding: "utf-8", stdio: "pipe" }).trim();
      console.log(`   \u2705 OpenClaw found (${version})`);
    } catch {
      console.log("   \u2705 OpenClaw found");
    }
    return true;
  }
  console.log("   \u2B07\uFE0F  OpenClaw not found, installing...");
  try {
    execSync3("npm install -g openclaw", {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 12e4
    });
    if (commandExists("openclaw")) {
      console.log("   \u2705 OpenClaw installed successfully");
      return true;
    } else {
      console.log("   \u26A0\uFE0F  Installation completed but openclaw command not found in PATH");
      console.log("      Try: npm install -g openclaw");
      return false;
    }
  } catch (err) {
    console.log("   \u26A0\uFE0F  Failed to install OpenClaw automatically");
    console.log("      Run manually: npm install -g openclaw");
    return false;
  }
}
function writeAgentConfig(manifest, stageDir, targetWorkspace) {
  console.log("\u2699\uFE0F  Writing agent configuration...");
  fs3.mkdirSync(OPENCLAW_DIR3, { recursive: true });
  const agentConfigPath = path3.join(stageDir, "config", "agent-config.json");
  if (!fs3.existsSync(agentConfigPath)) {
    console.log("   \u26A0\uFE0F  No agent config in archive, skipping");
    return;
  }
  const agentConfig = JSON.parse(fs3.readFileSync(agentConfigPath, "utf-8"));
  const agentDir = path3.join(OPENCLAW_DIR3, "agents", manifest.agent_id, "agent");
  const savedAgent = agentConfig.agent ?? {};
  delete savedAgent.workspace;
  delete savedAgent.agentDir;
  const newAgent = {
    id: manifest.agent_id,
    name: manifest.agent_name,
    ...savedAgent,
    // Set paths dynamically for the new machine
    workspace: targetWorkspace,
    agentDir
  };
  if (fs3.existsSync(CONFIG_PATH2)) {
    const existingConfig = JSON.parse(fs3.readFileSync(CONFIG_PATH2, "utf-8"));
    if (!existingConfig.agents) {
      existingConfig.agents = { list: [] };
    }
    if (!existingConfig.agents.list) {
      existingConfig.agents.list = [];
    }
    const existingIdx = existingConfig.agents.list.findIndex(
      (a) => a.id === manifest.agent_id
    );
    if (existingIdx >= 0) {
      existingConfig.agents.list[existingIdx] = newAgent;
      console.log("   \u2705 Agent config updated (merged into existing)");
    } else {
      existingConfig.agents.list.push(newAgent);
      console.log("   \u2705 Agent config added to existing openclaw.json");
    }
    if (manifest.agent_defaults && Object.keys(manifest.agent_defaults).length > 0) {
      if (!existingConfig.agents.defaults) {
        existingConfig.agents.defaults = {};
      }
      existingConfig.agents.defaults = {
        ...existingConfig.agents.defaults,
        ...manifest.agent_defaults,
        workspace: targetWorkspace
      };
      console.log("   \u2705 Agent defaults merged");
    }
    if (manifest.channels && Object.keys(manifest.channels).length > 0) {
      if (!existingConfig.channels) {
        existingConfig.channels = {};
      }
      for (const [key, val] of Object.entries(manifest.channels)) {
        if (!(key in existingConfig.channels)) {
          existingConfig.channels[key] = val;
          console.log(`   \u2705 Channel '${key}' config added`);
        } else {
          console.log(`   \u23ED\uFE0F  Channel '${key}' already exists, skipping`);
        }
      }
    }
    if (manifest.models_config && Object.keys(manifest.models_config).length > 0) {
      if (!existingConfig.models) {
        existingConfig.models = manifest.models_config;
        console.log("   \u2705 Models config restored");
      } else {
        console.log("   \u23ED\uFE0F  Models config already exists, skipping");
      }
    }
    if (manifest.bindings && manifest.bindings.length > 0) {
      if (!existingConfig.bindings || existingConfig.bindings.length === 0) {
        existingConfig.bindings = manifest.bindings;
        console.log("   \u2705 Bindings restored");
      } else {
        console.log("   \u23ED\uFE0F  Bindings already exist, skipping");
      }
    }
    if (manifest.gateway && Object.keys(manifest.gateway).length > 0) {
      existingConfig.gateway = { ...existingConfig.gateway ?? {}, ...manifest.gateway };
      console.log("   \u2705 Gateway config restored");
    }
    if (manifest.extra_dirs_relative && manifest.extra_dirs_relative.length > 0) {
      const absoluteDirs = manifest.extra_dirs_relative.map((rel) => path3.join(targetWorkspace, rel));
      if (!existingConfig.skills) {
        existingConfig.skills = { load: { extraDirs: absoluteDirs } };
      } else {
        const skills = existingConfig.skills;
        if (!skills.load) {
          skills.load = { extraDirs: absoluteDirs };
        } else {
          skills.load.extraDirs = absoluteDirs;
        }
      }
      console.log(`   \u2705 extraDirs restored: ${absoluteDirs.join(", ")}`);
    }
    fs3.writeFileSync(CONFIG_PATH2, JSON.stringify(existingConfig, null, 2));
  } else {
    const newConfig = {
      agents: {
        defaults: {
          ...manifest.agent_defaults ?? {},
          workspace: targetWorkspace
        },
        list: [newAgent]
      }
    };
    if (manifest.channels && Object.keys(manifest.channels).length > 0) {
      newConfig.channels = manifest.channels;
      console.log("   \u2705 Channel configs restored");
    }
    if (manifest.models_config && Object.keys(manifest.models_config).length > 0) {
      newConfig.models = manifest.models_config;
      console.log("   \u2705 Models config restored");
    }
    if (manifest.bindings && manifest.bindings.length > 0) {
      newConfig.bindings = manifest.bindings;
      console.log("   \u2705 Bindings restored");
    }
    if (manifest.gateway && Object.keys(manifest.gateway).length > 0) {
      newConfig.gateway = manifest.gateway;
      console.log("   \u2705 Gateway config restored");
    }
    if (manifest.extra_dirs_relative && manifest.extra_dirs_relative.length > 0) {
      const absoluteDirs = manifest.extra_dirs_relative.map((rel) => path3.join(targetWorkspace, rel));
      newConfig.skills = { load: { extraDirs: absoluteDirs } };
      console.log(`   \u2705 extraDirs restored: ${absoluteDirs.join(", ")}`);
    }
    fs3.writeFileSync(CONFIG_PATH2, JSON.stringify(newConfig, null, 2));
    console.log("   \u2705 New openclaw.json created");
  }
  fs3.mkdirSync(agentDir, { recursive: true });
}
function restoreCronJobs(manifest, stageDir) {
  console.log("\u23F0 Restoring cron jobs...");
  const cronDir = path3.join(stageDir, "cron");
  let cronFileCount = 0;
  if (fs3.existsSync(cronDir)) {
    fs3.mkdirSync(CRON_DIR3, { recursive: true });
    const files = fs3.readdirSync(cronDir);
    for (const f of files) {
      fs3.copyFileSync(path3.join(cronDir, f), path3.join(CRON_DIR3, f));
      cronFileCount++;
    }
  }
  if (manifest.cron_jobs && manifest.cron_jobs.length > 0) {
    fs3.mkdirSync(CRON_DIR3, { recursive: true });
    const jobsPath = path3.join(CRON_DIR3, "jobs.json");
    let existingJobs = [];
    if (fs3.existsSync(jobsPath)) {
      try {
        const data = JSON.parse(fs3.readFileSync(jobsPath, "utf-8"));
        existingJobs = data.jobs ?? [];
      } catch {
        existingJobs = [];
      }
    }
    for (const job of manifest.cron_jobs) {
      const idx = existingJobs.findIndex((j) => j.id === job.id);
      if (idx >= 0) {
        existingJobs[idx] = job;
      } else {
        existingJobs.push(job);
      }
    }
    fs3.writeFileSync(jobsPath, JSON.stringify({ version: 1, jobs: existingJobs }, null, 2));
    console.log(`   \u2705 ${manifest.cron_jobs.length} cron job(s) restored`);
  } else if (cronFileCount > 0) {
    console.log(`   \u2705 ${cronFileCount} cron file(s) restored`);
  } else {
    console.log("   (none)");
  }
  return manifest.cron_jobs?.length ?? cronFileCount;
}
function restoreCredentials(stageDir) {
  console.log("\u{1F510} Restoring credentials...");
  const credSrc = path3.join(stageDir, "credentials");
  if (!fs3.existsSync(credSrc)) {
    console.log("   (none)");
    return 0;
  }
  const credDst = path3.join(OPENCLAW_DIR3, "credentials");
  fs3.mkdirSync(credDst, { recursive: true });
  const files = fs3.readdirSync(credSrc).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    fs3.copyFileSync(path3.join(credSrc, f), path3.join(credDst, f));
  }
  console.log(`   \u2705 ${files.length} credential file(s) restored`);
  const envSrc = path3.join(credSrc, ".env");
  if (fs3.existsSync(envSrc)) {
    const envDst = path3.join(OPENCLAW_DIR3, ".env");
    if (!fs3.existsSync(envDst)) {
      fs3.copyFileSync(envSrc, envDst);
      console.log("   \u2705 .env file restored");
    } else {
      console.log("   \u23ED\uFE0F  .env already exists, skipping");
    }
  }
  return files.length;
}
function cloneWorkspaceRepos(manifest, targetWorkspace) {
  const result = { cloned: 0, skipped: 0, failed: 0 };
  if (!manifest.github_repos || manifest.github_repos.length === 0) {
    return result;
  }
  console.log("\n\u{1F419} Cloning workspace repos...");
  if (!commandExists("git")) {
    console.log("   \u26A0\uFE0F  git not found");
    console.log(`   Repos to clone manually (${manifest.github_repos.length}):`);
    for (const repo of manifest.github_repos) {
      console.log(`     git clone ${repo.url} ${repo.relativePath}`);
    }
    result.failed = manifest.github_repos.length;
    return result;
  }
  for (const repo of manifest.github_repos) {
    const targetDir = path3.join(targetWorkspace, repo.relativePath);
    if (fs3.existsSync(targetDir)) {
      console.log(`   \u23ED\uFE0F  ${repo.relativePath} (already exists)`);
      result.skipped++;
      continue;
    }
    try {
      fs3.mkdirSync(path3.dirname(targetDir), { recursive: true });
      console.log(`   \u{1F4E5} Cloning ${repo.name} \u2192 ${repo.relativePath}...`);
      execSync3(`git clone "${repo.url}" "${targetDir}"`, {
        encoding: "utf-8",
        timeout: 12e4,
        stdio: "pipe"
      });
      console.log(`   \u2705 ${repo.name}`);
      result.cloned++;
    } catch {
      console.log(`   \u26A0\uFE0F  Failed to clone ${repo.name} (${repo.url})`);
      result.failed++;
    }
  }
  return result;
}
function startGateway() {
  console.log("\n\u{1F680} Starting OpenClaw Gateway...");
  if (!commandExists("openclaw")) {
    console.log("   \u26A0\uFE0F  openclaw command not found, skipping gateway start");
    return false;
  }
  try {
    const output = execSync3("openclaw gateway start", {
      encoding: "utf-8",
      timeout: 3e4,
      stdio: "pipe"
    });
    console.log("   \u2705 Gateway started");
    if (output.trim()) {
      const lines = output.trim().split("\n").slice(0, 3);
      for (const line of lines) {
        console.log(`      ${line}`);
      }
    }
    return true;
  } catch (err) {
    console.log("   \u26A0\uFE0F  Failed to start gateway");
    if (err instanceof Error && "stderr" in err) {
      const stderr = err.stderr?.trim();
      if (stderr) {
        console.log(`      ${stderr.split("\n")[0]}`);
      }
    }
    console.log("      Try manually: openclaw gateway start");
    return false;
  }
}
async function unpack(soulFile, workspacePath) {
  console.log("\n\u{1F338} openclaw-teleport \u2014 unpacking agent soul...\n");
  if (!fs3.existsSync(soulFile)) {
    throw new Error(`\u274C File not found: ${soulFile}`);
  }
  const { tmpDir, manifest } = extractManifest(soulFile);
  const stageDir = path3.join(tmpDir, "soul");
  console.log(`\u{1F194} Agent: ${manifest.agent_name} (${manifest.agent_id})`);
  console.log(`\u{1F4C5} Packed: ${manifest.packed_at}`);
  console.log(`\u{1F4DD} Files: ${manifest.files.length}`);
  console.log("");
  const openclawInstalled = ensureOpenClaw();
  const targetWorkspace = workspacePath ? path3.resolve(workspacePath) : path3.join(OPENCLAW_DIR3, "workspace");
  fs3.mkdirSync(targetWorkspace, { recursive: true });
  console.log("\n\u{1F4C2} Restoring workspace files...");
  let workspaceCount = 0;
  const workspaceDir = path3.join(stageDir, "workspace");
  if (fs3.existsSync(workspaceDir)) {
    const copyRecursive = (src, dst) => {
      fs3.mkdirSync(dst, { recursive: true });
      const entries = fs3.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path3.join(src, entry.name);
        const dstPath = path3.join(dst, entry.name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, dstPath);
        } else {
          fs3.copyFileSync(srcPath, dstPath);
          workspaceCount++;
        }
      }
    };
    copyRecursive(workspaceDir, targetWorkspace);
    console.log(`   \u2705 ${workspaceCount} files restored`);
  } else {
    console.log("   \u26A0\uFE0F  No workspace/ directory in archive");
  }
  writeAgentConfig(manifest, stageDir, targetWorkspace);
  const cronCount = restoreCronJobs(manifest, stageDir);
  const credCount = restoreCredentials(stageDir);
  console.log("\u{1F4AC} Restoring session history...");
  const sessionsStageDir = path3.join(stageDir, "sessions");
  let sessionRestoreCount = 0;
  if (fs3.existsSync(sessionsStageDir)) {
    const targetSessionsDir = path3.join(OPENCLAW_DIR3, "agents", manifest.agent_id, "sessions");
    fs3.mkdirSync(targetSessionsDir, { recursive: true });
    const sessionFiles = fs3.readdirSync(sessionsStageDir).filter((f) => f.endsWith(".jsonl"));
    for (const f of sessionFiles) {
      const src = path3.join(sessionsStageDir, f);
      const dst = path3.join(targetSessionsDir, f);
      if (!fs3.existsSync(dst)) {
        fs3.copyFileSync(src, dst);
        sessionRestoreCount++;
      }
    }
    console.log(`   \u2705 ${sessionRestoreCount} sessions restored (${sessionFiles.length - sessionRestoreCount} already existed)`);
  } else {
    console.log("   \u23ED\uFE0F  No sessions in archive");
  }
  const repoResult = cloneWorkspaceRepos(manifest, targetWorkspace);
  fs3.rmSync(tmpDir, { recursive: true });
  let gatewayStarted = false;
  if (openclawInstalled) {
    gatewayStarted = startGateway();
  }
  const configuredServices = [];
  if (manifest.channels) {
    for (const [key, val] of Object.entries(manifest.channels)) {
      if (val && typeof val === "object" && val.enabled !== false) {
        configuredServices.push(key);
      }
    }
  }
  console.log("\n" + "\u2550".repeat(50));
  console.log("\u{1F338} Restoration Summary");
  console.log("\u2550".repeat(50));
  console.log(`\u{1F194} Agent:      ${manifest.agent_name} (${manifest.agent_id})`);
  console.log(`\u{1F4C2} Workspace:  ${targetWorkspace}`);
  console.log(`\u{1F4DD} Files:      ${workspaceCount} workspace files`);
  console.log(`\u23F0 Cron:       ${cronCount} job(s)`);
  console.log(`\u{1F4AC} Sessions:   ${sessionRestoreCount} restored`);
  if (manifest.github_repos && manifest.github_repos.length > 0) {
    console.log(`\u{1F419} Repos:      ${repoResult.cloned} cloned, ${repoResult.skipped} skipped, ${repoResult.failed} failed`);
  }
  if (configuredServices.length > 0) {
    console.log(`\u{1F517} Services:   ${configuredServices.join(", ")}`);
  }
  console.log(`\u{1F527} OpenClaw:   ${openclawInstalled ? "\u2705" : "\u26A0\uFE0F  needs install"}`);
  console.log(`\u{1F680} Gateway:    ${gatewayStarted ? "\u2705 running" : "\u26A0\uFE0F  not started"}`);
  if (manifest.services_to_rebind && manifest.services_to_rebind.length > 0) {
    const needsRebind = manifest.services_to_rebind.filter(
      (s) => !configuredServices.includes(s)
    );
    if (needsRebind.length > 0) {
      console.log("\n\u{1F517} Services that may need attention:");
      for (const svc of needsRebind) {
        console.log(`   \u2610 ${svc}`);
      }
    }
  }
  console.log("\n" + "\u2550".repeat(50));
  console.log(`Welcome back, ${manifest.agent_name} \u{1F338}`);
  console.log("\u2550".repeat(50) + "\n");
}
async function inspect(soulFile) {
  if (!fs3.existsSync(soulFile)) {
    throw new Error(`\u274C File not found: ${soulFile}`);
  }
  const tmpDir = path3.join(os3.tmpdir(), `soul-inspect-${Date.now()}`);
  fs3.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync3(`tar -xzf "${path3.resolve(soulFile)}" -C "${tmpDir}" soul/manifest.json`, {
      encoding: "utf-8"
    });
    const manifestPath = path3.join(tmpDir, "soul", "manifest.json");
    if (!fs3.existsSync(manifestPath)) {
      throw new Error("\u274C Invalid .soul file: manifest.json not found");
    }
    const manifest = JSON.parse(fs3.readFileSync(manifestPath, "utf-8"));
    const stats = fs3.statSync(path3.resolve(soulFile));
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log("\n" + "\u2550".repeat(50));
    console.log("\u{1F338} Soul Archive Inspection");
    console.log("\u2550".repeat(50));
    console.log(`\u{1F194} Agent:    ${manifest.agent_name} (${manifest.agent_id})`);
    console.log(`\u{1F4C5} Packed:   ${manifest.packed_at}`);
    console.log(`\u{1F4CF} Size:     ${sizeMB} MB`);
    console.log(`\u{1F4DD} Files:    ${manifest.files.length}`);
    if (manifest.github_repos.length > 0) {
      console.log(`
\u{1F419} Workspace Repos (${manifest.github_repos.length}):`);
      for (const repo of manifest.github_repos) {
        console.log(`   \u2022 ${repo.name} (\u2192 ${repo.relativePath})`);
        console.log(`     ${repo.url}`);
      }
    }
    if (manifest.channels && Object.keys(manifest.channels).length > 0) {
      console.log(`
\u{1F511} Channels (${Object.keys(manifest.channels).length}):`);
      for (const key of Object.keys(manifest.channels)) {
        console.log(`   \u2022 ${key}`);
      }
    }
    if (manifest.cron_jobs && manifest.cron_jobs.length > 0) {
      console.log(`
\u23F0 Cron Jobs (${manifest.cron_jobs.length}):`);
      for (const job of manifest.cron_jobs) {
        const status = job.enabled ? "\u{1F7E2}" : "\u{1F534}";
        console.log(`   ${status} ${job.name}`);
      }
    }
    if (manifest.services_to_rebind.length > 0) {
      console.log(`
\u{1F517} Services to rebind:`);
      for (const svc of manifest.services_to_rebind) {
        console.log(`   \u2022 ${svc}`);
      }
    }
    const workspaceFiles = manifest.files.filter((f) => f.startsWith("workspace/"));
    const cronFiles = manifest.files.filter((f) => f.startsWith("cron/"));
    const configFiles = manifest.files.filter((f) => f.startsWith("config/"));
    const credFiles = manifest.files.filter((f) => f.startsWith("credentials/"));
    console.log("\n\u{1F4CA} Contents breakdown:");
    if (workspaceFiles.length > 0) console.log(`   \u{1F4C2} Workspace: ${workspaceFiles.length} files`);
    if (cronFiles.length > 0) console.log(`   \u23F0 Cron:     ${cronFiles.length} files`);
    if (configFiles.length > 0) console.log(`   \u2699\uFE0F  Config:   ${configFiles.length} files`);
    if (credFiles.length > 0) console.log(`   \u{1F510} Creds:    ${credFiles.length} files`);
    console.log("\u2550".repeat(50) + "\n");
  } finally {
    fs3.rmSync(tmpDir, { recursive: true });
  }
}

// src/snapshot.ts
import * as fs4 from "node:fs";
import * as path4 from "node:path";
import * as os4 from "node:os";
import { execSync as execSync4 } from "node:child_process";
var OPENCLAW_DIR4 = path4.join(os4.homedir(), ".openclaw");
var SKIP_DIRS2 = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "__pycache__", "backups"]);
var SKIP_PREFIXES = [".venv"];
function isGitRepo2(dirPath) {
  return fs4.existsSync(path4.join(dirPath, ".git"));
}
function collectWorkspaceRepoPaths(config) {
  const repoPaths = /* @__PURE__ */ new Set();
  const agents = config.agents?.list ?? [];
  for (const agent of agents) {
    if (!agent.workspace || !fs4.existsSync(agent.workspace)) continue;
    try {
      const entries = fs4.readdirSync(agent.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path4.join(agent.workspace, entry.name);
        if (isGitRepo2(fullPath)) {
          repoPaths.add(fullPath);
        }
      }
    } catch {
    }
  }
  return repoPaths;
}
function collectOpenClawFiles(repoAbsPaths) {
  const files = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs4.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS2.has(entry.name)) continue;
      if (SKIP_PREFIXES.some((p) => entry.name.startsWith(p))) continue;
      const fullPath = path4.join(dir, entry.name);
      const rel = prefix ? path4.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (repoAbsPaths.has(fullPath)) continue;
        walk(fullPath, rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  walk(OPENCLAW_DIR4, "");
  return files;
}
function replacePathsInObject(obj, oldStr, newStr) {
  if (typeof obj === "string") {
    return obj.split(oldStr).join(newStr);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => replacePathsInObject(item, oldStr, newStr));
  }
  if (obj !== null && typeof obj === "object") {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = replacePathsInObject(val, oldStr, newStr);
    }
    return result;
  }
  return obj;
}
async function snapshotPack(outputPath) {
  console.log("\n\u{1F338} openclaw-teleport \u2014 packing full instance snapshot...\n");
  const config = loadConfig();
  const configRaw = fs4.readFileSync(path4.join(OPENCLAW_DIR4, "openclaw.json"), "utf-8");
  const openclawConfig = JSON.parse(configRaw);
  const agents = config.agents?.list ?? [];
  console.log(`\u{1F4E6} OpenClaw instance: ${OPENCLAW_DIR4}`);
  console.log(`\u{1F916} Agents: ${agents.length}`);
  const repoAbsPaths = collectWorkspaceRepoPaths(config);
  console.log("\n\u{1F4C2} Collecting files...");
  const allFiles = collectOpenClawFiles(repoAbsPaths);
  console.log(`   \u2705 ${allFiles.length} files collected`);
  if (repoAbsPaths.size > 0) {
    console.log(`   \u23ED\uFE0F  Skipped ${repoAbsPaths.size} git repo(s) in workspaces (will clone on restore)`);
  }
  const envPath = path4.join(OPENCLAW_DIR4, ".env");
  const hasEnv = fs4.existsSync(envPath);
  if (hasEnv && !allFiles.includes(".env")) {
    console.log("   \u2705 .env file included");
  }
  console.log("\n\u{1F419} Detecting workspace repos...");
  const agentEntries = [];
  for (const agent of agents) {
    const workspaceRel = agent.workspace.startsWith(os4.homedir()) ? path4.relative(os4.homedir(), agent.workspace) : agent.workspace;
    let repos = [];
    if (agent.workspace && fs4.existsSync(agent.workspace)) {
      repos = detectWorkspaceRepos(agent.workspace);
    }
    agentEntries.push({
      id: agent.id,
      name: agent.name,
      workspace_path: workspaceRel,
      repos
    });
    if (repos.length > 0) {
      console.log(`   \u{1F4E6} ${agent.name}: ${repos.length} repo(s)`);
      for (const r of repos) {
        console.log(`      \u2022 ${r.name} \u2014 ${r.url}`);
      }
    }
  }
  const manifest = {
    snapshot_version: "1.0",
    packed_at: (/* @__PURE__ */ new Date()).toISOString(),
    hostname: os4.hostname(),
    home_dir: os4.homedir(),
    openclaw_config: openclawConfig,
    agents: agentEntries,
    files: allFiles
  };
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const snapshotName = `openclaw_${date}`;
  const tmpDir = path4.join(os4.tmpdir(), `openclaw-snapshot-${Date.now()}`);
  const stageDir = path4.join(tmpDir, "snapshot");
  if (fs4.existsSync(tmpDir)) {
    fs4.rmSync(tmpDir, { recursive: true });
  }
  fs4.mkdirSync(stageDir, { recursive: true });
  console.log("\n\u{1F4CB} Staging files...");
  for (const f of allFiles) {
    const src = path4.join(OPENCLAW_DIR4, f);
    const dst = path4.join(stageDir, f);
    fs4.mkdirSync(path4.dirname(dst), { recursive: true });
    fs4.copyFileSync(src, dst);
  }
  fs4.writeFileSync(path4.join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  let outputFile;
  if (outputPath) {
    outputFile = path4.resolve(outputPath);
  } else {
    const backupDir = path4.join(OPENCLAW_DIR4, "backups");
    fs4.mkdirSync(backupDir, { recursive: true });
    outputFile = path4.join(backupDir, `${snapshotName}.snapshot`);
  }
  console.log("\u{1F4E6} Creating snapshot archive...");
  execSync4(`tar -czf "${outputFile}" -C "${tmpDir}" snapshot`, {
    encoding: "utf-8"
  });
  fs4.rmSync(tmpDir, { recursive: true });
  const stats = fs4.statSync(outputFile);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log("\n" + "\u2550".repeat(50));
  console.log("\u{1F338} Snapshot packed successfully!");
  console.log("\u2550".repeat(50));
  console.log(`\u{1F4E6} File:     ${outputFile}`);
  console.log(`\u{1F4CF} Size:     ${sizeMB} MB`);
  console.log(`\u{1F916} Agents:   ${agentEntries.length}`);
  console.log(`\u{1F4DD} Files:    ${allFiles.length}`);
  console.log(`\u{1F419} Repos:    ${agentEntries.reduce((n, a) => n + a.repos.length, 0)}`);
  console.log(`\u{1F5A5}\uFE0F  Host:     ${manifest.hostname}`);
  console.log(`\u{1F4C5} Packed:   ${manifest.packed_at}`);
  console.log("\u2550".repeat(50));
  console.log("\n\u26A0\uFE0F  SECURITY WARNING: The snapshot contains credentials,");
  console.log("   API tokens, and config. Treat it like a password file.");
  console.log("   Do NOT commit it to git or share publicly.\n");
}
async function snapshotRestore(snapshotFile, opts) {
  console.log("\n\u{1F338} openclaw-teleport \u2014 restoring instance snapshot...\n");
  if (!fs4.existsSync(snapshotFile)) {
    throw new Error(`\u274C File not found: ${snapshotFile}`);
  }
  if (fs4.existsSync(OPENCLAW_DIR4) && !opts.force) {
    throw new Error(
      `\u274C ${OPENCLAW_DIR4} already exists.
   Use --force to overwrite the existing installation.`
    );
  }
  const tmpDir = path4.join(os4.tmpdir(), `openclaw-snapshot-restore-${Date.now()}`);
  fs4.mkdirSync(tmpDir, { recursive: true });
  console.log("\u{1F4E6} Extracting snapshot...");
  execSync4(`tar -xzf "${path4.resolve(snapshotFile)}" -C "${tmpDir}"`, {
    encoding: "utf-8"
  });
  const stageDir = path4.join(tmpDir, "snapshot");
  const manifestPath = path4.join(stageDir, "manifest.json");
  if (!fs4.existsSync(manifestPath)) {
    fs4.rmSync(tmpDir, { recursive: true });
    throw new Error("\u274C Invalid snapshot file: manifest.json not found");
  }
  const manifest = JSON.parse(fs4.readFileSync(manifestPath, "utf-8"));
  console.log(`\u{1F5A5}\uFE0F  Origin:   ${manifest.hostname}`);
  console.log(`\u{1F4C5} Packed:   ${manifest.packed_at}`);
  console.log(`\u{1F916} Agents:   ${manifest.agents.length}`);
  console.log(`\u{1F4DD} Files:    ${manifest.files.length}`);
  console.log("\n\u{1F4C2} Restoring files...");
  fs4.mkdirSync(OPENCLAW_DIR4, { recursive: true });
  let fileCount = 0;
  for (const f of manifest.files) {
    const src = path4.join(stageDir, f);
    const dst = path4.join(OPENCLAW_DIR4, f);
    if (fs4.existsSync(src)) {
      fs4.mkdirSync(path4.dirname(dst), { recursive: true });
      fs4.copyFileSync(src, dst);
      fileCount++;
    }
  }
  console.log(`   \u2705 ${fileCount} files restored`);
  const oldHome = manifest.home_dir;
  const newHome = os4.homedir();
  if (oldHome !== newHome) {
    console.log(`
\u{1F527} Adjusting paths: ${oldHome} \u2192 ${newHome}`);
    const configPath = path4.join(OPENCLAW_DIR4, "openclaw.json");
    if (fs4.existsSync(configPath)) {
      const raw = JSON.parse(fs4.readFileSync(configPath, "utf-8"));
      const updated = replacePathsInObject(raw, oldHome, newHome);
      fs4.writeFileSync(configPath, JSON.stringify(updated, null, 2));
      console.log("   \u2705 openclaw.json paths updated");
    }
  } else {
    console.log("\n\u{1F527} Same home directory \u2014 no path adjustment needed");
  }
  let totalCloned = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  if (manifest.agents.some((a) => a.repos.length > 0)) {
    console.log("\n\u{1F419} Cloning workspace repos...");
    if (!commandExists("git")) {
      console.log("   \u26A0\uFE0F  git not found \u2014 repos must be cloned manually:");
      for (const agent of manifest.agents) {
        for (const repo of agent.repos) {
          const wsPath = path4.join(newHome, agent.workspace_path);
          console.log(`     git clone ${repo.url} ${path4.join(wsPath, repo.relativePath)}`);
        }
      }
      totalFailed = manifest.agents.reduce((n, a) => n + a.repos.length, 0);
    } else {
      for (const agent of manifest.agents) {
        const wsPath = path4.join(newHome, agent.workspace_path);
        for (const repo of agent.repos) {
          const targetDir = path4.join(wsPath, repo.relativePath);
          if (fs4.existsSync(targetDir)) {
            console.log(`   \u23ED\uFE0F  ${repo.name} (already exists)`);
            totalSkipped++;
            continue;
          }
          try {
            fs4.mkdirSync(path4.dirname(targetDir), { recursive: true });
            console.log(`   \u{1F4E5} Cloning ${repo.name} \u2192 ${repo.relativePath}...`);
            execSync4(`git clone "${repo.url}" "${targetDir}"`, {
              encoding: "utf-8",
              timeout: 12e4,
              stdio: "pipe"
            });
            console.log(`   \u2705 ${repo.name}`);
            totalCloned++;
          } catch {
            console.log(`   \u26A0\uFE0F  Failed to clone ${repo.name} (${repo.url})`);
            totalFailed++;
          }
        }
      }
    }
  }
  fs4.rmSync(tmpDir, { recursive: true });
  let gatewayStarted = false;
  if (commandExists("openclaw")) {
    console.log("\n\u{1F680} Starting OpenClaw Gateway...");
    try {
      execSync4("openclaw gateway start", {
        encoding: "utf-8",
        timeout: 3e4,
        stdio: "pipe"
      });
      console.log("   \u2705 Gateway started");
      gatewayStarted = true;
    } catch {
      console.log("   \u26A0\uFE0F  Failed to start gateway");
      console.log("      Try manually: openclaw gateway start");
    }
  }
  const totalRepos = manifest.agents.reduce((n, a) => n + a.repos.length, 0);
  console.log("\n" + "\u2550".repeat(50));
  console.log("\u{1F338} Snapshot Restoration Summary");
  console.log("\u2550".repeat(50));
  console.log(`\u{1F4C2} Target:    ${OPENCLAW_DIR4}`);
  console.log(`\u{1F4DD} Files:     ${fileCount} restored`);
  console.log(`\u{1F916} Agents:    ${manifest.agents.length}`);
  if (totalRepos > 0) {
    console.log(`\u{1F419} Repos:     ${totalCloned} cloned, ${totalSkipped} skipped, ${totalFailed} failed`);
  }
  console.log(`\u{1F527} Paths:     ${oldHome !== newHome ? "adjusted" : "unchanged"}`);
  console.log(`\u{1F680} Gateway:   ${gatewayStarted ? "\u2705 running" : "\u26A0\uFE0F  not started"}`);
  console.log("\u2550".repeat(50));
  console.log("Instance restored successfully \u{1F338}");
  console.log("\u2550".repeat(50) + "\n");
}
async function snapshotInspect(snapshotFile) {
  if (!fs4.existsSync(snapshotFile)) {
    throw new Error(`\u274C File not found: ${snapshotFile}`);
  }
  const tmpDir = path4.join(os4.tmpdir(), `openclaw-snapshot-inspect-${Date.now()}`);
  fs4.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync4(`tar -xzf "${path4.resolve(snapshotFile)}" -C "${tmpDir}" snapshot/manifest.json`, {
      encoding: "utf-8"
    });
    const manifestPath = path4.join(tmpDir, "snapshot", "manifest.json");
    if (!fs4.existsSync(manifestPath)) {
      throw new Error("\u274C Invalid snapshot file: manifest.json not found");
    }
    const manifest = JSON.parse(fs4.readFileSync(manifestPath, "utf-8"));
    const stats = fs4.statSync(path4.resolve(snapshotFile));
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    const totalRepos = manifest.agents.reduce((n, a) => n + a.repos.length, 0);
    console.log("\n" + "\u2550".repeat(50));
    console.log("\u{1F338} Snapshot Inspection");
    console.log("\u2550".repeat(50));
    console.log(`\u{1F5A5}\uFE0F  Hostname: ${manifest.hostname}`);
    console.log(`\u{1F4C5} Packed:   ${manifest.packed_at}`);
    console.log(`\u{1F4CF} Size:     ${sizeMB} MB`);
    console.log(`\u{1F916} Agents:   ${manifest.agents.length}`);
    console.log(`\u{1F4DD} Files:    ${manifest.files.length}`);
    console.log(`\u{1F419} Repos:    ${totalRepos}`);
    if (manifest.agents.length > 0) {
      console.log(`
\u{1F916} Agents:`);
      for (const agent of manifest.agents) {
        console.log(`   \u2022 ${agent.name} (${agent.id})`);
        console.log(`     Workspace: ~/${agent.workspace_path}`);
        if (agent.repos.length > 0) {
          for (const repo of agent.repos) {
            console.log(`     \u{1F419} ${repo.name} \u2014 ${repo.url}`);
          }
        }
      }
    }
    const byTopDir = {};
    for (const f of manifest.files) {
      const topDir = f.includes("/") ? f.split("/")[0] : "(root)";
      byTopDir[topDir] = (byTopDir[topDir] ?? 0) + 1;
    }
    console.log("\n\u{1F4CA} Contents breakdown:");
    for (const [dir, count] of Object.entries(byTopDir).sort((a, b) => b[1] - a[1])) {
      console.log(`   \u{1F4C2} ${dir}: ${count} files`);
    }
    console.log("\u2550".repeat(50) + "\n");
  } finally {
    fs4.rmSync(tmpDir, { recursive: true });
  }
}

// src/cli.ts
var program = new Command();
program.name("openclaw-teleport").description("\u{1F338} Agent soul migration \u2014 pack your identity, memory, and tools into one file").version("0.5.0");
program.command("pack").description("Pack an agent into a .soul archive").argument("[agent-id]", "Agent ID to pack (defaults to first configured agent)").option("-o, --output <path>", "Output file path (default: ./{agent}_{date}.soul)").action(async (agentId, opts) => {
  try {
    await pack(agentId, opts.output);
  } catch (err) {
    console.error(`
${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }
});
program.command("unpack").description("Unpack a .soul archive and restore the agent").argument("<file>", "Path to .soul file").option("-w, --workspace <path>", "Target workspace directory").action(async (file, opts) => {
  try {
    await unpack(file, opts.workspace);
  } catch (err) {
    console.error(`
${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }
});
program.command("inspect").description("Inspect a .soul archive without unpacking").argument("<file>", "Path to .soul file").action(async (file) => {
  try {
    await inspect(file);
  } catch (err) {
    console.error(`
${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }
});
var snapshot = program.command("snapshot").description("Snapshot the entire OpenClaw instance (~/.openclaw/)");
snapshot.command("pack").description("Pack the entire ~/.openclaw/ directory into a .snapshot archive").option("-o, --output <path>", "Output file path (default: ./openclaw_YYYYMMDD.snapshot)").action(async (opts) => {
  try {
    await snapshotPack(opts.output);
  } catch (err) {
    console.error(`
${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }
});
snapshot.command("restore").description("Restore an OpenClaw instance from a .snapshot archive").argument("<file>", "Path to .snapshot file").option("--force", "Overwrite existing ~/.openclaw/ directory").action(async (file, opts) => {
  try {
    await snapshotRestore(file, { force: opts.force });
  } catch (err) {
    console.error(`
${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }
});
snapshot.command("inspect").description("Inspect a .snapshot archive without restoring").argument("<file>", "Path to .snapshot file").action(async (file) => {
  try {
    await snapshotInspect(file);
  } catch (err) {
    console.error(`
${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  }
});
program.parse();
