import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { loadConfig, commandExists, isGhAuthenticated, type Manifest, type OpenClawConfig, type CronJob } from './utils.js';

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_PATH = path.join(OPENCLAW_DIR, 'openclaw.json');
const CRON_DIR = path.join(OPENCLAW_DIR, 'cron');

function extractManifest(soulFile: string): { tmpDir: string; manifest: Manifest } {
  const tmpDir = path.join(os.tmpdir(), `soul-unpack-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  execSync(`tar -xzf "${path.resolve(soulFile)}" -C "${tmpDir}"`, { encoding: 'utf-8' });

  const manifestPath = path.join(tmpDir, 'soul', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fs.rmSync(tmpDir, { recursive: true });
    throw new Error('❌ Invalid .soul file: manifest.json not found');
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return { tmpDir, manifest };
}

// ── Step 1: Install OpenClaw ───────────────────────────────────────

function ensureOpenClaw(): boolean {
  console.log('🔧 Checking OpenClaw installation...');

  if (commandExists('openclaw')) {
    try {
      const version = execSync('openclaw --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      console.log(`   ✅ OpenClaw found (${version})`);
    } catch {
      console.log('   ✅ OpenClaw found');
    }
    return true;
  }

  console.log('   ⬇️  OpenClaw not found, installing...');
  try {
    execSync('npm install -g openclaw', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120000,
    });

    // Verify installation
    if (commandExists('openclaw')) {
      console.log('   ✅ OpenClaw installed successfully');
      return true;
    } else {
      console.log('   ⚠️  Installation completed but openclaw command not found in PATH');
      console.log('      Try: npm install -g openclaw');
      return false;
    }
  } catch (err) {
    console.log('   ⚠️  Failed to install OpenClaw automatically');
    console.log('      Run manually: npm install -g openclaw');
    return false;
  }
}

// ── Step 2: Write full config ──────────────────────────────────────

function writeAgentConfig(
  manifest: Manifest,
  stageDir: string,
  targetWorkspace: string
): void {
  console.log('⚙️  Writing agent configuration...');

  fs.mkdirSync(OPENCLAW_DIR, { recursive: true });

  const agentConfigPath = path.join(stageDir, 'config', 'agent-config.json');
  if (!fs.existsSync(agentConfigPath)) {
    console.log('   ⚠️  No agent config in archive, skipping');
    return;
  }

  const agentConfig = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));

  // Build the new agent entry with dynamic paths
  const agentDir = path.join(OPENCLAW_DIR, 'agents', manifest.agent_id, 'agent');
  const savedAgent = agentConfig.agent ?? {};
  // Remove old paths from saved config before merging
  delete savedAgent.workspace;
  delete savedAgent.agentDir;
  const newAgent = {
    id: manifest.agent_id,
    name: manifest.agent_name,
    ...savedAgent,
    // Set paths dynamically for the new machine
    workspace: targetWorkspace,
    agentDir: agentDir,
  };

  if (fs.existsSync(CONFIG_PATH)) {
    // Merge into existing config
    const existingConfig: OpenClawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

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
      console.log('   ✅ Agent config updated (merged into existing)');
    } else {
      existingConfig.agents.list.push(newAgent);
      console.log('   ✅ Agent config added to existing openclaw.json');
    }

    // Merge agent defaults if present in manifest
    if (manifest.agent_defaults && Object.keys(manifest.agent_defaults).length > 0) {
      if (!existingConfig.agents.defaults) {
        existingConfig.agents.defaults = {};
      }
      // Merge defaults, setting workspace dynamically
      existingConfig.agents.defaults = {
        ...existingConfig.agents.defaults,
        ...manifest.agent_defaults,
        workspace: targetWorkspace,
      };
      console.log('   ✅ Agent defaults merged');
    }

    // Merge channels config if present
    if (manifest.channels && Object.keys(manifest.channels).length > 0) {
      if (!existingConfig.channels) {
        existingConfig.channels = {};
      }
      for (const [key, val] of Object.entries(manifest.channels)) {
        if (!(key in existingConfig.channels)) {
          (existingConfig.channels as Record<string, unknown>)[key] = val;
          console.log(`   ✅ Channel '${key}' config added`);
        } else {
          console.log(`   ⏭️  Channel '${key}' already exists, skipping`);
        }
      }
    }

    // Merge models config if not present
    if (manifest.models_config && Object.keys(manifest.models_config).length > 0) {
      if (!existingConfig.models) {
        existingConfig.models = manifest.models_config;
        console.log('   ✅ Models config restored');
      } else {
        console.log('   ⏭️  Models config already exists, skipping');
      }
    }

    // Merge bindings
    if (manifest.bindings && manifest.bindings.length > 0) {
      if (!existingConfig.bindings || (existingConfig.bindings as unknown[]).length === 0) {
        existingConfig.bindings = manifest.bindings;
        console.log('   ✅ Bindings restored');
      } else {
        console.log('   ⏭️  Bindings already exist, skipping');
      }
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));
  } else {
    // Create new config from scratch
    const newConfig: OpenClawConfig = {
      agents: {
        defaults: {
          ...(manifest.agent_defaults ?? {}),
          workspace: targetWorkspace,
        },
        list: [newAgent],
      },
    };

    // Add channels
    if (manifest.channels && Object.keys(manifest.channels).length > 0) {
      newConfig.channels = manifest.channels;
      console.log('   ✅ Channel configs restored');
    }

    // Add models
    if (manifest.models_config && Object.keys(manifest.models_config).length > 0) {
      newConfig.models = manifest.models_config;
      console.log('   ✅ Models config restored');
    }

    // Add bindings
    if (manifest.bindings && manifest.bindings.length > 0) {
      newConfig.bindings = manifest.bindings;
      console.log('   ✅ Bindings restored');
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
    console.log('   ✅ New openclaw.json created');
  }

  // Ensure agent directory exists
  fs.mkdirSync(agentDir, { recursive: true });
}

// ── Step 3: Restore cron jobs ──────────────────────────────────────

function restoreCronJobs(manifest: Manifest, stageDir: string): number {
  console.log('⏰ Restoring cron jobs...');

  // Restore cron files from archive
  const cronDir = path.join(stageDir, 'cron');
  let cronFileCount = 0;
  if (fs.existsSync(cronDir)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
    const files = fs.readdirSync(cronDir);
    for (const f of files) {
      fs.copyFileSync(path.join(cronDir, f), path.join(CRON_DIR, f));
      cronFileCount++;
    }
  }

  // If manifest has full cron_jobs content, merge them into jobs.json
  if (manifest.cron_jobs && manifest.cron_jobs.length > 0) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
    const jobsPath = path.join(CRON_DIR, 'jobs.json');

    let existingJobs: CronJob[] = [];
    if (fs.existsSync(jobsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'));
        existingJobs = data.jobs ?? [];
      } catch {
        existingJobs = [];
      }
    }

    // Merge: replace jobs with same ID, add new ones
    for (const job of manifest.cron_jobs) {
      const idx = existingJobs.findIndex((j) => j.id === job.id);
      if (idx >= 0) {
        existingJobs[idx] = job;
      } else {
        existingJobs.push(job);
      }
    }

    fs.writeFileSync(jobsPath, JSON.stringify({ version: 1, jobs: existingJobs }, null, 2));
    console.log(`   ✅ ${manifest.cron_jobs.length} cron job(s) restored`);
  } else if (cronFileCount > 0) {
    console.log(`   ✅ ${cronFileCount} cron file(s) restored`);
  } else {
    console.log('   (none)');
  }

  return manifest.cron_jobs?.length ?? cronFileCount;
}

// ── Step 4 & 5: GitHub auth + clone repos ──────────────────────────

function cloneGitHubRepos(manifest: Manifest, targetWorkspace: string): { cloned: number; skipped: number; failed: number } {
  const result = { cloned: 0, skipped: 0, failed: 0 };

  if (!manifest.github_repos || manifest.github_repos.length === 0) {
    return result;
  }

  console.log('\n🐙 Cloning GitHub repos...');

  // Check if gh CLI is available
  if (!commandExists('gh')) {
    console.log('   ⚠️  GitHub CLI (gh) not installed');
    console.log('   Install it: https://cli.github.com/');
    console.log('   Then run: gh auth login');
    console.log(`   Repos to clone manually (${manifest.github_repos.length}):`);
    for (const repo of manifest.github_repos) {
      console.log(`     git clone ${repo.url}`);
    }
    result.failed = manifest.github_repos.length;
    return result;
  }

  // Check GitHub auth
  if (!isGhAuthenticated()) {
    console.log('   ⚠️  GitHub CLI not authenticated');
    console.log('');
    console.log('   ┌──────────────────────────────────────────────┐');
    console.log('   │  Please run:  gh auth login                  │');
    console.log('   │                                              │');
    console.log('   │  Then re-run unpack, or clone manually:      │');
    console.log('   └──────────────────────────────────────────────┘');
    console.log('');
    for (const repo of manifest.github_repos) {
      const fork = repo.isFork ? ' (fork)' : '';
      console.log(`   • ${repo.name}${fork}: ${repo.url}`);
    }
    result.failed = manifest.github_repos.length;
    return result;
  }

  // Clone repos
  for (const repo of manifest.github_repos) {
    // Forks go to workspace/forks/, others go directly to workspace/
    const targetDir = repo.isFork
      ? path.join(targetWorkspace, 'forks', repo.name)
      : path.join(targetWorkspace, repo.name);

    if (fs.existsSync(targetDir)) {
      console.log(`   ⏭️  ${repo.name} (already exists)`);
      result.skipped++;
      continue;
    }

    try {
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      console.log(`   📥 Cloning ${repo.name}${repo.isFork ? ' (fork)' : ''}...`);
      execSync(`gh repo clone "${repo.url}" "${targetDir}"`, {
        encoding: 'utf-8',
        timeout: 120000,
        stdio: 'pipe',
      });
      console.log(`   ✅ ${repo.name}`);
      result.cloned++;
    } catch {
      console.log(`   ⚠️  Failed to clone ${repo.name}`);
      result.failed++;
    }
  }

  return result;
}

// ── Step 6: Start Gateway ──────────────────────────────────────────

function startGateway(): boolean {
  console.log('\n🚀 Starting OpenClaw Gateway...');

  if (!commandExists('openclaw')) {
    console.log('   ⚠️  openclaw command not found, skipping gateway start');
    return false;
  }

  try {
    const output = execSync('openclaw gateway start', {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: 'pipe',
    });
    console.log('   ✅ Gateway started');
    if (output.trim()) {
      // Show first few lines of output
      const lines = output.trim().split('\n').slice(0, 3);
      for (const line of lines) {
        console.log(`      ${line}`);
      }
    }
    return true;
  } catch (err) {
    console.log('   ⚠️  Failed to start gateway');
    if (err instanceof Error && 'stderr' in err) {
      const stderr = (err as { stderr: string }).stderr?.trim();
      if (stderr) {
        console.log(`      ${stderr.split('\n')[0]}`);
      }
    }
    console.log('      Try manually: openclaw gateway start');
    return false;
  }
}

// ── Main unpack ────────────────────────────────────────────────────

export async function unpack(soulFile: string, workspacePath?: string): Promise<void> {
  console.log('\n🌸 openclaw-teleport — unpacking agent soul...\n');

  if (!fs.existsSync(soulFile)) {
    throw new Error(`❌ File not found: ${soulFile}`);
  }

  const { tmpDir, manifest } = extractManifest(soulFile);
  const stageDir = path.join(tmpDir, 'soul');

  console.log(`🆔 Agent: ${manifest.agent_name} (${manifest.agent_id})`);
  console.log(`📅 Packed: ${manifest.packed_at}`);
  console.log(`📝 Files: ${manifest.files.length}`);
  console.log('');

  // ── Step 1: Ensure OpenClaw is installed ─────────────────────────
  const openclawInstalled = ensureOpenClaw();

  // Determine workspace
  const targetWorkspace = workspacePath
    ? path.resolve(workspacePath)
    : path.join(OPENCLAW_DIR, 'workspace');

  fs.mkdirSync(targetWorkspace, { recursive: true });

  // ── Step 2: Restore identity files ───────────────────────────────
  console.log('\n📝 Restoring identity files...');
  let identityCount = 0;
  const identityDir = path.join(stageDir, 'identity');
  if (fs.existsSync(identityDir)) {
    const files = fs.readdirSync(identityDir);
    for (const f of files) {
      const src = path.join(identityDir, f);
      const dst = path.join(targetWorkspace, f);
      fs.copyFileSync(src, dst);
      console.log(`   ✅ ${f}`);
      identityCount++;
    }
  }

  // ── Step 3: Restore memory ──────────────────────────────────────
  console.log('🧠 Restoring memory...');
  let memoryCount = 0;
  const memoryDir = path.join(stageDir, 'memory');
  if (fs.existsSync(memoryDir)) {
    const copyRecursive = (src: string, dst: string) => {
      fs.mkdirSync(dst, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, dstPath);
        } else {
          fs.copyFileSync(srcPath, dstPath);
          memoryCount++;
        }
      }
    };
    copyRecursive(memoryDir, path.join(targetWorkspace, 'memory'));
    console.log(`   ✅ ${memoryCount} memory files restored`);
  }

  // ── Step 4: Restore tool data ───────────────────────────────────
  console.log('🗄️  Restoring tool data...');
  let dataCount = 0;
  const dataDir = path.join(stageDir, 'data');
  if (fs.existsSync(dataDir)) {
    const copyRecursive = (src: string, dst: string) => {
      fs.mkdirSync(dst, { recursive: true });
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, dstPath);
        } else {
          fs.copyFileSync(srcPath, dstPath);
          console.log(`   ✅ ${entry.name}`);
          dataCount++;
        }
      }
    };
    copyRecursive(dataDir, targetWorkspace);
  }

  // ── Step 5: Write full agent config (with channels, credentials) ─
  writeAgentConfig(manifest, stageDir, targetWorkspace);

  // ── Step 6: Restore cron jobs ───────────────────────────────────
  const cronCount = restoreCronJobs(manifest, stageDir);

  // ── Step 7: Clone GitHub repos ──────────────────────────────────
  const repoResult = cloneGitHubRepos(manifest, targetWorkspace);

  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true });

  // ── Step 8: Start Gateway ───────────────────────────────────────
  let gatewayStarted = false;
  if (openclawInstalled) {
    gatewayStarted = startGateway();
  }

  // ── Step 9: Welcome summary ─────────────────────────────────────
  const configuredServices: string[] = [];
  if (manifest.channels) {
    for (const [key, val] of Object.entries(manifest.channels)) {
      if (val && typeof val === 'object' && (val as Record<string, unknown>).enabled !== false) {
        configuredServices.push(key);
      }
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log('🌸 Restoration Summary');
  console.log('═'.repeat(50));
  console.log(`🆔 Agent:      ${manifest.agent_name} (${manifest.agent_id})`);
  console.log(`📂 Workspace:  ${targetWorkspace}`);
  console.log(`📝 Files:      ${identityCount} identity + ${memoryCount} memory + ${dataCount} data`);
  console.log(`⏰ Cron:       ${cronCount} job(s)`);

  if (manifest.github_repos && manifest.github_repos.length > 0) {
    console.log(`🐙 Repos:      ${repoResult.cloned} cloned, ${repoResult.skipped} skipped, ${repoResult.failed} failed`);
  }

  if (configuredServices.length > 0) {
    console.log(`🔗 Services:   ${configuredServices.join(', ')}`);
  }

  console.log(`🔧 OpenClaw:   ${openclawInstalled ? '✅' : '⚠️  needs install'}`);
  console.log(`🚀 Gateway:    ${gatewayStarted ? '✅ running' : '⚠️  not started'}`);

  // Services that may need attention
  if (manifest.services_to_rebind && manifest.services_to_rebind.length > 0) {
    const needsRebind = manifest.services_to_rebind.filter(
      (s) => !configuredServices.includes(s)
    );
    if (needsRebind.length > 0) {
      console.log('\n🔗 Services that may need attention:');
      for (const svc of needsRebind) {
        console.log(`   ☐ ${svc}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`Welcome back, ${manifest.agent_name} 🌸`);
  console.log('═'.repeat(50) + '\n');
}

