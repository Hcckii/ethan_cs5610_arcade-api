# arcade-api

The backend for the Battleship game in the Arcade. Built with Node, Hono and MongoDB.

The SvelteKit app is the only client of this API: the browser never calls it directly.

## Running locally

```bash
npm install
npm run dev
```

Create a `.env` file in the project root (it is not committed):

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/
```

On Render, set `MONGODB_URI` as an environment variable. Render also sets `PORT`.

End-to-end test (with the server running):

```bash
node scripts/e2e.js
```

## Authentication

`POST /api/auth/login` returns a session `token`. The SvelteKit server stores it in its own cookie and sends it on every request:

```
Authorization: Bearer <token>
```

Sessions are stored in MongoDB and expire after 7 days. Logging out deletes the session, so the token stops working immediately.

## Errors

Every error response has the same shape:

```json
{ "error": "A message describing what went wrong" }
```

| Status | Meaning |
|---|---|
| 400 | The request body or input is invalid |
| 401 | No valid session (not logged in) |
| 403 | Logged in, but not allowed to do this |
| 404 | The game or path does not exist |
| 409 | The input clashes with the current state of the game or account |
| 500 | Unexpected server error (handled by `app.onError`) |

## Endpoints

### `POST /api/auth/signup`

Create an account. The email is stored in lowercase and must be unique. The password is hashed with bcrypt.

Body:

```json
{ "email": "ethan@example.com", "password": "secret123" }
```

| Status | When |
|---|---|
| 201 | Created. Returns `{ id, email }` |
| 400 | Body is not JSON, email has no `@`, or password is shorter than 6 characters |
| 409 | Email already registered |

### `POST /api/auth/login`

Body: same as signup.

| Status | When |
|---|---|
| 200 | Returns `{ token, expiresAt, user: { id, email } }` |
| 400 | Body is not JSON or is missing email or password |
| 401 | Email not found or wrong password (same message for both) |

### `POST /api/auth/logout`

Ends the current session. Always succeeds, even without a token.

| Status | When |
|---|---|
| 200 | Returns `{ message }` |

### `GET /api/auth/me`

| Status | When |
|---|---|
| 200 | Returns `{ id, email }` |
| 401 | No valid session |

### `GET /api/games`

Lists games for the logged-in user. Boards are never included.

| Status | When |
|---|---|
| 200 | Returns `{ waiting: [...], mine: [...] }` |
| 401 | No valid session |

- `waiting`: games waiting for a second player, not created by this user
- `mine`: games this user is playing in

Each item:

```json
{
  "id": "6741c2d3...",
  "status": "waiting",
  "players": { "p1": "ethan@example.com", "p2": null },
  "vsAi": false,
  "turn": "p1",
  "winner": null,
  "createdAt": "2026-11-20T18:00:00.000Z"
}
```

### `POST /api/games`

Creates a game. Both fleets are placed randomly on the server. The creator is `p1` and moves first.

| Status | When |
|---|---|
| 201 | Returns the game, as seen by `p1` |
| 401 | No valid session |

### `GET /api/games/:id`

Returns one game, with the opponent's ships left out.

| Status | When |
|---|---|
| 200 | A player gets their own view. Anyone, logged in or not, can view a finished game |
| 401 | Not logged in, and the game is not over |
| 403 | Logged in but not a player, and the game is not over |
| 404 | Invalid id or no such game |

A player's view:

```json
{
  "id": "6741c2d3...",
  "status": "playing",
  "players": { "p1": "ethan@example.com", "p2": "amy@example.com" },
  "turn": "p1",
  "winner": null,
  "you": "p1",
  "myBoard": [[{ "ship": "carrier", "shot": null }, "..."], "..."],
  "opponentBoard": [[{ "ship": null, "shot": "hit" }, "..."], "..."],
  "mySunk": [],
  "opponentSunk": ["destroyer"]
}
```

`opponentBoard` shows every shot, but a cell's `ship` is only filled in once that ship is sunk.

A finished game seen by someone who is not a player has `"you": null` and shows both full boards as `boards: { p1, p2 }` with `sunk: { p1, p2 }`.

### `POST /api/games/:id/players`

Join a waiting game as the second player. The game starts right away.

Body (optional):

```json
{ "ai": true }
```

With `"ai": true`, the player who created the game makes the AI the second player instead (extra credit: AI opponent). Nobody else can join that game. The AI's moves are decided only on the server.

| Status | When |
|---|---|
| 201 | Returns the game, as seen by the player who joined (or by `p1` when challenging the AI) |
| 400 | Body is not JSON, or `ai` is not a boolean |
| 401 | No valid session |
| 403 | Challenging the AI in a game you did not create |
| 404 | Invalid id or no such game |
| 409 | Joining your own game, or the game already has two players |

### `POST /api/games/:id/shots`

Fire at a square on the opponent's board. `x` is the column and `y` is the row, both from 0 to 9.

Body:

```json
{ "x": 3, "y": 5 }
```

| Status | When |
|---|---|
| 201 | Returns `{ hit, sunk, gameOver, aiShot, game }`. `sunk` is the ship's name when this shot sank it, otherwise `null`. In a game against the AI, `aiShot` is `{ x, y, hit, sunk }` for the AI's reply, otherwise `null` |
| 400 | Body is not JSON, or `x` / `y` are not integers from 0 to 9 |
| 401 | No valid session |
| 403 | Not a player in this game |
| 404 | Invalid id or no such game |
| 409 | No second player yet, the game is over, it is not your turn, the square was already fired at, or the game changed since it was loaded |

## Data stored in MongoDB

- `users`: `{ email, passwordHash, createdAt }`, with a unique index on `email`
- `sessions`: `{ token, userId, email, expiresAt }`, deleted automatically after `expiresAt`
- `games`: `{ status, players, boards, turn, winner, moves, createdAt, updatedAt }`, plus `aiQueue` (the AI's shuffled firing order) in games against the AI. `aiQueue` is never sent to the client

Each board is a 10x10 array of `{ ship, shot }` cells, created and updated with the functions in `@ethanhua/arcade-core`.