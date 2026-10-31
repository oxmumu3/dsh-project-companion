import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, fstatSync, lstatSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const valid = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Private durable at-most-once admission. No message bodies or credentials are saved. */
export class GuardedOutbox {
    file;
    state;
    chain = Promise.resolve();
    lock;
    closed = false;
    constructor(directory) {
        this.file = join(directory, 'dot-proactive-receipts.json');
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        // The OS-backed SQLite write lock is held for this service's entire
        // lifetime, then released automatically even if the host crashes. Node
        // without built-in SQLite gets no guarded service, not a weaker fallback.
        const { DatabaseSync: SQLite } = createRequire(import.meta.url)('node:sqlite');
        const lockPath = join(directory, 'dot-proactive-lock.sqlite');
        try {
            const s = lstatSync(lockPath);
            if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
                throw Error('unsafe lock');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        this.lock = new SQLite(lockPath);
        try {
            this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
        }
        catch (error) {
            this.lock.close();
            throw error;
        }
        try {
            const fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
            let text;
            try {
                const s = fstatSync(fd);
                if (!s.isFile() || s.nlink !== 1 || s.size > 2_000_000)
                    throw Error('unsafe journal');
                text = readFileSync(fd, 'utf8');
            }
            finally {
                closeSync(fd);
            }
            const raw = JSON.parse(text);
            if (raw.version !== 1 || !valid(raw.epoch) || !Array.isArray(raw.receipts) || raw.receipts.length > 10000 || raw.receipts.some(row => !valid(row.key) || !valid(row.binding) || !valid(row.payload) || !['dispatching', 'accepted', 'uncertain', 'blocked'].includes(row.status)) || new Set(raw.receipts.map(row => row.key)).size !== raw.receipts.length)
                throw Error('invalid receipt journal');
            this.state = raw;
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                this.lock.close();
                throw error;
            }
            this.state = { version: 1, epoch: randomBytes(32).toString('hex'), receipts: [] };
            try {
                this.save();
            }
            catch (error) {
                this.lock.close();
                throw error;
            }
        }
    }
    save() { const tmp = this.file + '.' + randomUUID(), fd = openSync(tmp, 'wx', 0o600); try {
        writeFileSync(fd, JSON.stringify(this.state));
        fsyncSync(fd);
        closeSync(fd);
        renameSync(tmp, this.file);
        const dir = openSync(dirname(this.file), 'r');
        try {
            fsyncSync(dir);
        }
        finally {
            closeSync(dir);
        }
    }
    catch (error) {
        try {
            closeSync(fd);
        }
        catch { }
        try {
            unlinkSync(tmp);
        }
        catch { }
        throw error;
    } }
    binding(identity) { if (this.closed)
        throw Error('guarded outbox closed'); return hash(JSON.stringify([this.state.epoch, identity])); }
    rotate() { this.state.epoch = randomBytes(32).toString('hex'); this.save(); }
    close() { if (!this.closed) {
        this.closed = true;
        try {
            this.lock.exec('ROLLBACK');
        }
        finally {
            this.lock.close();
        }
    } }
    async send(input) {
        const task = async () => {
            if (!input.requestId || input.requestId.length > 256 || !valid(input.expectedBinding) || input.payloadHash !== undefined && !valid(input.payloadHash))
                return 'blocked';
            const allowed = () => { try {
                return input.authorize() === true && (input.current?.() ?? true) === true && this.binding(input.identity) === input.expectedBinding;
            }
            catch {
                return false;
            } };
            if (!allowed())
                return 'blocked';
            const key = hash(input.requestId), payload = input.payloadHash ?? hash('');
            const prior = this.state.receipts.find(row => row.key === key);
            if (prior)
                return prior.binding !== input.expectedBinding || prior.payload !== payload ? 'blocked' : prior.status === 'accepted' ? 'accepted' : prior.status === 'blocked' ? 'blocked' : 'uncertain';
            if (!allowed() || this.state.receipts.length >= 10000)
                return 'blocked';
            const row = { key, binding: input.expectedBinding, payload, status: 'dispatching' };
            this.state.receipts.push(row);
            this.save();
            if (!allowed()) {
                row.status = 'blocked';
                this.save();
                return 'blocked';
            }
            try {
                await input.deliver();
                row.status = 'accepted';
                this.save();
                return 'accepted';
            }
            catch (error) {
                row.status = error?.definitelyUnsent === true ? 'blocked' : 'uncertain';
                this.save();
                return row.status;
            }
        };
        const next = this.chain.then(task, task);
        this.chain = next.catch(() => { });
        return next;
    }
}
//# sourceMappingURL=dot-guarded-outbox.js.map