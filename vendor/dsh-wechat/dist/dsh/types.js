/**
 * Structural types for the DSH service surface this bridge touches.
 *
 * Deliberately local and minimal: the bridge runs as a third-party static
 * plugin and must not import `@deepseek-ai/*` packages at runtime (they are
 * not resolvable from the profile's node_modules). These shapes mirror the
 * documented contracts verified against the running harness.
 */
/**
 * Read the live session log. Prefers `snapshotEvents()` (DSH 0.1.5);
 * falls back to the legacy `events` array when that is all the host
 * exposes.
 */
export function sessionEvents(session) {
    if (!session)
        return [];
    if (typeof session.snapshotEvents === "function") {
        try {
            const snap = session.snapshotEvents();
            if (Array.isArray(snap))
                return snap;
        }
        catch {
            // fall through to the legacy array
        }
    }
    return Array.isArray(session.events) ? session.events : [];
}
//# sourceMappingURL=types.js.map