import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { parseCookie } from 'cookie';
import rateLimit from 'express-rate-limit';
import { Server, Socket } from 'socket.io';
import { Redis as RedisClient } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { ADMIT_SCRIPT, GROUP_JOIN_SCRIPT, LocalAdmissionPool, RELEASE_SCRIPT } from './admission.js';
import { AccountStore, sanitizeProgress } from './accounts.js';

const limit = Number.parseInt(process.env.PLAYER_LIMIT ?? '5000', 10);
if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('PLAYER_LIMIT must be an integer from 1 to 5000');
const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === 'production' && !redisUrl) throw new Error('REDIS_URL is required in production so the player cap works across instances.');
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGIN) throw new Error('ALLOWED_ORIGIN is required in production.');
if (process.env.NODE_ENV === 'production' && !databaseUrl) throw new Error('DATABASE_URL is required in production so accounts are persisted.');
if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'true' && process.env.ALLOWED_ORIGIN !== 'http://localhost:3001') throw new Error('COOKIE_SECURE=true is required outside the local Compose origin; serve Buddie over HTTPS.');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.ALLOWED_ORIGIN?.split(',') ?? true }, maxHttpBufferSize: 1024, pingInterval: 25000, pingTimeout: 20000, transports: ['websocket', 'polling'] });
const accountStore = new AccountStore(databaseUrl);
const secureCookies = process.env.COOKIE_SECURE === 'true';
const sessionCookie = { httpOnly: true, secure: secureCookies, sameSite: 'lax' as const, path: '/', maxAge: 14 * 24 * 60 * 60 * 1000 };
app.use(express.json({ limit: '8kb' }));
app.use(cookieParser());
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many account attempts. Please try again later.' } });
const progressLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const normalizeUsername = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
function validUsername(username: string) { return /^[a-z0-9_]{3,18}$/.test(username); }
function validPassword(password: unknown): password is string { return typeof password === 'string' && password.length >= 10 && password.length <= 72; }
async function authenticatedPlayer(req: express.Request) {
  const token = req.cookies?.buddie_session;
  return typeof token === 'string' ? accountStore.playerForSession(token) : null;
}
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password;
  if (!validUsername(username)) return res.status(400).json({ error: 'Choose a username using 3–18 letters, numbers, or underscores.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be 10–72 characters.' });
  try {
    const account = await accountStore.register(username, await bcrypt.hash(password, 12));
    res.cookie('buddie_session', await accountStore.createSession(account.id), sessionCookie);
    res.status(201).json({ account, storage: accountStore.persistent ? 'persistent' : 'temporary' });
  } catch (error) {
    if (error instanceof Error && (error.message === 'USERNAME_TAKEN' || (error as Error & { code?: string }).code === '23505')) return res.status(409).json({ error: 'That username is already taken. Try another one.' });
    console.error('Registration failed:', error);
    res.status(503).json({ error: 'Accounts are temporarily unavailable. Please try again.' });
  }
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password;
  if (!validUsername(username) || typeof password !== 'string' || password.length > 72) return res.status(400).json({ error: 'Enter a valid username and password.' });
  try {
    const credentials = await accountStore.credentials(username);
    if (!credentials || !(await bcrypt.compare(password, credentials.passwordHash))) return res.status(401).json({ error: 'Username or password does not match.' });
    const account = await accountStore.playerForId(credentials.id);
    if (!account) return res.status(401).json({ error: 'Username or password does not match.' });
    res.cookie('buddie_session', await accountStore.createSession(account.id), sessionCookie);
    res.json({ account, storage: accountStore.persistent ? 'persistent' : 'temporary' });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(503).json({ error: 'Accounts are temporarily unavailable. Please try again.' });
  }
});
app.get('/api/auth/me', async (req, res) => {
  try {
    const account = await authenticatedPlayer(req);
    if (!account) return res.status(401).json({ error: 'Sign in to continue.' });
    res.json({ account, storage: accountStore.persistent ? 'persistent' : 'temporary' });
  } catch { res.status(503).json({ error: 'Accounts are temporarily unavailable.' }); }
});
app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies?.buddie_session;
  if (typeof token === 'string') await accountStore.deleteSession(token);
  res.clearCookie('buddie_session', { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' });
  res.status(204).end();
});
app.put('/api/progress', progressLimiter, async (req, res) => {
  try {
    const account = await authenticatedPlayer(req);
    if (!account) return res.status(401).json({ error: 'Sign in to save progress.' });
    const progress = sanitizeProgress(req.body?.progress);
    if (!progress) return res.status(400).json({ error: 'Progress data is not valid.' });
    const saved = await accountStore.saveProgress(account.id, progress);
    if (!saved) return res.status(404).json({ error: 'Account no longer exists.' });
    res.json({ account: saved });
  } catch { res.status(503).json({ error: 'Progress could not be saved right now.' }); }
});
const instanceId = randomUUID();
const localPool = new LocalAdmissionPool(limit);
const sockets = new Map<string, Socket>();
const localGroups = new Map<string, Set<string>>();
const localVotes = new Map<string, Map<string, number>>();
let redis: RedisClient | undefined;
let publisher: RedisClient | undefined;
let subscriber: RedisClient | undefined;
const prefix = process.env.REDIS_PREFIX ?? 'buddie:v1';
const activeKey = `${prefix}:active`;
const waitingKey = `${prefix}:waiting`;
const sequenceKey = `${prefix}:sequence`;
const groupWaitingKey = `${prefix}:groups:waiting`;
const promotionChannel = `${prefix}:promotions`;
const groupChannel = `${prefix}:group-assignments`;
const memberFor = (socket: Socket) => `${instanceId}|${socket.id}`;
const fromMember = (member: string) => member.slice(member.indexOf('|') + 1);
const ownerFor = (member: string) => member.slice(0, member.indexOf('|'));

