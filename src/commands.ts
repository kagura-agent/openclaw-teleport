import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { loadConfig, type Manifest, type OpenClawConfig } from './utils.js';

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

export async function unpack(soulFile: string, workspacePath?: string): Promise<void> {
  console.log('\n🌸 soul-pack — unpacking agent soul...\n');

  if (!fs.existsSync(soulFile)) {
    throw new Error(`❌ File not found: ${soulFile}`);
  }

  const { tmpDir, manifest } = extractManifest(soulFile);
  const stageDir = path.join(tmpDir, 'soul');

  console.log(`🆔 Agent: ${manifest.agent_name} (${manifest.agent_id})`);
  console.log(`📅 Packed: ${manifest.packed_at}`);
  console.log(`📝 Files: ${manifest.files.length}\n`);

  // Determine workspace
  const targetWorkspace = workspacePath
    ? path.resolve(workspacePath)
    : path.join(OPENCLAW_DIR, 'workspace');

  fs.mkdirSync(targetWorkspace, { recursive: true });

  // 1. Restore identity files
  console.log('📝 Restoring identity files...');
  const identityDir = path.join(stageDir, 'identity');
  if (fs.existsSync(identityDir)) {
    const files = fs.readdirSync(identityDir);
    for (const f of files) {
      const src = path.join(identityDir, f);
      const dst = path.join(targetWorkspace, f);
      fs.copyFileSync(src, dst);
      console.log(`   ✅ ${f}`);
    }
  }

  // 2. Restore memory directory
  console.log('🧠 Restoring memory...');
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
        }
      }
    };
    copyRecursive(memoryDir, path.join(targetWorkspace, 'memory'));
    console.log('   ✅ Memory restored');
  }

  // 3. Restore .db files
  console.log('🗄️  Restoring tool data...');
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
        }
      }
    };
    copyRecursive(dataDir, targetWorkspace);
  }

  // 4. Merge agent config into openclaw.json
  console.log('⚙️  Merging agent config...');
  const agentConfigPath = path.join(stageDir, 'config', 'agent-config.json');
  if (fs.existsSync(agentConfigPath)) {
    const agentConfig = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));

    if (fs.existsSync(CONFIG_PATH)) {
      const existingConfig: OpenClawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

      // Merge agent into list if not already present
      if (!existingConfig.agents) {
        existingConfig.agents = { list: [] };
      }
      if (!existingConfig.agents.list) {
        existingConfig.agents.list = [];
      }

      const existingIdx = existingConfig.agents.list.findIndex(
        (a) => a.id === manifest.agent_id
      );

      const newAgent = {
        ...agentConfig.agent,
        workspace: targetWorkspace,
      };

      if (existingIdx >= 0) {
        existingConfig.agents.list[existingIdx] = newAgent;
        console.log('   ✅ Agent config updated (merged)');
      } else {
        existingConfig.agents.list.push(newAgent);
        console.log('   ✅ Agent config added');
      }

      fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));
    } else {
      console.log('   ⚠️  openclaw.json not found, skipping config merge');
    }
  }

  // 5. Restore cron jobs
  console.log('⏰ Restoring cron jobs...');
  const cronDir = path.join(stageDir, 'cron');
  if (fs.existsSync(cronDir)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
    const files = fs.readdirSync(cronDir);
    for (const f of files) {
      fs.copyFileSync(path.join(cronDir, f), path.join(CRON_DIR, f));
      console.log(`   ✅ ${f}`);
    }
  }

  // 6. Clone GitHub repos
  if (manifest.github_repos.length > 0) {
    console.log('🐙 Cloning GitHub repos...');
    const repoDir = path.join(targetWorkspace, 'repos');
    fs.mkdirSync(repoDir, { recursive: true });

    for (const repo of manifest.github_repos) {
      const repoPath = path.join(repoDir, repo.name);
      if (fs.existsSync(repoPath)) {
        console.log(`   ⏭️  ${repo.name} (already exists)`);
        continue;
      }
      try {
        console.log(`   📥 Cloning ${repo.name}...`);
        execSync(`git clone "${repo.url}" "${repoPath}"`, {
          encoding: 'utf-8',
          timeout: 120000,
          stdio: 'pipe',
        });
        console.log(`   ✅ ${repo.name}`);
      } catch {
        console.log(`   ⚠️  Failed to clone ${repo.name} — you can do it manually`);
      }
    }
  }

  // Clean up
  fs.rmSync(tmpDir, { recursive: true });

  // Print rebinding checklist
  console.log('\n' + '═'.repeat(50));
  console.log('🔗 Services to rebind:');
  console.log('═'.repeat(50));
  if (manifest.services_to_rebind.length > 0) {
    for (const svc of manifest.services_to_rebind) {
      console.log(`   ☐ ${svc}`);
    }
  } else {
    console.log('   (none)');
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`Welcome back, ${manifest.agent_name} 🌸`);
  console.log('═'.repeat(50) + '\n');
}

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
