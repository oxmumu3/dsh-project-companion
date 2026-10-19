import { createHash } from 'node:crypto'
import { normalizeTitle } from './text.js'

const FINGERPRINT_VERSION = 'todo-evidence-v1'

function digest(parts                                                 )         {
  const canonical = parts.map((part) => part == null ? '' : String(part)).join('\u0000')
  return `${FINGERPRINT_VERSION}:${createHash('sha256').update(canonical).digest('hex')}`
}

function canonicalize(value         )          {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  const input = value                           
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]))
}

/** Stable request hash paired with an operation id. The operation id answers
 * "which call/turn", while this hash detects an accidental reuse with a
 * different payload. */
export function todoOperationRequestHash(value         )         {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function extractionTodoOperationId(sessionId        , turn        )         {
  return digest(['extract-operation', sessionId, turn])
}

/** One operation may legitimately touch several todos. Bind immutable evidence
 * to the resolved canonical id after identity resolution. */
export function todoEvidenceFingerprint(operationId        , canonicalTodoId        )         {
  return digest(['evidence', operationId, canonicalTodoId])
}

/** Stable identity for one todo candidate produced by one durable extraction turn.
 * The candidate index keeps two source observations distinct; occurrence
 * identity is a later resolver concern, so storage may still conservatively
 * collapse exact-title open candidates. The normalized title guards against a
 * reordered/different result being mistaken for the earlier candidate. */
export function extractionTodoFingerprint(
  sessionId        ,
  turn        ,
  candidateIndex        ,
  title        ,
)         {
  return digest(['extract', sessionId, turn, candidateIndex, normalizeTitle(title)])
}

/** Stable identity for one todo update observation from an extraction turn. */
export function extractionTodoUpdateFingerprint(
  sessionId        ,
  turn        ,
  candidateIndex        ,
  matchTitle        ,
)         {
  return digest(['extract-update', sessionId, turn, candidateIndex, normalizeTitle(matchTitle)])
}

/** Tool call ids are host-owned durable call identities. A retried tool call
 * therefore resolves to the same evidence and domain result. */
export function toolTodoFingerprint(sessionId                    , callId        )         {
  return digest(['tool-write', sessionId ?? 'unknown-session', callId])
}

export function toolTodoActionId(sessionId                    , callId        )         {
  return digest(['tool-action', sessionId ?? 'unknown-session', callId])
}
