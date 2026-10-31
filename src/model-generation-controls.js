/** Shared logical output budget. Missing accounting cannot grant a retry. */
export function remainingModelOutputBudget(result,budget) {
 const output=result?.usage?.outputTokens,reasoning=result?.usage?.reasoningTokens??0;
 if(!Number.isSafeInteger(budget)||budget<=0||!Number.isSafeInteger(output)||output<=0||!Number.isSafeInteger(reasoning)||reasoning<0)return 0;
 // Count separately reported reasoning conservatively, even if it overlaps.
 const used=output+reasoning;
 return Number.isSafeInteger(used)&&used<budget?budget-used:0;
}

// Keep authorization waits inside the same total generation deadline.
export function awaitModelGuard(guard, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return guard(); }).then(value => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', stop);
      reject(signal.aborted ? signal.reason : error);
    });
  });
}
