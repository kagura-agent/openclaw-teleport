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
function getGitHubRepos(owner) {
  try {
    const output = execSync(`gh repo list ${owner} --json name,url,isFork --limit 100`, {
      encoding: "utf-8",
      timeout: 3e4
    });
    return JSON.parse(output);
  } catch (err) {
    console.log("\u26A0\uFE0F  Could not fetch GitHub repos (gh CLI not available or not authenticated)");
    return [];
  }
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
function installGh() {
  try {
    const platform2 = os.platform();
    if (platform2 === "linux") {
      execSync(
        '(type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) && sudo mkdir -p -m 755 /etc/apt/keyrings && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt update && sudo apt install gh -y',
        { stdio: "pipe", timeout: 12e4 }
      );
    } else if (platform2 === "darwin") {
      execSync("brew install gh", { stdio: "pipe", timeout: 12e4 });
    } else {
      return false;
    }
    return commandExists("gh");
  } catch {
    return false;
  }
}
function isGhAuthenticated() {
  try {
    execSync("gh auth status", { encoding: "utf-8", stdio: "pipe" });
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
  console.log("\u23F0 Extracting cron job definitions...");
  const cronJobs = loadCronJobs(agent.id);
  console.log(`   \u2705 ${cronJobs.length} cron jobs for ${agent.id}`);
  console.log("\u{1F419} Fetching GitHub repos...");
  const repos = getGitHubRepos("kagura-agent");
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
  const manifest = {
    agent_id: agent.id,
    agent_name: agent.name,
    packed_at: (/* @__PURE__ */ new Date()).toISOString(),
    files: allFiles,
    github_repos: repos,
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
  return files.length;
}
function cloneGitHubRepos(manifest, targetWorkspace) {
  const result = { cloned: 0, skipped: 0, failed: 0 };
  if (!manifest.github_repos || manifest.github_repos.length === 0) {
    return result;
  }
  console.log("\n\u{1F419} Cloning GitHub repos...");
  if (!commandExists("gh")) {
    console.log("   \u2B07\uFE0F  GitHub CLI (gh) not found, installing...");
    const installed = installGh();
    if (!installed) {
      console.log("   \u26A0\uFE0F  Could not auto-install GitHub CLI");
      console.log("   Install manually: https://cli.github.com/");
      console.log(`   Repos to clone manually (${manifest.github_repos.length}):`);
      for (const repo of manifest.github_repos) {
        console.log(`     git clone ${repo.url}`);
      }
      result.failed = manifest.github_repos.length;
      return result;
    }
    console.log("   \u2705 GitHub CLI installed");
  }
  if (!isGhAuthenticated()) {
    console.log("   \u26A0\uFE0F  GitHub CLI not authenticated");
    console.log("");
    console.log("   \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
    console.log("   \u2502  Please run:  gh auth login                  \u2502");
    console.log("   \u2502                                              \u2502");
    console.log("   \u2502  Then re-run unpack, or clone manually:      \u2502");
    console.log("   \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
    console.log("");
    for (const repo of manifest.github_repos) {
      const fork = repo.isFork ? " (fork)" : "";
      console.log(`   \u2022 ${repo.name}${fork}: ${repo.url}`);
    }
    result.failed = manifest.github_repos.length;
    return result;
  }
  for (const repo of manifest.github_repos) {
    const targetDir = repo.isFork ? path3.join(targetWorkspace, "forks", repo.name) : path3.join(targetWorkspace, repo.name);
    if (fs3.existsSync(targetDir)) {
      console.log(`   \u23ED\uFE0F  ${repo.name} (already exists)`);
      result.skipped++;
      continue;
    }
    try {
      fs3.mkdirSync(path3.dirname(targetDir), { recursive: true });
      console.log(`   \u{1F4E5} Cloning ${repo.name}${repo.isFork ? " (fork)" : ""}...`);
      execSync3(`gh repo clone "${repo.url}" "${targetDir}"`, {
        encoding: "utf-8",
        timeout: 12e4,
        stdio: "pipe"
      });
      console.log(`   \u2705 ${repo.name}`);
      result.cloned++;
    } catch {
      console.log(`   \u26A0\uFE0F  Failed to clone ${repo.name}`);
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
  const repoResult = cloneGitHubRepos(manifest, targetWorkspace);
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
\u{1F419} GitHub Repos (${manifest.github_repos.length}):`);
      for (const repo of manifest.github_repos) {
        const fork = repo.isFork ? " (fork)" : "";
        console.log(`   \u2022 ${repo.name}${fork}`);
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

// src/cli.ts
var program = new Command();
program.name("openclaw-teleport").description("\u{1F338} Agent soul migration \u2014 pack your identity, memory, and tools into one file").version("0.2.0");
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
program.parse();