// ── Inspect ────────────────────────────────────────────────────────

export async function inspect(soulFile: string): Promise<void> {
  if (!fs.existsSync(soulFile)) {
    throw new Error(`❌ File not found: ${soulFile}`);
  }

  // Extract just the manifest without full unpack
  const tmpDir = path.join(os.tmpdir(), `soul-inspect-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Extract only manifest.json
    execSync(`tar -xzf "${path.resolve(soulFile)}" -C "${tmpDir}" soul/manifest.json`, {
      encoding: 'utf-8',
    });

    const manifestPath = path.join(tmpDir, 'soul', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('❌ Invalid .soul file: manifest.json not found');
    }

    const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const stats = fs.statSync(path.resolve(soulFile));
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log('\n' + '═'.repeat(50));
    console.log('🌸 Soul Archive Inspection');
    console.log('═'.repeat(50));
    console.log(`🆔 Agent:    ${manifest.agent_name} (${manifest.agent_id})`);
    console.log(`📅 Packed:   ${manifest.packed_at}`);
    console.log(`📏 Size:     ${sizeMB} MB`);
    console.log(`📝 Files:    ${manifest.files.length}`);

    if (manifest.github_repos.length > 0) {
      console.log(`\n🐙 GitHub Repos (${manifest.github_repos.length}):`);
      for (const repo of manifest.github_repos) {
        const fork = repo.isFork ? ' (fork)' : '';
        console.log(`   • ${repo.name}${fork}`);
        console.log(`     ${repo.url}`);
      }
    }

    if (manifest.channels && Object.keys(manifest.channels).length > 0) {
      console.log(`\n🔑 Channels (${Object.keys(manifest.channels).length}):`);
      for (const key of Object.keys(manifest.channels)) {
        console.log(`   • ${key}`);
      }
    }

    if (manifest.cron_jobs && manifest.cron_jobs.length > 0) {
      console.log(`\n⏰ Cron Jobs (${manifest.cron_jobs.length}):`);
      for (const job of manifest.cron_jobs) {
        const status = job.enabled ? '🟢' : '🔴';
        console.log(`   ${status} ${job.name}`);
      }
    }

    if (manifest.services_to_rebind.length > 0) {
      console.log(`\n🔗 Services to rebind:`);
      for (const svc of manifest.services_to_rebind) {
        console.log(`   • ${svc}`);
      }
    }

    // Show file breakdown
    const identityFiles = manifest.files.filter((f) => f.startsWith('identity/'));
    const memoryFiles = manifest.files.filter((f) => f.startsWith('memory/'));
    const dataFiles = manifest.files.filter((f) => f.startsWith('data/'));
    const cronFiles = manifest.files.filter((f) => f.startsWith('cron/'));
    const configFiles = manifest.files.filter((f) => f.startsWith('config/'));

    console.log('\n📊 Contents breakdown:');
    if (identityFiles.length > 0) console.log(`   📝 Identity: ${identityFiles.length} files`);
    if (memoryFiles.length > 0) console.log(`   🧠 Memory:   ${memoryFiles.length} files`);
    if (dataFiles.length > 0) console.log(`   🗄️  Data:     ${dataFiles.length} files`);
    if (cronFiles.length > 0) console.log(`   ⏰ Cron:     ${cronFiles.length} files`);
    if (configFiles.length > 0) console.log(`   ⚙️  Config:   ${configFiles.length} files`);

    console.log('═'.repeat(50) + '\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}
