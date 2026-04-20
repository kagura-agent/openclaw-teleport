import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  loadConfig,
  detectWorkspaceRepos,
  commandExists,
  type OpenClawConfig,
} from './utils.js';

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');

// ── Types ──────────────────────────────────────────────────────────

interface SnapshotAgentEntry {
  id: string;
  name: string;
  workspace_path: string; // relative to homedir
  repos: Array<{ name: string; url: string; relativePath: string }>;
}

interface SnapshotManifest {
  snapshot_version: string;
  packed_at: string;
  hostname: string;
  home_dir: string;
  openclaw_config: OpenClawConfig;
  agents: SnapshotAgentEntry[];
  files: string[]; // relative to ~/.openclaw/
}

// ── Directories to skip during collection ──────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '__pycache__', 'backups']);
const SKIP_PREFIXES = ['.venv'];

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Check whether a directory is the root of its own git repository.
 */
function isGitRepo(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, '.git'));
}

/**
 * Build a set of absolute paths for workspace directories that contain
 * git repos, so we can skip them during the full ~/.openclaw/ walk.
 */
function collectWorkspaceRepoPaths(config: OpenClawConfig): Set<string> {
  const repoPaths = new Set<string>();
  const agents = config.agents?.list ?? [];
  for (const agent of agents) {
    if (!agent.workspace || !fs.existsSync(agent.workspace)) continue;
    try {
      const entries = fs.readdirSync(agent.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(agent.workspace, entry.name);
        if (isGitRepo(fullPath)) {
          repoPaths.add(fullPath);
        }
      }
    } catch {
      // permission error, broken symlink, etc.
    }
  }
  return repoPaths;
}

/**
 * Recursively collect all files under ~/.openclaw/, excluding SKIP_DIRS
 * and git repo subdirectories inside agent workspaces.
 * Returns paths relative to OPENCLAW_DIR.
 */
function collectOpenClawFiles(repoAbsPaths: Set<string>): string[] {
  const files: string[] = [];

  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PREFIXES.some(p => entry.name.startsWith(p))) continue;

      const fullPath = path.join(dir, entry.name);
      const rel = prefix ? path.join(prefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Skip git repo subdirectories inside workspaces
        if (repoAbsPaths.has(fullPath)) continue;
        walk(fullPath, rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };

  walk(OPENCLAW_DIR, '');
  return files;
}

/**
 * Recursively replace all occurrences of `oldStr` with `newStr` in
 * every string value of an object/array. Returns a new object.
 */
function replacePathsInObject(obj: unknown, oldStr: string, newStr: string): unknown {
  if (typeof obj === 'string') {
    return obj.split(oldStr).join(newStr);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => replacePathsInObject(item, oldStr, newStr));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = replacePathsInObject(val, oldStr, newStr);
    }
    return result;
  }
  return obj;
}

// ── snapshotPack ──────────────────────────────────────────────────

