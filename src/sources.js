import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, parse, sep, join } from 'node:path';

export const PROJECT_FILES = ['.agent/memory/progress.md', '.agent/memory/context.md', 'README.md'];
export const FILE_BYTES = 16 * 1024;
const RELEASE_BYTES = 256 * 1024;

// Reject symlinks in every component, including the project root itself.
export async function safeProjectRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root) || root.length > 4096) throw new Error('Absolute project root required');
  const absolute = resolve(root);
  let cursor = parse(absolute).root;
  for (const component of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Symlink or non-directory project root rejected');
  }
  if (await realpath(absolute) !== absolute) throw new Error('Project root changed');
  return absolute;
}

export async function readProjectFiles(root) {
  const absolute = await safeProjectRoot(root);
  const rows = [];
  for (const relative of PROJECT_FILES) {
    let handle;
    try {
      const pieces = relative.split('/');
      let cursor = absolute;
      for (const component of pieces.slice(0, -1)) {
        cursor = join(cursor, component);
        const stat = await lstat(cursor);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Symlink/non-directory ancestor rejected');
      }
      const target = join(absolute, ...pieces);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Symlink/non-regular source rejected');
      if (await realpath(target) !== target) throw new Error('Source escaped project');
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const opened = await handle.stat();
      if (!opened.isFile() || stat.ino !== opened.ino || stat.dev !== opened.dev) throw new Error('Source changed while opening');
      const bytes = Buffer.alloc(FILE_BYTES);
      const { bytesRead } = await handle.read(bytes, 0, FILE_BYTES, 0);
      if (await realpath(target) !== target) throw new Error('Source ancestor changed while reading');
      // Drop any partial UTF-8 code point at the cap rather than introducing U+FFFD.
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, bytesRead), { stream: opened.size > bytesRead });
      rows.push({ path: relative, status: 'ok', text, bytes: bytesRead, truncated: opened.size > bytesRead, modifiedAt: opened.mtime.toISOString() });
    } catch (error) {
      rows.push({ path: relative, status: error?.code === 'ENOENT' ? 'missing' : 'rejected', detail: String(error?.message ?? error).slice(0, 200) });
    } finally { await handle?.close(); }
  }
  return rows;
}

export function validateRepository(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || repository.split('/').some(x => x === '.' || x === '..')) throw new Error('Public GitHub repository must be owner/repo');
  return repository;
}

export async function readGithubRelease(repository, options = {}) {
  validateRepository(repository);
  const signal = AbortSignal.timeout(5000);
  const response = await (options.fetch ?? globalThis.fetch)(`https://api.github.com/repos/${repository}/releases/latest`, {
    redirect: 'error', signal,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dsh-project-companion/0.1.0' },
  });
  if (response.status !== 200) throw new Error(`GitHub latest release: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > RELEASE_BYTES) { await response.body?.cancel(); throw new Error('GitHub response too large'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub response body missing');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RELEASE_BYTES) throw new Error('GitHub response size limit exceeded');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  if (typeof value.tag_name !== 'string' || typeof value.html_url !== 'string' || !value.html_url.startsWith(`https://github.com/${repository}/releases/`)) throw new Error('Unexpected GitHub release response');
  return { status: 'ok', repository, tag: value.tag_name.slice(0, 120), url: value.html_url.slice(0, 1000), publishedAt: typeof value.published_at === 'string' ? value.published_at.slice(0, 40) : 'unknown' };
}
