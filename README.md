# Buddie

A cheerful educational game for ages 12–17, designed for solo play and moderated, chat-free buddy rounds. It covers menstrual-cycle literacy, boundaries, gender-based violence (GBV) awareness, pressure scenarios, a sequencing puzzle, and branching story quests. The project is educational, not medical advice or a financial product.

## Run locally

Requirements: Node.js 20+ (22 recommended), npm. Redis is optional for single-server preview.

1. `npm install`
2. `npm run dev`
3. Open the Vite URL printed in the terminal (usually `http://localhost:5173`).

Without Redis, the local preview still enforces a FIFO cap in that one Node process. Without PostgreSQL, accounts exist only in that running server's memory and disappear at restart. Do not use the temporary store for a public service. Do not run multiple server processes without Redis; process-local limits cannot coordinate across instances.

## Shared 5,000-player room

For coordinated admission and persistent accounts, start PostgreSQL, Redis, and the app using Docker Compose: `docker compose up --build`. The local app is available at `http://localhost:3001`. Change `POSTGRES_PASSWORD` from its local default before hosting. The live room only counts signed-in players and rejects unauthenticated Socket.IO sessions. It uses Redis atomic Lua scripts for admission and release; the configured hard maximum is 5,000 (a lower `PLAYER_LIMIT` is allowed for testing). If all slots are occupied, new players are queued FIFO. Disconnects release slots and promote the next waiter. A Redis-backed Socket.IO adapter lets promotion/group events reach the owning server instance.

Players create an account with a nickname (3–18 letters, digits, or underscores) and a 10+ character password; no email, real name, or birth date is requested. Passwords are bcrypt-hashed, session tokens are random and stored hashed server-side, and the browser holds the token in an HttpOnly cookie. Progress is validated and persisted in PostgreSQL. Local no-DB mode uses temporary in-memory accounts. The default UI and auth endpoints intentionally ask minors to get trusted-adult permission; complete legal/privacy review and deploy an age-appropriate consent flow for jurisdictions where the game will be available before public launch.

`GET /health` reports the active count, waitlist count, cap, and whether the admission backend is shared or preview-only. In production, set `BUDDIE_ORIGIN` to the exact HTTPS origin, set `COOKIE_SECURE=true`, and replace the example `POSTGRES_PASSWORD`. Keep Redis/PostgreSQL private to the app network; use secure hosted configurations, persistence, monitoring, backups, and high availability as appropriate. Do not horizontally scale the preview mode.

## Game safety decisions

- Mistakes never subtract stars or restart the player. Stars are non-transferable encouragement only.
- There are no wallets, tradable tokens, prizes, purchases, or blockchain integration.
- The group feature pairs two players for a fixed choice activity. It has no free-text chat and collects no profile information.
- Use a nickname only; avoid real names, contact details, school/location details, or sensitive information. Sessions have a 14-day lifetime and can be ended with Sign out.
- The cycle lesson notes variation, avoids predicting individual fertility, and encourages trusted adult/health-professional support for personal concerns.
- The story simulation offers branching choices, animated scenes, non-punitive consequences, and a clue recap. The buddy feature pairs players for a fixed choice activity only, with no free-text chat.
- The optional GBV chapter uses non-graphic scenarios to help recognize controlling behavior, harassment, and image-based abuse; practice listening, respecting agency, protecting privacy, and involving trusted adults. It is not counseling, investigation guidance, or a substitute for local specialist support. Players can exit at any time; scenarios do not blame survivors or require confrontation.
- Before public release for minors, complete privacy/child-safety/legal review, consent flow, moderation and safeguarding plans, abuse reporting, rate limits, HTTPS and secure cookies, account recovery/data deletion procedures, database backups, and independent load/security tests. Do not treat a successful build or local simulation as evidence of capacity for 5,000 real users.

## Checks

- `npm test` checks local admission, account sessions, progress validation and duplicate connections.
- `npm run build` type-checks and builds the frontend.