export async function snapshotPack(outputPath?: string): Promise<void> {
  console.log('\n🌸 openclaw-teleport — packing full instance snapshot...\n');

  // 1. Load config
  const config = loadConfig();
  const configRaw = fs.readFileSync(path.join(OPENCLAW_DIR, 'openclaw.json'), 'utf-8');
  const openclawConfig: OpenClawConfig = JSON.parse(configRaw);

  const agents = config.agents?.list ?? [];
  console.log(`📦 OpenClaw instance: ${OPENCLAW_DIR}`);
  console.log(`🤖 Agents: ${agents.length}`);

  // 2. Build set of workspace git repo paths to skip
  const repoAbsPaths = collectWorkspaceRepoPaths(config);

  // 3. Collect all files under ~/.openclaw/
  console.log('\n📂 Collecting files...');
  const allFiles = collectOpenClawFiles(repoAbsPaths);
  console.log(`   ✅ ${allFiles.length} files collected`);

  if (repoAbsPaths.size > 0) {
    console.log(`   ⏭️  Skipped ${repoAbsPaths.size} git repo(s) in workspaces (will clone on restore)`);
  }

  // 4. Collect .env
  const envPath = path.join(OPENCLAW_DIR, '.env');
  const hasEnv = fs.existsSync(envPath);
  if (hasEnv && !allFiles.includes('.env')) {
    // Already collected by the walk, but double-check
    console.log('   ✅ .env file included');
  }

  // 5. Build agent entries with repos
  console.log('\n🐙 Detecting workspace repos...');
  const agentEntries: SnapshotAgentEntry[] = [];
  for (const agent of agents) {
    const workspaceRel = agent.workspace.startsWith(os.homedir())
      ? path.relative(os.homedir(), agent.workspace)
      : agent.workspace;

    let repos: Array<{ name: string; url: string; relativePath: string }> = [];
    if (agent.workspace && fs.existsSync(agent.workspace)) {
      repos = detectWorkspaceRepos(agent.workspace);
    }

    agentEntries.push({
      id: agent.id,
      name: agent.name,
      workspace_path: workspaceRel,
      repos,
    });

    if (repos.length > 0) {
      console.log(`   📦 ${agent.name}: ${repos.length} repo(s)`);
      for (const r of repos) {
        console.log(`      • ${r.name} — ${r.url}`);
      }
    }
  }

  // 6. Generate manifest
  const manifest: SnapshotManifest = {
    snapshot_version: '1.0',
    packed_at: new Date().toISOString(),
    hostname: os.hostname(),
    home_dir: os.homedir(),
    openclaw_config: openclawConfig,
    agents: agentEntries,
    files: allFiles,
  };

  // 7. Stage all files into a temp dir
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const snapshotName = `openclaw_${date}`;
  const tmpDir = path.join(os.tmpdir(), `openclaw-snapshot-${Date.now()}`);
  const stageDir = path.join(tmpDir, 'snapshot');

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });

  console.log('\n📋 Staging files...');
  for (const f of allFiles) {
    const src = path.join(OPENCLAW_DIR, f);
    const dst = path.join(stageDir, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  // Write manifest
  fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 8. Create tarball
  let outputFile: string;
  if (outputPath) {
    outputFile = path.resolve(outputPath);
  } else {
    const backupDir = path.join(OPENCLAW_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    outputFile = path.join(backupDir, `${snapshotName}.snapshot`);
  }
  console.log('📦 Creating snapshot archive...');

  execSync(`tar -czf "${outputFile}" -C "${tmpDir}" snapshot`, {
    encoding: 'utf-8',
  });

  // Clean up staging
  fs.rmSync(tmpDir, { recursive: true });

  // Summary
  const stats = fs.statSync(outputFile);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log('\n' + '═'.repeat(50));
  console.log('🌸 Snapshot packed successfully!');
  console.log('═'.repeat(50));
  console.log(`📦 File:     ${outputFile}`);
  console.log(`📏 Size:     ${sizeMB} MB`);
  console.log(`🤖 Agents:   ${agentEntries.length}`);
  console.log(`📝 Files:    ${allFiles.length}`);
  console.log(`🐙 Repos:    ${agentEntries.reduce((n, a) => n + a.repos.length, 0)}`);
  console.log(`🖥️  Host:     ${manifest.hostname}`);
  console.log(`📅 Packed:   ${manifest.packed_at}`);
  console.log('═'.repeat(50));

  console.log('\n⚠️  SECURITY WARNING: The snapshot contains credentials,');
  console.log('   API tokens, and config. Treat it like a password file.');
  console.log('   Do NOT commit it to git or share publicly.\n');
}

// ── snapshotRestore ───────────────────────────────────────────────

export async function snapshotRestore(
  snapshotFile: string,
  opts: { force?: boolean },
): Promise<void> {
  console.log('\n🌸 openclaw-teleport — restoring instance snapshot...\n');

  if (!fs.existsSync(snapshotFile)) {
    throw new Error(`❌ File not found: ${snapshotFile}`);
  }

  // 1. Check if ~/.openclaw/ already exists
  if (fs.existsSync(OPENCLAW_DIR) && !opts.force) {
    throw new Error(
      `❌ ${OPENCLAW_DIR} already exists.\n` +
      `   Use --force to overwrite the existing installation.`,
    );
  }

  // 2. Extract tar to temp dir
  const tmpDir = path.join(os.tmpdir(), `openclaw-snapshot-restore-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log('📦 Extracting snapshot...');
  execSync(`tar -xzf "${path.resolve(snapshotFile)}" -C "${tmpDir}"`, {
    encoding: 'utf-8',
  });

  const stageDir = path.join(tmpDir, 'snapshot');
  const manifestPath = path.join(stageDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fs.rmSync(tmpDir, { recursive: true });
    throw new Error('❌ Invalid snapshot file: manifest.json not found');
  }

  const manifest: SnapshotManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  console.log(`🖥️  Origin:   ${manifest.hostname}`);
  console.log(`📅 Packed:   ${manifest.packed_at}`);
  console.log(`🤖 Agents:   ${manifest.agents.length}`);
  console.log(`📝 Files:    ${manifest.files.length}`);

  // 3. Copy all files to ~/.openclaw/
  console.log('\n📂 Restoring files...');
  fs.mkdirSync(OPENCLAW_DIR, { recursive: true });

  let fileCount = 0;
  for (const f of manifest.files) {
    const src = path.join(stageDir, f);
    const dst = path.join(OPENCLAW_DIR, f);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      fileCount++;
    }
  }
  console.log(`   ✅ ${fileCount} files restored`);

  // 4. Path correction in openclaw.json
  const oldHome = manifest.home_dir;
  const newHome = os.homedir();

  if (oldHome !== newHome) {
    console.log(`\n🔧 Adjusting paths: ${oldHome} → ${newHome}`);
    const configPath = path.join(OPENCLAW_DIR, 'openclaw.json');
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const updated = replacePathsInObject(raw, oldHome, newHome);
      fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
      console.log('   ✅ openclaw.json paths updated');
    }
  } else {
    console.log('\n🔧 Same home directory — no path adjustment needed');
  }

  // 5. Clone repos for each agent
  let totalCloned = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  if (manifest.agents.some((a) => a.repos.length > 0)) {
    console.log('\n🐙 Cloning workspace repos...');

    if (!commandExists('git')) {
      console.log('   ⚠️  git not found — repos must be cloned manually:');
      for (const agent of manifest.agents) {
        for (const repo of agent.repos) {
          const wsPath = path.join(newHome, agent.workspace_path);
          console.log(`     git clone ${repo.url} ${path.join(wsPath, repo.relativePath)}`);
        }
      }
      totalFailed = manifest.agents.reduce((n, a) => n + a.repos.length, 0);
    } else {
      for (const agent of manifest.agents) {
        const wsPath = path.join(newHome, agent.workspace_path);
        for (const repo of agent.repos) {
          const targetDir = path.join(wsPath, repo.relativePath);

          if (fs.existsSync(targetDir)) {
            console.log(`   ⏭️  ${repo.name} (already exists)`);
            totalSkipped++;
            continue;
          }

          try {
            fs.mkdirSync(path.dirname(targetDir), { recursive: true });
            console.log(`   📥 Cloning ${repo.name} → ${repo.relativePath}...`);
            execSync(`git clone "${repo.url}" "${targetDir}"`, {
              encoding: 'utf-8',
              timeout: 120000,
              stdio: 'pipe',
            });
            console.log(`   ✅ ${repo.name}`);
            totalCloned++;
          } catch {
            console.log(`   ⚠️  Failed to clone ${repo.name} (${repo.url})`);
            totalFailed++;
          }
        }
      }
    }
  }

  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true });

  // 7. Start gateway if openclaw exists
  let gatewayStarted = false;
  if (commandExists('openclaw')) {
    console.log('\n🚀 Starting OpenClaw Gateway...');
    try {
      execSync('openclaw gateway start', {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: 'pipe',
      });
      console.log('   ✅ Gateway started');
      gatewayStarted = true;
    } catch {
      console.log('   ⚠️  Failed to start gateway');
      console.log('      Try manually: openclaw gateway start');
    }
  }

  // 8. Summary
  const totalRepos = manifest.agents.reduce((n, a) => n + a.repos.length, 0);

  console.log('\n' + '═'.repeat(50));
  console.log('🌸 Snapshot Restoration Summary');
  console.log('═'.repeat(50));
  console.log(`📂 Target:    ${OPENCLAW_DIR}`);
  console.log(`📝 Files:     ${fileCount} restored`);
  console.log(`🤖 Agents:    ${manifest.agents.length}`);
  if (totalRepos > 0) {
    console.log(`🐙 Repos:     ${totalCloned} cloned, ${totalSkipped} skipped, ${totalFailed} failed`);
  }
  console.log(`🔧 Paths:     ${oldHome !== newHome ? 'adjusted' : 'unchanged'}`);
  console.log(`🚀 Gateway:   ${gatewayStarted ? '✅ running' : '⚠️  not started'}`);
  console.log('═'.repeat(50));
  console.log('Instance restored successfully 🌸');
  console.log('═'.repeat(50) + '\n');
}

// ── snapshotInspect ───────────────────────────────────────────────

export async function snapshotInspect(snapshotFile: string): Promise<void> {
  if (!fs.existsSync(snapshotFile)) {
    throw new Error(`❌ File not found: ${snapshotFile}`);
  }

  // Extract only manifest.json
  const tmpDir = path.join(os.tmpdir(), `openclaw-snapshot-inspect-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    execSync(`tar -xzf "${path.resolve(snapshotFile)}" -C "${tmpDir}" snapshot/manifest.json`, {
      encoding: 'utf-8',
    });

    const manifestPath = path.join(tmpDir, 'snapshot', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('❌ Invalid snapshot file: manifest.json not found');
    }

    const manifest: SnapshotManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const stats = fs.statSync(path.resolve(snapshotFile));
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    const totalRepos = manifest.agents.reduce((n, a) => n + a.repos.length, 0);

    console.log('\n' + '═'.repeat(50));
    console.log('🌸 Snapshot Inspection');
    console.log('═'.repeat(50));
    console.log(`🖥️  Hostname: ${manifest.hostname}`);
    console.log(`📅 Packed:   ${manifest.packed_at}`);
    console.log(`📏 Size:     ${sizeMB} MB`);
    console.log(`🤖 Agents:   ${manifest.agents.length}`);
    console.log(`📝 Files:    ${manifest.files.length}`);
    console.log(`🐙 Repos:    ${totalRepos}`);

    if (manifest.agents.length > 0) {
      console.log(`\n🤖 Agents:`);
      for (const agent of manifest.agents) {
        console.log(`   • ${agent.name} (${agent.id})`);
        console.log(`     Workspace: ~/${agent.workspace_path}`);
        if (agent.repos.length > 0) {
          for (const repo of agent.repos) {
            console.log(`     🐙 ${repo.name} — ${repo.url}`);
          }
        }
      }
    }

    // Show file breakdown
    const byTopDir: Record<string, number> = {};
    for (const f of manifest.files) {
      const topDir = f.includes('/') ? f.split('/')[0] : '(root)';
      byTopDir[topDir] = (byTopDir[topDir] ?? 0) + 1;
    }

    console.log('\n📊 Contents breakdown:');
    for (const [dir, count] of Object.entries(byTopDir).sort((a, b) => b[1] - a[1])) {
      console.log(`   📂 ${dir}: ${count} files`);
    }

    console.log('═'.repeat(50) + '\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}
