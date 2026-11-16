import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore, sanitizeProgress } from './accounts.js';

test('creates a session that only resolves to a public player account', async () => {
  const store = new AccountStore();
  const player = await store.register('Buddie_One', 'not-a-real-password-hash');
  const token = await store.createSession(player.id);
  assert.ok(token.length > 30);
  assert.equal((await store.playerForSession(token))?.username, 'Buddie_One');
  assert.equal('passwordHash' in ((await store.playerForSession(token)) ?? {}), false);
  await store.deleteSession(token);
  assert.equal(await store.playerForSession(token), null);
});

test('validates progress bounds and rejects unknown lesson ids', () => {
  assert.deepEqual(sanitizeProgress({ stars: 4, completed: ['body-basics'], avatar: 2 }), { stars: 4, completed: ['body-basics'], avatar: 2 });
  assert.deepEqual(sanitizeProgress({ stars: 6, completed: ['gbv'], avatar: 1 }), { stars: 6, completed: ['gbv'], avatar: 1 });
  assert.equal(sanitizeProgress({ stars: -1, completed: [], avatar: 0 }), null);
  assert.equal(sanitizeProgress({ stars: 4, completed: ['unknown'], avatar: 0 }), null);
  assert.equal(sanitizeProgress({ stars: 4, completed: [], avatar: 9 }), null);
});

test('rejects duplicate usernames in the local development store', async () => {
  const store = new AccountStore();
  await store.register('Buddie_One', 'hash');
  await assert.rejects(() => store.register('Buddie_One', 'another-hash'), /USERNAME_TAKEN/);
});
