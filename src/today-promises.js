/** Persisted dispatch associations for the right rail.
 *
 * A promise that was sent out through "让 Dot 去办" keeps a strong link to the
 * session it created. The association is read back on every projection, but
 * only when the link's root is still inside the captured grants and the ledger
 * row still exists at that exact root. Anything else stays "nobody is on it".
 */
import {resolve} from 'node:path';

export async function joinPromiseLinks({promises, internal, links, grants} = {}) {
  if (!Array.isArray(promises) || !promises.length) return [];
  const rows = new Map((internal?.sessions ?? []).map(row => [row.sessionId, row]));
  const allowedRoot = root => Array.isArray(grants) && typeof root === 'string' && grants.some(grant => typeof grant?.root === 'string' && resolve(grant.root) === resolve(root));
  const out = [];
  for (const promise of promises) {
    if (!promise || typeof promise !== 'object' || typeof promise.source !== 'string' || typeof promise.sourceItemId !== 'string') { out.push(promise); continue; }
    let link = null;
    try { link = await links?.linkOf?.(`${promise.source}:${promise.sourceItemId}`); } catch { /* unknown link */ }
    if (!link?.sessionId || !allowedRoot(link.root)) { out.push(promise); continue; }
    const row = rows.get(link.sessionId);
    if (!row || resolve(row.root) !== resolve(link.root)) { out.push(promise); continue; }
    out.push({...promise, handledBy: {sessionId: link.sessionId, state: row.state, title: String(row.title ?? '').slice(0, 300), at: row.lastEventAt}});
  }
  return out;
}
