// Explicit, local operator configuration. The default agent-mcp.mjs stays offline.
import { register } from 'tsx/esm/api';
register();
try {
  const args = process.argv.slice(2);
  if (
    args[0] !== '--config' ||
    !args[1] ||
    (args.length !== 2 && !(args.length === 3 && args[2] === '--check'))
  )
    throw new Error('OPERATOR_CLI_ARGUMENTS');
  const { loadOperatorProfile } = await import(
    new URL('../agent/operator-profile.ts', import.meta.url).href
  );
  const options = await loadOperatorProfile(args[1]);
  if (args[2] === '--check') {
    process.stdout.write(
      JSON.stringify({
        status: 'configured',
        workspaceConfigured: !!options.workspace,
        connectorsConfigured: options.connectors?.capabilities().configuredSources ?? [],
        fileNamesDisclosed: options.exposeWorkspaceNames === true,
        externalCalls: 0,
        persistenceWrites: 0,
      }) + '\n',
    );
  } else {
    const { startTravelStdio } = await import(new URL('../agent/mcp.ts', import.meta.url).href);
    startTravelStdio(options);
  }
} catch (error) {
  const supplied = error?.code ?? error?.message;
  const code =
    (typeof supplied === 'string' && /^(?:OPERATOR_|WORKSPACE_)[A-Z_]+$/.test(supplied)) ||
    supplied === 'EMAIL_RUNTIME_NOT_PREPARED'
      ? supplied
      : 'OPERATOR_START_REJECTED';
  process.stderr.write(JSON.stringify({ error: code }) + '\n');
  process.exitCode = 1;
}
