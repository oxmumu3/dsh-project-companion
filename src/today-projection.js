/** One activity projection with a final authorization/source re-check.
 *
 * Building the projection awaits the persisted dispatch links after the ledger
 * snapshot and the workspace capture. Revocation or a source identity change can
 * land inside that await, so a second check runs after the joins:
 *  - workspace revision and grants must still be current;
 *  - the source snapshot must still carry the same revision and identity rows.
 * A change is retried once against fresh inputs. If it changes again the read
 * fails (the activity route returns 503), which the page shows as "can't see",
 * never as a stale list or an old title.
 */
import {joinPromiseLinks} from './today-promises.js';

const CHANGED = new Set(['WORKSPACE_ACCESS_CHANGED', 'WORKSPACE_CATALOG_CHANGED', 'WORKSPACE_AUTHORIZATION_CHANGED', 'SOURCE_IDENTITY_CHANGED']);
const changed = code => Object.assign(new Error(code), {code});
const sourceKey = snapshot => JSON.stringify((Array.isArray(snapshot?.sources) ? snapshot.sources : []).map(row => [row?.id ?? '', row?.state ?? '', row?.lastReadAt ?? '', row?.until ?? '']));

export function createTodayProjection({sessionLedger, dotSourceReader, workspaceAccess, links, readConnection, ownerForeground = async () => true} = {}) {
  if (typeof sessionLedger?.snapshot !== 'function' || typeof dotSourceReader?.snapshot !== 'function') throw new Error('Today projection needs a ledger and a source reader');
  if (typeof workspaceAccess?.capture !== 'function' || typeof workspaceAccess?.authorizeSync !== 'function') throw new Error('Today projection needs workspace access');
  return async function todayProjection(ownerSessionId = null) {
    if (ownerSessionId !== null && !await ownerForeground(ownerSessionId)) return null;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const connection = await readConnection();
        const captured = await workspaceAccess.capture();
        const snapshot = await sessionLedger.snapshot({connection, grants: captured.grants});
        if (!workspaceAccess.authorizeSync(captured)) throw changed('WORKSPACE_AUTHORIZATION_CHANGED');
        const dot = dotSourceReader.snapshot();
        const internal = typeof sessionLedger.internal === 'function' ? await sessionLedger.internal() : {sessions: []};
        const promises = await joinPromiseLinks({promises: dot.promises, internal, links, grants: captured.grants});
        // Re-check after the link join and finish with synchronous scope checks.
        if (typeof workspaceAccess.assertCurrent === 'function') {
          await workspaceAccess.assertCurrent(captured);
        } else {
          const freshCapture = await workspaceAccess.capture();
          if (freshCapture.revision !== captured.revision) throw changed('WORKSPACE_AUTHORIZATION_CHANGED');
        }
        if (ownerSessionId !== null && !await ownerForeground(ownerSessionId)) return null;
        if (!workspaceAccess.authorizeSync(captured)) throw changed('WORKSPACE_AUTHORIZATION_CHANGED');
        const after = dotSourceReader.snapshot();
        if (after.revision !== dot.revision || sourceKey(after) !== sourceKey(dot)) throw changed('SOURCE_IDENTITY_CHANGED');
        const access = {revision: String(captured.revision ?? ''), count: Array.isArray(captured.grants) ? captured.grants.length : 0};
        // The source read is started without blocking the request. Carry its
        // phase so Today can say "still reading" instead of turning an empty
        // cache into "all handled" while the provider call is still in flight.
        const sourcesPhase = ['idle', 'reading', 'ready', 'failed'].includes(dot.phase) ? dot.phase : 'ready';
        return {...snapshot, revision: snapshot.revision + dot.revision, access, promises, sources: dot.sources, sourcesPhase};
      } catch (error) {
        lastError = error;
        if (!CHANGED.has(error?.code)) throw error;
      }
    }
    throw lastError ?? changed('TODAY_PROJECTION_UNAVAILABLE');
  };
}
