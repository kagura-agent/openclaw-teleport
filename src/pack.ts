import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  loadConfig,
  findAgent,
  collectMarkdownFiles,
  collectMemoryDir,
  collectDbFiles,
  collectCronFiles,
  getGitHubRepos,
  detectServices,
  extractAgentConfig,
  extractChannelsConfig,
  sanitizeAgentDefaults,
  loadCronJobs,
  type Manifest,
} from './utils.js';

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const CRON_DIR = path.join(OPENCLAW_DIR, 'cron');

export async function pack(agentId?: string, outputPath?: string): Promise<void> {
  console.log('\n🌸 openclaw-teleport — packing agent soul...\n');

  // Load config and find agent
  const config = loadConfig();
  const agent = findAgent(config, agentId);

  console.log(`📦 Agent: ${agent.name} (${agent.id})`);
  console.log(`📂 Workspace: ${agent.workspace}\n`);

  if (!fs.existsSync(agent.workspace)) {
    throw new Error(`❌ Workspace not found: ${agent.workspace}`);
  }

  // Create temp directory for staging
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const soulName = `${agent.id}_${date}`;
  const tmpDir = path.join(os.tmpdir(), `openclaw-teleport-${soulName}`);
  const stageDir = path.join(tmpDir, 'soul');

  // Clean up any previous staging
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });

  const allFiles: string[] = [];

  // 1. Collect identity files (.md in workspace root)
  console.log('📝 Collecting identity files...');
  const mdFiles = collectMarkdownFiles(agent.workspace);
  for (const f of mdFiles) {
    const src = path.join(agent.workspace, f);
    const dst = path.join(stageDir, 'identity', f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    allFiles.push(`identity/${f}`);
  }
  console.log(`   ✅ ${mdFiles.length} markdown files`);

  // 2. Collect memory directory
  console.log('🧠 Collecting memory...');
  const memFiles = collectMemoryDir(agent.workspace);
  for (const f of memFiles) {
    const src = path.join(agent.workspace, f);
    const dst = path.join(stageDir, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    allFiles.push(f);
  }
  console.log(`   ✅ ${memFiles.length} memory files`);

  // 3. Collect .db files
  console.log('🗄️  Collecting tool data...');
  const dbFiles = collectDbFiles(agent.workspace);
  for (const f of dbFiles) {
    const src = path.join(agent.workspace, f);
    const dst = path.join(stageDir, 'data', f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    allFiles.push(`data/${f}`);
  }
  console.log(`   ✅ ${dbFiles.length} database files`);

  // 4. Extract agent config
  console.log('⚙️  Extracting agent config...');
  const agentConfig = extractAgentConfig(config, agent.id);
  const configPath = path.join(stageDir, 'config', 'agent-config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(agentConfig, null, 2));
  allFiles.push('config/agent-config.json');
  console.log('   ✅ Agent config saved');

  // 5. Collect cron job files
  console.log('⏰ Collecting cron jobs...');
  const cronFiles = collectCronFiles(agent.id);
  for (const f of cronFiles) {
    const src = path.join(CRON_DIR, f);
    const dst = path.join(stageDir, 'cron', f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    allFiles.push(`cron/${f}`);
  }
  console.log(`   ✅ ${cronFiles.length} cron files`);

  // 5.5. Collect credentials (pairing records, allowFrom lists)
  console.log('🔐 Collecting credentials...');
  const credDir = path.join(OPENCLAW_DIR, 'credentials');
  let credCount = 0;
  if (fs.existsSync(credDir)) {
    const credFiles = fs.readdirSync(credDir).filter(f => f.endsWith('.json'));
    for (const f of credFiles) {
      const src = path.join(credDir, f);
      const dst = path.join(stageDir, 'credentials', f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      allFiles.push(`credentials/${f}`);
      credCount++;
    }
  }
  console.log(`   ✅ ${credCount} credential files`);

  // 6. Load full cron job content for this agent
  console.log('⏰ Extracting cron job definitions...');
  const cronJobs = loadCronJobs(agent.id);
  console.log(`   ✅ ${cronJobs.length} cron jobs for ${agent.id}`);

  // 7. Get GitHub repos
  console.log('🐙 Fetching GitHub repos...');
  const repos = getGitHubRepos('kagura-agent');
  console.log(`   ✅ ${repos.length} repos found`);

  // 8. Detect services
  const services = detectServices(config);
  console.log(`🔗 Services to rebind: ${services.length > 0 ? services.join(', ') : 'none'}`);

  // 9. Extract channels config (with credentials)
  console.log('🔑 Extracting channel credentials...');
  const channelsConfig = extractChannelsConfig(config, agent.id);
  const channelCount = Object.keys(channelsConfig).length;
  console.log(`   ✅ ${channelCount} channel(s) saved`);

  // 10. Extract agent defaults, models config, and gateway config
  const agentDefaults = sanitizeAgentDefaults(config.agents?.defaults ?? {});
  const modelsConfig = config.models ?? {};
  const bindingsConfig = config.bindings ?? [];
  const gatewayConfig = config.gateway ?? {};

  // 11. Generate manifest
  const manifest: Manifest = {
    agent_id: agent.id,
    agent_name: agent.name,
    packed_at: new Date().toISOString(),
    files: allFiles,
    github_repos: repos,
    services_to_rebind: services,
    channels: channelsConfig,
    cron_jobs: cronJobs,
    agent_defaults: agentDefaults,
    models_config: modelsConfig,
    bindings: bindingsConfig as Array<Record<string, unknown>>,
    gateway: gatewayConfig as Record<string, unknown>,
  };

  const manifestPath = path.join(stageDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // 12. Create tarball
  const outputFile = outputPath ? path.resolve(outputPath) : path.resolve(`${soulName}.soul`);
  console.log('\n📦 Packing soul archive...');

  execSync(`tar -czf "${outputFile}" -C "${tmpDir}" soul`, {
    encoding: 'utf-8',
  });

  // Clean up staging
  fs.rmSync(tmpDir, { recursive: true });

  // Summary
  const stats = fs.statSync(outputFile);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log('\n' + '═'.repeat(50));
  console.log('🌸 Soul packed successfully!');
  console.log('═'.repeat(50));
  console.log(`📦 File:     ${outputFile}`);
  console.log(`📏 Size:     ${sizeMB} MB`);
  console.log(`🆔 Agent:    ${agent.name} (${agent.id})`);
  console.log(`📝 Files:    ${allFiles.length}`);
  console.log(`🐙 Repos:    ${repos.length}`);
  console.log(`🔗 Services: ${services.join(', ') || 'none'}`);
  console.log(`🔑 Channels: ${channelCount}`);
  console.log(`⏰ Cron:     ${cronJobs.length} jobs`);
  console.log(`📅 Packed:   ${manifest.packed_at}`);
  console.log('═'.repeat(50));

  console.log('\n⚠️  SECURITY WARNING: The .soul file contains credentials');
  console.log('   (API tokens, app secrets). Treat it like a password file.');
  console.log('   Do NOT commit it to git or share publicly.\n');
}
