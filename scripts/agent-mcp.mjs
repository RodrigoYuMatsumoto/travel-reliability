// Direct Node entry point: no npm banner and no current-directory dependency.
import { register } from 'tsx/esm/api';
register();
try {
  const { startTravelStdio } = await import(new URL('../agent/mcp.ts', import.meta.url).href);
  startTravelStdio();
} catch {
  process.stderr.write('TRAVEL_MCP_START_FAILED\n');
  process.exitCode = 1;
}
