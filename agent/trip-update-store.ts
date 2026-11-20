import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { reviewTripUpdate, updateDigest } from './trip-update.js';

type Review = ReturnType<typeof reviewTripUpdate>;
type Version = {
  number: number;
  parent: string | null;
  digest: string;
  review: Review;
};

const revisionName = (number: number) => 'revision_' + String(number).padStart(8, '0');
const revisionPattern = /^revision_(\d{8})$/;

async function privateRoot(path: string) {
  if (!isAbsolute(path)) throw new Error('UPDATE_ROOT_MUST_BE_ABSOLUTE');
  const resolved = await realpath(path);
  if ((await lstat(path)).isSymbolicLink() || !(await lstat(resolved)).isDirectory())
    throw new Error('UPDATE_ROOT_INVALID');
  for (let parent = resolved; ; parent = dirname(parent)) {
    if (
      await lstat(join(parent, '.git')).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      })
    )
      throw new Error('UPDATE_ROOT_INSIDE_GIT');
    if (parent === dirname(parent)) return resolved;
  }
}

async function current(root: string): Promise<Version | undefined> {
  const revisions = (await readdir(root)).filter((name) => revisionPattern.test(name)).sort();
  const latest = revisions.at(-1);
  if (!latest) return undefined;
  const path = join(root, latest, 'revision.json');
  const entry = await lstat(join(root, latest));
  const file = await lstat(path);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.size > 4_000_000
  )
    throw new Error('UPDATE_REVISION_INVALID');
  const version = JSON.parse(await readFile(path, 'utf8')) as Version;
  if (
    revisionName(version.number) !== latest ||
    version.digest !==
      updateDigest({ number: version.number, parent: version.parent, review: version.review })
  )
    throw new Error('UPDATE_REVISION_INTEGRITY');
  return version;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!,
  );

function outputs(version: Version) {
  const { review } = version;
  const items = review.snapshot.tasks.filter(
    (item) => item.state === 'open' || item.state === 'risk_accepted',
  );
  const title = 'Controle da viagem, revisão ' + version.number;
  const summary =
    review.counts.open + ' itens abertos (' + review.counts.criticalOpen + ' críticos).';
  const checklist = {
    revision: version.digest,
    counts: review.counts,
    items,
  };
  const changed = new Map(review.changes.tasks.map((item) => [item.id, item]));
  const notifications = {
    revision: version.digest,
    criticalOpen: review.counts.criticalOpen,
    alerts: items
      .filter((item) => item.critical && changed.has(item.id))
      .map((item) => ({
        key: version.digest + ':' + item.id,
        taskId: item.id,
        state: item.state,
        dueAt: item.dueAt,
      })),
  };
  const cards = items
    .map(
      (item) =>
        '<li><strong>' +
        escapeHtml(item.title) +
        '</strong><p>' +
        escapeHtml(item.owner + ' | ' + item.nextAction + (item.dueAt ? ' | ' + item.dueAt : '')) +
        '</p></li>',
    )
    .join('\n');
  const index = [
    '---',
    'lang: "pt-BR"',
    'title: "' + title + '"',
    'subject: "Pendências operacionais, fontes e revisão da viagem"',
    '---',
    '',
    '# ' + title,
    '',
    summary,
    '',
    '- [Painel](painel.html)',
    '- [Checklist](checklist.json)',
    '- [Revisão e evidências](revision.json)',
    '',
    'Pendências registradas no checklist. A comprovação depende das fontes vinculadas.',
    '',
  ].join('\n');
  return {
    'revision.json': JSON.stringify(version, null, 2) + '\n',
    'checklist.json': JSON.stringify(checklist, null, 2) + '\n',
    'notificacoes.json': JSON.stringify(notifications, null, 2) + '\n',
    'painel.html':
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>' +
      title +
      '</title><meta name="viewport" content="width=device-width,initial-scale=1"><main><h1>' +
      title +
      '</h1><p>' +
      summary +
      '</p><ul>' +
      cards +
      '</ul></main></html>\n',
    'index.md': index,
  };
}

export async function tripRevision(path: string, input?: unknown, approval?: string) {
  const root = await privateRoot(path);
  const previous = await current(root);
  if (input === undefined)
    return {
      version: previous ?? null,
      index: previous ? join(root, revisionName(previous.number), 'index.md') : null,
    };
  const number = (previous?.number ?? 0) + 1;
  if (number > 99999999) throw new Error('REVISION_LIMIT');
  const parent = previous?.digest ?? null;
  const review = reviewTripUpdate(input, previous?.review.snapshot);
  const version = { number, parent, review, digest: updateDigest({ number, parent, review }) };
  if (approval === undefined) return { version, index: null };
  if (approval !== version.digest) throw new Error('UPDATE_APPROVAL_MISMATCH');
  const destination = join(root, revisionName(number));
  const files = outputs(version);
  if (Buffer.byteLength(files['revision.json']) > 4_000_000)
    throw new Error('UPDATE_REVISION_TOO_LARGE');
  const staging = await mkdtemp(join(root, '.pending-'));
  try {
    const writes = await Promise.allSettled(
      Object.entries(files).map(([name, content]) =>
        writeFile(join(staging, name), content, { flag: 'wx', mode: 0o600 }),
      ),
    );
    if (writes.some((write) => write.status === 'rejected')) throw new Error('UPDATE_WRITE_FAILED');
    // A complete revision directory is nonempty. It cannot be replaced by rename.
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { version, index: join(destination, 'index.md') };
}
