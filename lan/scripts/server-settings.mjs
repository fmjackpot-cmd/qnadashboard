import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const validAdminKey = key => typeof key === 'string' && /^[\x21-\x7e]{6,128}$/.test(key) && !/["'\\]/.test(key) && !key.startsWith('replace_with_');

export async function saveAdminKey(file, key) {
  if (!validAdminKey(key)) throw new Error('Invalid administrator key');
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pattern = /^[ \t]*(?:export[ \t]+)?MEETING_ADMIN_KEY[ \t]*=.*$/gm;
  const line = `MEETING_ADMIN_KEY="${key}"`;
  text = pattern.test(text) ? text.replace(pattern, () => line) : `${text}\n${line}\n`;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, text, 'utf8'); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
