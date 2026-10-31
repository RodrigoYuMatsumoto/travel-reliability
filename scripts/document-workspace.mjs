// Local operator CLI. This entry point is deliberately separate from MCP tools.
import { register } from 'tsx/esm/api';
register();

const usage =
  'node scripts/document-workspace.mjs <inventory|prepare|apply|rollback|status> --root <absolute-directory> [--input <relative.json>] [--save-plan] [--plan <digest>] [--approve <same-digest>]';
try {
  const [command, ...argv] = process.argv.slice(2);
  if (command === '--help' && !argv.length) {
    process.stdout.write(usage + '\n');
  } else {
    if (!['inventory', 'prepare', 'apply', 'rollback', 'status'].includes(command))
      throw new Error('WORKSPACE_CLI_ARGUMENTS');
    const flags = new Map();
    for (let index = 0; index < argv.length; index++) {
      const flag = argv[index];
      if (
        !['--root', '--input', '--save-plan', '--plan', '--approve'].includes(flag) ||
        flags.has(flag)
      )
        throw new Error('WORKSPACE_CLI_ARGUMENTS');
      if (flag === '--save-plan') flags.set(flag, true);
      else {
        const value = argv[++index];
        if (!value || value.startsWith('--')) throw new Error('WORKSPACE_CLI_ARGUMENTS');
        flags.set(flag, value);
      }
    }
    const allowed =
      command === 'inventory'
        ? ['--root']
        : command === 'prepare'
          ? ['--root', '--input', '--save-plan']
          : command === 'status'
            ? ['--root', '--plan']
            : ['--root', '--plan', '--approve'];
    if (!flags.has('--root') || [...flags.keys()].some((flag) => !allowed.includes(flag)))
      throw new Error('WORKSPACE_CLI_ARGUMENTS');
    const { DocumentWorkspace } = await import(
      new URL('../agent/document-workspace.ts', import.meta.url).href
    );
    const workspace = await DocumentWorkspace.open(flags.get('--root'));
    let result;
    if (command === 'inventory') result = await workspace.inventory();
    else if (command === 'prepare') {
      if (!flags.has('--input')) throw new Error('WORKSPACE_CLI_ARGUMENTS');
      result = await workspace.prepareFromFile(flags.get('--input'));
      if (flags.has('--save-plan'))
        result = { ...result, savedPlan: await workspace.savePlan(result.plan) };
    } else {
      const digest = flags.get('--plan');
      if (!digest || (command !== 'status' && flags.get('--approve') !== digest))
        throw new Error('WORKSPACE_EXPLICIT_APPROVAL_REQUIRED');
      const plan = await workspace.loadPlan(digest);
      result =
        command === 'status'
          ? await workspace.status(plan)
          : await workspace[command](plan, {
              intent: command,
              approvedPlanDigest: flags.get('--approve'),
            });
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  }
} catch (error) {
  const supplied = error?.code ?? error?.message;
  const code =
    typeof supplied === 'string' && /^WORKSPACE_[A-Z_]+$/.test(supplied)
      ? supplied
      : 'WORKSPACE_CLI_REJECTED';
  process.stderr.write(JSON.stringify({ error: code }) + '\n');
  process.exitCode = 1;
}
