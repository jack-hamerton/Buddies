import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export type PlayerProgress = { stars: number; completed: string[]; avatar: number };
export type PlayerAccount = { id: string; username: string; progress: PlayerProgress };

type StoredPlayer = PlayerAccount & { passwordHash: string };
const allowedLessons = new Set(['body-basics', 'boundaries', 'brain-break', 'trail-school', 'trail-feed', 'trail-buddy', 'gbv']);
const emptyProgress = (): PlayerProgress => ({ stars: 3, completed: [], avatar: 0 });
const hashSession = (token: string) => createHash('sha256').update(token).digest('hex');

export function sanitizeProgress(value: unknown): PlayerProgress | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (!Number.isInteger(input.stars) || Number(input.stars) < 0 || Number(input.stars) > 9999) return null;
  if (!Array.isArray(input.completed) || input.completed.length > allowedLessons.size || !input.completed.every((lesson) => typeof lesson === 'string' && allowedLessons.has(lesson))) return null;
  if (!Number.isInteger(input.avatar) || Number(input.avatar) < 0 || Number(input.avatar) > 3) return null;
  return { stars: Number(input.stars), completed: [...new Set(input.completed as string[])], avatar: Number(input.avatar) };
}

export class AccountStore {
  readonly persistent: boolean;
  private readonly pool?: Pool;
  private readonly players = new Map<string, StoredPlayer>();
  private readonly usernames = new Map<string, string>();
  private readonly sessions = new Map<string, { playerId: string; expiresAt: number }>();

  constructor(databaseUrl?: string) {
    this.persistent = Boolean(databaseUrl);
    if (databaseUrl) this.pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_SIZE ?? '30'), idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
  }

  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS buddie_players (
        id UUID PRIMARY KEY,
        username VARCHAR(18) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        stars INTEGER NOT NULL DEFAULT 3 CHECK (stars BETWEEN 0 AND 9999),
        completed TEXT[] NOT NULL DEFAULT '{}',
        avatar SMALLINT NOT NULL DEFAULT 0 CHECK (avatar BETWEEN 0 AND 3),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS buddie_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        player_id UUID NOT NULL REFERENCES buddie_players(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS buddie_sessions_expiry_idx ON buddie_sessions (expires_at);
    `);
    await this.pool.query('DELETE FROM buddie_sessions WHERE expires_at < NOW()');
  }

  async register(username: string, passwordHash: string): Promise<PlayerAccount> {
    const id = randomUUID();
    if (this.pool) {
      const result = await this.pool.query('INSERT INTO buddie_players (id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username, stars, completed, avatar', [id, username, passwordHash]);
      return this.fromRow(result.rows[0]);
    }
    if (this.usernames.has(username)) throw new Error('USERNAME_TAKEN');
    const player: StoredPlayer = { id, username, passwordHash, progress: emptyProgress() };
    this.players.set(id, player); this.usernames.set(username, id);
    return this.publicPlayer(player);
  }

  async credentials(username: string): Promise<{ id: string; passwordHash: string } | null> {
    if (this.pool) {
      const result = await this.pool.query('SELECT id, password_hash FROM buddie_players WHERE username = $1', [username]);
      return result.rows[0] ? { id: result.rows[0].id, passwordHash: result.rows[0].password_hash } : null;
    }
    const id = this.usernames.get(username);
    const player = id ? this.players.get(id) : undefined;
    return player ? { id: player.id, passwordHash: player.passwordHash } : null;
  }

  async playerForId(playerId: string): Promise<PlayerAccount | null> {
    if (this.pool) {
      const result = await this.pool.query('SELECT id, username, stars, completed, avatar FROM buddie_players WHERE id = $1', [playerId]);
      return result.rows[0] ? this.fromRow(result.rows[0]) : null;
    }
    const player = this.players.get(playerId);
    return player ? this.publicPlayer(player) : null;
  }

  async createSession(playerId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashSession(token);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (this.pool) await this.pool.query('INSERT INTO buddie_sessions (token_hash, player_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, playerId, expiresAt]);
    else this.sessions.set(tokenHash, { playerId, expiresAt: expiresAt.getTime() });
    return token;
  }

  async playerForSession(token: string): Promise<PlayerAccount | null> {
    const tokenHash = hashSession(token);
    if (this.pool) {
      const result = await this.pool.query('SELECT p.id, p.username, p.stars, p.completed, p.avatar FROM buddie_sessions s JOIN buddie_players p ON p.id = s.player_id WHERE s.token_hash = $1 AND s.expires_at > NOW()', [tokenHash]);
      return result.rows[0] ? this.fromRow(result.rows[0]) : null;
    }
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= Date.now()) { this.sessions.delete(tokenHash); return null; }
    const player = this.players.get(session.playerId);
    return player ? this.publicPlayer(player) : null;
  }

  async deleteSession(token: string) {
    const tokenHash = hashSession(token);
    if (this.pool) await this.pool.query('DELETE FROM buddie_sessions WHERE token_hash = $1', [tokenHash]);
    else this.sessions.delete(tokenHash);
  }

  async saveProgress(playerId: string, progress: PlayerProgress): Promise<PlayerAccount | null> {
    if (this.pool) {
      const result = await this.pool.query('UPDATE buddie_players SET stars=$2, completed=$3, avatar=$4 WHERE id=$1 RETURNING id, username, stars, completed, avatar', [playerId, progress.stars, progress.completed, progress.avatar]);
      return result.rows[0] ? this.fromRow(result.rows[0]) : null;
    }
    const player = this.players.get(playerId);
    if (!player) return null;
    player.progress = progress;
    return this.publicPlayer(player);
  }

  async close() { await this.pool?.end(); }

  private publicPlayer(player: StoredPlayer): PlayerAccount {
    return { id: player.id, username: player.username, progress: { ...player.progress, completed: [...player.progress.completed] } };
  }

  private fromRow(row: { id: string; username: string; stars: number; completed: string[]; avatar: number }): PlayerAccount {
    return { id: row.id, username: row.username, progress: { stars: Number(row.stars), completed: row.completed ?? [], avatar: Number(row.avatar) } };
  }
}
