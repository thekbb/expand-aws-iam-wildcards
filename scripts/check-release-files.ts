import { defaultRuntime, requireCommand } from './release/command.js';
import { checkReleaseManagedFiles } from './release/managed-files.js';

const runtime = defaultRuntime(console);

try {
  requireCommand(runtime, 'git');
  checkReleaseManagedFiles(runtime);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
