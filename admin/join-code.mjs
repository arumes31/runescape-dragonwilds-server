import { open } from 'node:fs/promises';

// The current game log survives an admin restart. Read it incrementally with a
// bounded buffer; never use the last 200 console lines as the source of truth.
export class JoinCodeMonitor {
  constructor({ path = '/game-data/RSDragonwilds/Saved/Logs/RSDragonwilds.log', maxBytes = 4 * 1024 * 1024 } = {}) {
    this.path = path; this.maxBytes = maxBytes; this.pending = Promise.resolve();
    this.reset(null);
  }
  reset(run) {
    this.run = run; this.file = null; this.prefix = null; this.offset = 0; this.partial = ''; this.code = null;
  }
  read(container) {
    const snapshot = { Id: container.Id, State: { ...container.State } };
    const next = this.pending.then(() => this.scan(snapshot));
    this.pending = next.catch(() => {});
    return next;
  }
  async scan(container) {
    const { State: state } = container;
    const started = Date.parse(state.StartedAt);
    const run = `${container.Id}:${state.StartedAt}`;
    if (run !== this.run) this.reset(run);
    if (!state.Running || state.Status !== 'running' || !Number.isFinite(started)) {
      this.reset(null);
      return { code: null, state: 'unavailable' };
    }
    let handle;
    try {
      handle = await open(this.path, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Game log is not a regular file');
      if (stat.mtimeMs < started) { this.reset(run); return { code: null, state: 'waiting' }; }
      const header = Buffer.alloc(256);
      const prefixRead = await handle.read(header, 0, header.length, 0);
      const prefix = header.subarray(0, prefixRead.bytesRead).toString('hex');
      const file = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      if (file !== this.file || stat.size < this.offset || (this.prefix !== null && !prefix.startsWith(this.prefix))) this.reset(run);
      this.file = file; this.prefix = prefix;
      const end = Math.min(stat.size, this.offset + this.maxBytes);
      const buffer = Buffer.alloc(65536);
      while (this.offset < end) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - this.offset), this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        const lines = (this.partial + buffer.toString('utf8', 0, bytesRead)).split('\n');
        this.partial = lines.pop().slice(-4096);
        for (const line of lines) {
          const match = line.match(/^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]\[\s*\d+\]LogNetSessionSettings: Setting \["JoinCode"\] written with key\[[^\]\r\n]*\] value\[([^\]\r\n]*)\]/);
          if (!match) continue;
          const at = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`);
          if (at >= started) this.code = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(match[8]) ? match[8] : null;
        }
      }
      return { code: this.code, state: this.offset < stat.size ? 'scanning' : this.code ? 'available' : 'waiting' };
    } catch (error) {
      this.reset(run);
      return { code: null, state: error.code === 'ENOENT' ? 'waiting' : 'error' };
    } finally { await handle?.close(); }
  }
}
