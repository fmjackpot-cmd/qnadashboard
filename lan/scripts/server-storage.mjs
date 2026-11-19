import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// One atomic file per record/blob; uploaded bytes never enter the public folder.
export function createDiskStorage(directory) {
  const location = (kind, key) => path.join(directory, kind, createHash('sha256').update(key).digest('hex'));
  const read = async file => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const write = async (file, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value));
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  };
  // Serialize read/compare/write, including competing administrators.
  let queue = Promise.resolve();
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const store = {
    get: async key => (await read(location('meetings', key)))?.data ?? null,
    getWithMetadata: async key => {
      const entry = await read(location('meetings', key));
      return entry ? { data: entry.data, etag: entry.etag } : null;
    },
    setJSON: (key, data, options = {}) => serialize(async () => {
      const file = location('meetings', key);
      const previous = await read(file);
      if ((options.onlyIfNew && previous) || (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch)) return { modified: false };
      const etag = randomUUID();
      await write(file, { data, etag });
      return { modified: true, etag };
    })
  };
  const documents = {
    list: async () => {
      let names;
      try { names = await fs.readdir(path.join(directory, 'documents')); }
      catch (error) { if (error.code === 'ENOENT') return { blobs: [] }; throw error; }
      const blobs = [];
      for (const name of names.filter(name => /^[a-f0-9]{64}$/.test(name))) {
        const entry = await read(path.join(directory, 'documents', name));
        if (entry) blobs.push({ key: entry.key });
      }
      return { blobs };
    },
    delete: key => fs.rm(location('documents', key), { force: true }),
    set: (key, data, { metadata }) => write(location('documents', key), { key, metadata, bytes: Buffer.from(data).toString('base64') }),
    getWithMetadata: async key => {
      const entry = await read(location('documents', key));
      return entry ? { data: Buffer.from(entry.bytes, 'base64'), metadata: entry.metadata } : null;
    },
    getMetadata: async key => {
      const entry = await read(location('documents', key));
      return entry ? { metadata: entry.metadata } : null;
    }
  };
  return { store, documents };
}
