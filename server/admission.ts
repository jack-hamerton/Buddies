export const ADMIT_SCRIPT = `
local active, waiting, sequence = KEYS[1], KEYS[2], KEYS[3]
local limit, member = tonumber(ARGV[1]), ARGV[2]
if redis.call('SISMEMBER', active, member) == 1 then
  return {1, redis.call('SCARD', active), 0}
end
if redis.call('SCARD', active) < limit and redis.call('ZCARD', waiting) == 0 then
  redis.call('SADD', active, member)
  return {1, redis.call('SCARD', active), 0}
end
redis.call('ZADD', waiting, 'NX', redis.call('INCR', sequence), member)
local rank = redis.call('ZRANK', waiting, member)
return {0, redis.call('SCARD', active), rank + 1}
`;

export const RELEASE_SCRIPT = `
local active, waiting = KEYS[1], KEYS[2]
local member = ARGV[1]
redis.call('SREM', active, member)
while redis.call('SCARD', active) < tonumber(ARGV[2]) do
  local nextMember = redis.call('ZPOPMIN', waiting, 1)
  if #nextMember == 0 then return {'', redis.call('SCARD', active), redis.call('ZCARD', waiting)} end
  if redis.call('SADD', active, nextMember[1]) == 1 then
    return {nextMember[1], redis.call('SCARD', active), redis.call('ZCARD', waiting)}
  end
end
return {'', redis.call('SCARD', active), redis.call('ZCARD', waiting)}
`;

export const GROUP_JOIN_SCRIPT = `
local waiting, sequence = KEYS[1], KEYS[2]
local member = ARGV[1]
redis.call('ZADD', waiting, 'NX', redis.call('INCR', sequence), member)
if redis.call('ZCARD', waiting) < 2 then return {} end
local pair = redis.call('ZPOPMIN', waiting, 2)
if #pair < 4 then return {} end
return {pair[1], pair[3]}
`;

export class LocalAdmissionPool {
  private readonly active = new Set<string>();
  private readonly waiting = new Map<string, number>();

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  }

  admit(member: string): { state: 'active' | 'waiting'; active: number; position?: number } {
    if (this.active.has(member)) return { state: 'active', active: this.active.size };
    if (this.waiting.has(member)) return { state: 'waiting', active: this.active.size, position: this.position(member) };
    if (this.active.size < this.limit && this.waiting.size === 0) {
      this.active.add(member);
      return { state: 'active', active: this.active.size };
    }
    this.waiting.set(member, Date.now());
    return { state: 'waiting', active: this.active.size, position: this.position(member) };
  }

  release(member: string): { promoted?: string; active: number; waiting: number } {
    this.waiting.delete(member);
    this.active.delete(member);
    const next = [...this.waiting.keys()][0];
    if (next !== undefined && this.active.size < this.limit) {
      this.waiting.delete(next);
      this.active.add(next);
      return { promoted: next, active: this.active.size, waiting: this.waiting.size };
    }
    return { active: this.active.size, waiting: this.waiting.size };
  }

  position(member: string): number | undefined {
    const queue = [...this.waiting.keys()];
    const index = queue.indexOf(member);
    return index < 0 ? undefined : index + 1;
  }

  get activeCount(): number { return this.active.size; }
  get waitingCount(): number { return this.waiting.size; }
}
