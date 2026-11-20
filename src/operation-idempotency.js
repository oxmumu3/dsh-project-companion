import {createHash} from 'node:crypto';

const operationTtl = 10 * 60_000;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

export function validOperationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

export function createOperationLedger({clock = Date.now, capacity = 512} = {}) {
  const receipts = new Map();
  return {
    run(id, request, work) {
      if (id == null) return Promise.resolve().then(work);
      const signature = createHash('sha256').update(JSON.stringify(canonicalValue(request))).digest('hex');
      for (const [key, entry] of receipts) {
        if (entry.expiresAt <= Number(clock())) receipts.delete(key);
      }
      const previous = receipts.get(id);
      if (previous) {
        if (previous.signature === signature) return previous.result;
        throw Object.assign(new Error('此请求编号已用于不同操作。'), {status: 409});
      }
      if (receipts.size >= capacity) throw Object.assign(new Error('请求过多，请稍后再试。'), {status: 429});
      const entry = {signature, expiresAt: Infinity, result: null};
      entry.result = Promise.resolve().then(work).finally(() => {
        entry.expiresAt = Number(clock()) + operationTtl;
      });
      receipts.set(id, entry);
      return entry.result;
    },
    clear: () => receipts.clear(),
  };
}
