import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAdmissionPool } from './admission.js';

test('enforces a hard active-player cap and places overflow in FIFO order', () => {
  const pool = new LocalAdmissionPool(2);
  assert.equal(pool.admit('one').state, 'active');
  assert.equal(pool.admit('two').state, 'active');
  assert.deepEqual(pool.admit('three'), { state: 'waiting', active: 2, position: 1 });
  assert.deepEqual(pool.admit('four'), { state: 'waiting', active: 2, position: 2 });
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.release('one').promoted, 'three');
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.position('four'), 1);
  assert.equal(pool.release('two').promoted, 'four');
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.waitingCount, 0);
});

test('removes a disconnected waiter without consuming a player slot', () => {
  const pool = new LocalAdmissionPool(1);
  pool.admit('active'); pool.admit('waiting');
  const result = pool.release('waiting');
  assert.equal(result.promoted, undefined);
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.waitingCount, 0);
});

test('keeps duplicate admissions from using extra slots', () => {
  const pool = new LocalAdmissionPool(1);
  assert.equal(pool.admit('same').state, 'active');
  assert.equal(pool.admit('same').state, 'active');
  assert.equal(pool.activeCount, 1);
});