io.use(async (socket, next) => {
  try {
    const rawCookies = socket.handshake.headers.cookie ?? '';
    const token = parseCookie(rawCookies).buddie_session;
    const player = token ? await accountStore.playerForSession(token) : null;
    if (!player) return next(new Error('sign-in-required'));
    socket.data.playerId = player.id;
    next();
  } catch { next(new Error('account-service-unavailable')); }
});

if (redisUrl) {
  redis = new RedisClient(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
  publisher = new RedisClient(redisUrl, { maxRetriesPerRequest: null });
  subscriber = new RedisClient(redisUrl, { maxRetriesPerRequest: null });
  io.adapter(createAdapter(publisher, subscriber));
  subscriber.subscribe(promotionChannel, groupChannel).catch((error) => console.error('Redis subscriptions failed:', error));
  subscriber.on('message', async (channel, raw) => {
    try {
      const message = JSON.parse(raw) as { owner: string; member: string; active?: number; room?: string };
      if (message.owner !== instanceId) return;
      const socketId = fromMember(message.member);
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) {
        if (channel === promotionChannel) await release(message.member);
        return;
      }
      if (channel === promotionChannel) {
        socket.data.admitted = true;
        socket.emit('admission:promoted', { state: 'active', active: message.active, limit });
      } else if (channel === groupChannel && message.room) {
        socket.data.groupRoom = message.room;
        socket.emit('group:matched', { room: message.room, teamSize: 2 });
      }
    } catch (error) { console.error('Invalid Redis event:', error); }
  });
}

async function counts() {
  if (!redis) return { active: localPool.activeCount, waiting: localPool.waitingCount };
  const [active, waiting] = await redis.pipeline().scard(activeKey).zcard(waitingKey).exec() as [[Error | null, number], [Error | null, number]];
  return { active: Number(active?.[1] ?? 0), waiting: Number(waiting?.[1] ?? 0) };
}

async function release(member: string) {
  if (!redis) {
    const result = localPool.release(member);
    if (result.promoted) {
      const socketId = fromMember(result.promoted);
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.data.admitted = true;
        socket.emit('admission:promoted', { state: 'active', active: result.active, limit });
      }
    }
    return;
  }
  const result = await redis.eval(RELEASE_SCRIPT, 2, activeKey, waitingKey, member, String(limit)) as [string, string, string];
  const promoted = result[0];
  if (promoted) {
    await publisher?.publish(promotionChannel, JSON.stringify({ owner: ownerFor(promoted), member: promoted, active: Number(result[1]) }));
  }
}

async function joinGroup(socket: Socket) {
  const member = memberFor(socket);
  if (socket.data.groupRoom) { socket.emit('group:matched', { room: socket.data.groupRoom, teamSize: 2 }); return; }
  if (!redis) {
    const pair = [...sockets.keys()].filter((id) => {
      const peer = sockets.get(id);
      return id !== socket.id && peer?.data.admitted && !peer.data.groupRoom;
    });
    if (pair.length === 0) {
      socket.data.groupWaiting = true;
      socket.emit('group:waiting');
      return;
    }
    const peer = sockets.get(pair[0]);
    if (!peer) { socket.emit('group:waiting'); return; }
    const room = `buddy:${randomUUID()}`;
    socket.data.groupRoom = room; peer.data.groupRoom = room;
    localGroups.set(room, new Set([socket.id, peer.id]));
    await Promise.all([socket.join(room), peer.join(room)]);
    io.to(room).emit('group:matched', { room, teamSize: 2 });
    return;
  }
  const pair = await redis.eval(GROUP_JOIN_SCRIPT, 2, groupWaitingKey, sequenceKey, member) as string[];
  if (!pair.length) { socket.data.groupWaiting = true; socket.emit('group:waiting'); return; }
  const room = `buddy:${randomUUID()}`;
  const ids = pair.map(fromMember);
  await Promise.all(ids.map((id) => io.in(id).socketsJoin(room)));
  for (const pairedMember of pair) {
    await publisher?.publish(groupChannel, JSON.stringify({ owner: ownerFor(pairedMember), member: pairedMember, room }));
  }
  const votesKey = `${prefix}:group:${room}:votes`;
  const votersKey = `${prefix}:group:${room}:voters`;
  await redis.expire(votesKey, 3600); await redis.expire(votersKey, 3600);
}

