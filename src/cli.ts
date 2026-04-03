import { Command } from 'commander';
import { pack } from './pack.js';
import { unpack, inspect } from './commands.js';
import { snapshotPack, snapshotRestore, snapshotInspect } from './snapshot.js';

const program = new Command();

program
  .name('openclaw-teleport')
  .description('🌸 Agent soul migration — pack your identity, memory, and tools into one file')
  .version('0.5.0');

program
  .command('pack')
  .description('Pack an agent into a .soul archive')
  .argument('[agent-id]', 'Agent ID to pack (defaults to first configured agent)')
  .option('-o, --output <path>', 'Output file path (default: ./{agent}_{date}.soul)')
  .action(async (agentId: string | undefined, opts: { output?: string }) => {
    try {
      await pack(agentId, opts.output);
    } catch (err) {
      console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program
  .command('unpack')
  .description('Unpack a .soul archive and restore the agent')
  .argument('<file>', 'Path to .soul file')
  .option('-w, --workspace <path>', 'Target workspace directory')
  .action(async (file: string, opts: { workspace?: string }) => {
    try {
      await unpack(file, opts.workspace);
    } catch (err) {
      console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program
  .command('inspect')
  .description('Inspect a .soul archive without unpacking')
  .argument('<file>', 'Path to .soul file')
  .action(async (file: string) => {
    try {
      await inspect(file);
    } catch (err) {
      console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// ── Snapshot commands ─────────────────────────────────────────────

const snapshot = program
  .command('snapshot')
  .description('Snapshot the entire OpenClaw instance (~/.openclaw/)');

snapshot
  .command('pack')
  .description('Pack the entire ~/.openclaw/ directory into a .snapshot archive')
  .option('-o, --output <path>', 'Output file path (default: ./openclaw_YYYYMMDD.snapshot)')
  .action(async (opts: { output?: string }) => {
    try {
      await snapshotPack(opts.output);
    } catch (err) {
      console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

snapshot
  .command('restore')
  .description('Restore an OpenClaw instance from a .snapshot archive')
  .argument('<file>', 'Path to .snapshot file')
  .option('--force', 'Overwrite existing ~/.openclaw/ directory')
  .action(async (file: string, opts: { force?: boolean }) => {
    try {
      await snapshotRestore(file, { force: opts.force });
    } catch (err) {
      console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

snapshot
  .command('inspect')
  .description('Inspect a .snapshot archive without restoring')
  .argument('<file>', 'Path to .snapshot file')
  .action(async (file: string) => {
    try {
      await snapshotInspect(file);
    } catch (err) {
      console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program.parse();
