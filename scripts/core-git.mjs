import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_ROOT = fileURLToPath(new URL('../', import.meta.url));

export class CoreGitError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// A caller's GIT_DIR/WORK_TREE/INDEX or tracing configuration must not redirect
// these read/distribution checks into a different repository or a private log.
function gitEnvironment() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
  };
}

function executeGit(cwd, args, binary = false, maxBuffer = 8 * 1024 * 1024) {
  try {
    return execFileSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
      cwd,
      env: gitEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(binary ? {} : { encoding: 'utf8' }),
      maxBuffer,
    });
  } catch {
    throw new CoreGitError('CORE_GIT_COMMAND_FAILED');
  }
}

/** Identify the physical core/repository boundary without reading HEAD or blobs. */
export function getCoreGitContext(coreRoot = CORE_ROOT) {
  let root, repositoryRoot;
  try {
    root = realpathSync(coreRoot);
    repositoryRoot = realpathSync(executeGit(root, ['rev-parse', '--show-toplevel']).trim());
  } catch {
    throw new CoreGitError('CORE_GIT_UNAVAILABLE');
  }
  const localPrefix = relative(repositoryRoot, root);
  if (isAbsolute(localPrefix) || localPrefix === '..' || localPrefix.startsWith('..' + sep))
    throw new CoreGitError('CORE_GIT_BOUNDARY_REJECTED');
  const prefix = localPrefix.split(sep).join('/');
  return {
    coreRoot: root,
    repositoryRoot,
    prefix,
    embedded: prefix !== '',
    git(args, { binary = false, repository = false, maxBuffer } = {}) {
      return executeGit(repository ? repositoryRoot : root, args, binary, maxBuffer);
    },
  };
}

/** Distribution needs the core's own checkout, never an ancestor's HEAD/tree. */
export function requireStandaloneCore(coreRoot = CORE_ROOT) {
  const context = getCoreGitContext(coreRoot);
  if (context.embedded) throw new CoreGitError('CORE_GIT_STANDALONE_REQUIRED');
  return context;
}

export function coreGitFailure(error, fallback = 'CORE_GIT_REJECTED') {
  const candidate = error instanceof CoreGitError ? error.code : fallback;
  const code = /^[A-Z0-9_]{1,80}$/.test(candidate) ? candidate : fallback;
  return { status: 'FAIL', error: code };
}

/** CLI boundary failures contain only a code: no raw git error, path or stack. */
export function standaloneCoreOrExit() {
  try {
    return requireStandaloneCore();
  } catch (error) {
    process.stderr.write(JSON.stringify(coreGitFailure(error)) + '\n');
    process.exit(1);
  }
}
