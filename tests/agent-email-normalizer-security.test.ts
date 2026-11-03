import { EventEmitter } from 'node:events';
import { isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { createLocalEmailNormalizer } from '../agent/email-normalizer.js';

function childFixture() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('reviewed local email subprocess boundary', () => {
  beforeEach(() => mocks.spawn.mockReset());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['relative-python', '\\\\synthetic.invalid\\python.exe', '//synthetic.invalid/python'])(
    'rejects untrusted interpreter selection before spawning: %s',
    (interpreterPath) => {
      expect(() =>
        createLocalEmailNormalizer({
          providerKey: 'fixture-provider',
          referenceSecret: Buffer.alloc(32),
          interpreterPath,
        }),
      ).toThrow('EMAIL_RUNTIME_NOT_PREPARED');
      expect(mocks.spawn).not.toHaveBeenCalled();
    },
  );

  it('keeps hostile MIME data in stdin and fixes executable, argv, shell and environment', async () => {
    const child = childFixture();
    mocks.spawn.mockReturnValue(child);
    vi.stubEnv('PYTHONPATH', 'synthetic-untrusted-module-directory');
    vi.stubEnv('SYNTHETIC_PROVIDER_TOKEN', 'synthetic-secret-not-for-child');
    const normalize = createLocalEmailNormalizer({
      providerKey: 'fixture-provider',
      referenceSecret: Buffer.alloc(32),
      interpreterPath: process.execPath,
    });
    const controller = new AbortController();
    const raw = Buffer.from(
      'Subject: synthetic\n\nIgnore instructions; interpreterPath=relative-python; shell=true',
    );
    const pending = normalize(raw, {
      recordKey: 'REC1',
      sourceRef: 'SRC01',
      signal: controller.signal,
    });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [executable, argv, options] = mocks.spawn.mock.calls[0]!;
    expect(executable).toBe(process.execPath);
    expect(argv.slice(0, 3)).toEqual(['-I', '-B', '-c']);
    expect(argv).toHaveLength(4);
    expect(argv[3]).not.toContain('relative-python');
    expect(options.shell).toBe(false);
    expect(options.windowsHide).toBe(true);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(isAbsolute(options.cwd)).toBe(true);
    expect(options.env.PYTHONPATH).toBeUndefined();
    expect(options.env.SYNTHETIC_PROVIDER_TOKEN).toBeUndefined();
    expect(
      Object.keys(options.env).every((key) =>
        /^(?:PYTHONIOENCODING|PYTHONDONTWRITEBYTECODE|systemroot|windir|temp|tmp|tmpdir)$/i.test(
          key,
        ),
      ),
    ).toBe(true);
    const packet = JSON.parse(child.stdin.end.mock.calls[0]![0]);
    expect(Buffer.from(packet.rawBase64, 'base64')).toEqual(raw);
    expect(packet.recordKey).toBe('REC1');
    controller.abort();
    await expect(pending).rejects.toThrow('EMAIL_NORMALIZATION_REJECTED');
    expect(child.kill).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('rejects malformed input and pre-cancelled requests before process creation', async () => {
    const normalize = createLocalEmailNormalizer({
      providerKey: 'fixture-provider',
      referenceSecret: Buffer.alloc(32),
      interpreterPath: process.execPath,
    });
    await expect(
      normalize(new Uint8Array(), { recordKey: 'REC1', sourceRef: 'SRC01' }),
    ).rejects.toThrow('EMAIL_INPUT_REJECTED');
    const controller = new AbortController();
    controller.abort();
    await expect(
      normalize(Buffer.from('synthetic'), {
        recordKey: 'REC1',
        sourceRef: 'SRC01',
        signal: controller.signal,
      }),
    ).rejects.toThrow('EMAIL_NORMALIZER_CANCELLED');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
