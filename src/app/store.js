// Apps, their records, members and an activity log. In memory, persisted to a
// local JSON file so a demo survives a restart. Every write goes through ops.js,
// which checks the caller's role and the record against the spec.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.BVE_STORE || path.join(HERE, '..', '..', 'data', 'store.json');

const state = { apps: {} };
let loaded = false;
let saving = Promise.resolve();

export function newId(bytes = 6) {
  return randomBytes(bytes).toString('base64url');
}

export async function load() {
  if (loaded) return;
  loaded = true;
  try {
    Object.assign(state, JSON.parse(await readFile(FILE, 'utf8')));
  } catch {
    // first run
  }
}

export function save() {
  // Never write before the file was read, or a fresh process would wipe it.
  if (!loaded) return saving;
  saving = saving.then(async () => {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(state));
  });
  return saving;
}

export function getApp(id) {
  return state.apps[id] || null;
}

export function putApp(app) {
  state.apps[app.id] = app;
  return save();
}

export function listApps() {
  return Object.values(state.apps).map((a) => ({ id: a.id, title: a.spec.title, entries: a.entries.length }));
}

/** Find the member a bearer token belongs to. Tokens are long random strings. */
export function memberFor(app, token) {
  if (!app || !token) return null;
  const m = app.members[token];
  return m ? { token, ...m } : null;
}