io.on('connection', async (socket) => {
  const member = memberFor(socket);
  socket.data.member = member;
  sockets.set(socket.id, socket);
  try {
    let state: 'active' | 'waiting'; let active: number; let position: number | undefined;
    if (redis) {
      const response = await redis.eval(ADMIT_SCRIPT, 3, activeKey, waitingKey, sequenceKey, String(limit), member) as [number, number, number];
      state = Number(response[0]) === 1 ? 'active' : 'waiting'; active = Number(response[1]); position = Number(response[2]) || undefined;
    } else {
      const response = localPool.admit(member); state = response.state; active = response.active; position = response.position;
    }
    socket.data.admitted = state === 'active';
    const current = await counts();
    socket.emit('admission', { state, position, active, waiting: current.waiting, limit, mode: redis ? 'shared' : 'single-process' });
    if (state === 'waiting') socket.emit('queue:position', { state: 'waiting', position, active, waiting: current.waiting, limit });
  } catch (error) {
    console.error('Admission check failed:', error);
    socket.emit('admission', { state: 'waiting', position: 1, limit, error: 'capacity-check-unavailable' });
    socket.disconnect(true);
    return;
  }

  socket.on('group:join', () => {
    if (!socket.data.admitted) return;
    void joinGroup(socket).catch((error) => { console.error('Group pairing failed:', error); socket.emit('group:unavailable'); });
  });
  socket.on('group:vote', async (choice: unknown) => {
    if (!socket.data.admitted || typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0 || choice > 2 || !socket.data.groupRoom) return;
    const room = socket.data.groupRoom as string;
    if (redis) {
      const votesKey = `${prefix}:group:${room}:votes`; const votersKey = `${prefix}:group:${room}:voters`;
      const firstVote = await redis.sadd(votersKey, member);
      if (firstVote) await redis.hincrby(votesKey, String(choice), 1);
      const votes = await redis.hgetall(votesKey);
      io.to(room).emit('group:voteCounts', [Number(votes['0'] ?? 0), Number(votes['1'] ?? 0), Number(votes['2'] ?? 0)]);
    } else {
      const votes = localVotes.get(room) ?? new Map<string, number>();
      if (!votes.has(member)) votes.set(member, choice);
      localVotes.set(room, votes);
      io.to(room).emit('group:voteCounts', [0, 1, 2].map((value) => [...votes.values()].filter((vote) => vote === value).length));
    }
  });
  socket.on('disconnect', async () => {
    sockets.delete(socket.id);
    if (redis) {
      await redis.zrem(groupWaitingKey, member);
      if (socket.data.admitted) await release(member);
    } else if (socket.data.admitted) {
      const result = localPool.release(member);
      if (result.promoted) {
        const promotedSocket = io.sockets.sockets.get(fromMember(result.promoted));
        if (promotedSocket) {
          promotedSocket.data.admitted = true;
          promotedSocket.data.groupWaiting = false;
          promotedSocket.emit('admission:promoted', { state: 'active', active: result.active, limit });
        }
      }
    } else localPool.release(member);
  });
});

app.get('/health', async (_req, res) => {
  try { res.json({ ok: true, ...(await counts()), limit, admission: redis ? 'redis-shared' : 'single-process-preview' }); }
  catch { res.status(503).json({ ok: false, error: 'admission-store-unavailable' }); }
});
if (process.env.NODE_ENV === 'production') {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.resolve(dirname, '../dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(dirname, '../dist/index.html')));
}
const port = Number(process.env.PORT ?? 3001);
void accountStore.initialize().then(() => {
  httpServer.listen(port, () => console.log(`Buddie server listening on :${port} (${redis ? 'Redis shared cap' : 'single-process preview'}, ${accountStore.persistent ? 'PostgreSQL accounts' : 'temporary accounts'}, limit ${limit})`));
}).catch((error) => {
  console.error('Account store initialization failed:', error);
  process.exitCode = 1;
});

for (const client of [redis, publisher, subscriber]) client?.on('error', (error) => console.error('Redis error:', error.message));
