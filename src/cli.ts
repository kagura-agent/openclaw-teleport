import { Command } from 'commander';
import { pack } from './pack.js';
import { unpack, inspect } from './commands.js';

const program = new Command();

program
  .name('openclaw-teleport')
  .description('🌸 Agent soul migration — pack your identity, memory, and tools into one file')
  .version('0.2.0');

program
  .command('pack')
  .description('Pack an agent into a .soul archive')
  .argument('[agent-id]', 'Agent ID to pack (defaults to first configured agent)')
  .action(async (agentId?: string) => {
    try {
      await pack(agentId);
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

program.parse();
