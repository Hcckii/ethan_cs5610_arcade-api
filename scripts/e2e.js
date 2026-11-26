// End-to-end test for arcade-api.
// Start the server first (npm run dev), then in another terminal run: node scripts/e2e.js
// The token is sent as "Authorization: Bearer <token>", the same way the SvelteKit server will send it.

const BASE = "http://localhost:3000/api";

let passed = 0;
let failed = 0;

function check(label, condition) {
    if (condition) {
        passed++;
        console.log(`PASS - ${label}`);
    } else {
        failed++;
        console.log(`FAIL - ${label}`);
    }
}

async function request(method, path, { token, body } = {}) {
    const headers = {};
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { status: res.status, data };
}

async function createUser(name) {
    const email = `${name}+${Date.now()}@test.com`;
    const password = "secret123";
    const signup = await request("POST", "/auth/signup", { body: { email, password } });
    check(`${name} signs up (201)`, signup.status === 201 && !("passwordHash" in signup.data));
    const login = await request("POST", "/auth/login", { body: { email, password } });
    check(`${name} logs in (200)`, login.status === 200 && typeof login.data.token === "string");
    return login.data.token;
}

function allCoords() {
    const res = [];
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            res.push([x, y]);
        }
    }
    return res;
}

function shuffle(arr) {
    const res = [...arr];
    for (let i = res.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [res[i], res[j]] = [res[j], res[i]];
    }
    return res;
}

// The opponent board may only show ships that are already sunk
function leaksShips(view) {
    return view.opponentBoard.flat().some((cell) => cell.ship !== null && !view.opponentSunk.includes(cell.ship));
}

// Confirm the fleet the server placed randomly
async function confirmFleet(token, gameId) {
    const view = await request("GET", `/games/${gameId}`, { token });
    return request("POST", `/games/${gameId}/ships`, { token, body: { ships: view.data.myFleet } });
}

//==================== Accounts ====================

const ethan = await createUser("ethan");
const amy = await createUser("amy");
const bob = await createUser("bob");

const dupEmail = `dup+${Date.now()}@test.com`;
await request("POST", "/auth/signup", { body: { email: dupEmail, password: "secret123" } });
const dup = await request("POST", "/auth/signup", { body: { email: dupEmail.toUpperCase(), password: "secret123" } });
check("duplicate email returns 409", dup.status === 409);

const badSignup = await request("POST", "/auth/signup", { body: { email: "no-at-sign", password: "secret123" } });
check("invalid email returns 400", badSignup.status === 400);

const wrongPassword = await request("POST", "/auth/login", { body: { email: dupEmail, password: "wrong-password" } });
check("wrong password returns 401", wrongPassword.status === 401);

const me = await request("GET", "/auth/me", { token: ethan });
check("GET /auth/me returns the user (200)", me.status === 200 && me.data.email.startsWith("ethan"));

const meNoAuth = await request("GET", "/auth/me");
check("GET /auth/me without a token returns 401", meNoAuth.status === 401);

//==================== Create and join ====================

const noAuth = await request("POST", "/games");
check("creating a game without logging in returns 401", noAuth.status === 401);

const created = await request("POST", "/games", { token: ethan });
check("ethan creates a game (201)", created.status === 201 && created.data.status === "waiting");
const id = created.data.id;
check("the new game already has ethan's fleet placed", created.data.myBoard.flat().filter((c) => c.ship !== null).length === 17);
check("the new game does not leak the other fleet", !leaksShips(created.data));

const secondGame = await request("POST", "/games", { token: ethan });
check("a user can be in a second game (201)", secondGame.status === 201);
const thirdGame = await request("POST", "/games", { token: ethan });
check("a user cannot be in a third active game (409)", thirdGame.status === 409);
const freeSlot = await request("DELETE", `/games/${secondGame.data.id}/players/me`, { token: ethan });
check("leaving a waiting game frees a slot (200)", freeSlot.status === 200 && freeSlot.data.deleted === true);

const listForAmy = await request("GET", "/games", { token: amy });
check("amy sees the game in waiting (200)", listForAmy.status === 200 && listForAmy.data.waiting.some((g) => g.id === id));
check("the game list has no boards", !JSON.stringify(listForAmy.data).includes("boards"));

const listForEthan = await request("GET", "/games", { token: ethan });
check("ethan sees his game in mine, not in waiting", listForEthan.data.mine.some((g) => g.id === id) && !listForEthan.data.waiting.some((g) => g.id === id));

const earlyShot = await request("POST", `/games/${id}/shots`, { token: ethan, body: { x: 0, y: 0 } });
check("cannot fire before a second player joins (409)", earlyShot.status === 409);

const selfJoin = await request("POST", `/games/${id}/players`, { token: ethan });
check("ethan cannot join his own game (409)", selfJoin.status === 409);

const join = await request("POST", `/games/${id}/players`, { token: amy });
check("amy joins as p2 (201)", join.status === 201 && join.data.you === "p2" && join.data.status === "placing");

const bobJoin = await request("POST", `/games/${id}/players`, { token: bob });
check("bob cannot join a full game (409)", bobJoin.status === 409);

const bobView = await request("GET", `/games/${id}`, { token: bob });
check("bob cannot see a game in progress (403)", bobView.status === 403);

const visitorView = await request("GET", `/games/${id}`);
check("a logged-out visitor cannot see a game in progress (401)", visitorView.status === 401);

const notFound = await request("GET", "/games/banana", { token: ethan });
check("invalid game id returns 404", notFound.status === 404);

const unknownPath = await request("GET", "/nothing-here");
check("unknown path returns 404 JSON", unknownPath.status === 404 && typeof unknownPath.data.error === "string");

//==================== Placing ships (extra credit) ====================

const placingShot = await request("POST", `/games/${id}/shots`, { token: ethan, body: { x: 0, y: 0 } });
check("cannot fire while ships are being placed (409)", placingShot.status === 409);

const customFleet = [
    { name: "carrier", x: 0, y: 0, direction: "horizontal" },
    { name: "battleship", x: 0, y: 2, direction: "horizontal" },
    { name: "cruiser", x: 0, y: 4, direction: "horizontal" },
    { name: "submarine", x: 0, y: 6, direction: "horizontal" },
    { name: "destroyer", x: 9, y: 0, direction: "vertical" },
];

const overlap = await request("POST", `/games/${id}/ships`, {
    token: ethan,
    body: { ships: customFleet.map((ship) => (ship.name === "battleship" ? { ...ship, y: 0, x: 3 } : ship)) },
});
check("overlapping ships are rejected (400)", overlap.status === 400);

const offBoard = await request("POST", `/games/${id}/ships`, {
    token: ethan,
    body: { ships: customFleet.map((ship) => (ship.name === "carrier" ? { ...ship, x: 7 } : ship)) },
});
check("a ship off the board is rejected (400)", offBoard.status === 400);

const missing = await request("POST", `/games/${id}/ships`, { token: ethan, body: { ships: customFleet.slice(0, 4) } });
check("a fleet with a missing ship is rejected (400)", missing.status === 400);

const duplicate = await request("POST", `/games/${id}/ships`, {
    token: ethan,
    body: { ships: [...customFleet.slice(0, 4), { ...customFleet[0], y: 8 }] },
});
check("a fleet with a duplicate ship is rejected (400)", duplicate.status === 400);

const placed = await request("POST", `/games/${id}/ships`, { token: ethan, body: { ships: customFleet } });
check(
    "ethan places his own fleet (201)",
    placed.status === 201 &&
        placed.data.ready.you === true &&
        placed.data.myBoard[0].slice(0, 5).every((cell) => cell.ship === "carrier") &&
        placed.data.myBoard[1][9].ship === "destroyer"
);

const placeAgain = await request("POST", `/games/${id}/ships`, { token: ethan, body: { ships: customFleet } });
check("cannot place ships twice (409)", placeAgain.status === 409);

const bobPlaces = await request("POST", `/games/${id}/ships`, { token: bob, body: { ships: customFleet } });
check("a non-player cannot place ships (403)", bobPlaces.status === 403);

const amyReady = await confirmFleet(amy, id);
check("amy keeps her random fleet and the game starts (201)", amyReady.status === 201 && amyReady.data.status === "playing");

const lateMove = await request("POST", `/games/${id}/ships`, { token: amy, body: { ships: customFleet } });
check("cannot move ships after the game has started (409)", lateMove.status === 409);

//==================== Shots ====================

const wrongTurn = await request("POST", `/games/${id}/shots`, { token: amy, body: { x: 0, y: 0 } });
check("amy cannot fire on ethan's turn (409)", wrongTurn.status === 409);

const outOfBounds = await request("POST", `/games/${id}/shots`, { token: ethan, body: { x: 10, y: 0 } });
check("out of bounds shot returns 400", outOfBounds.status === 400);

const badBody = await request("POST", `/games/${id}/shots`, { token: ethan, body: { x: "a", y: 0 } });
check("non-integer shot returns 400", badBody.status === 400);

const bobShot = await request("POST", `/games/${id}/shots`, { token: bob, body: { x: 0, y: 0 } });
check("a non-player cannot fire (403)", bobShot.status === 403);

const players = {
    p1: { name: "ethan", token: ethan, coords: shuffle(allCoords()) },
    p2: { name: "amy", token: amy, coords: shuffle(allCoords()) },
};
let turn = "p1";
let status = "playing";
let shots = 0;
let unexpected = 0;
let leaked = false;
let repeatChecked = false;

while (status !== "finished" && shots < 200) {
    const shooter = players[turn];
    const [x, y] = shooter.coords.pop();
    const shot = await request("POST", `/games/${id}/shots`, { token: shooter.token, body: { x, y } });
    shots++;

    if (shot.status !== 201) {
        unexpected++;
        console.log(`  unexpected ${shot.status} on shot ${shots}:`, shot.data);
        break;
    }
    if (leaksShips(shot.data.game)) {
        leaked = true;
    }
    if (shot.data.sunk) {
        console.log(`  ${shooter.name} sunk the enemy's ${shot.data.sunk}`);
    }

    // Once: after ethan's first shot, amy replies, then ethan fires at his first square again
    if (!repeatChecked && turn === "p1") {
        const [ax, ay] = players.p2.coords.pop();
        const reply = await request("POST", `/games/${id}/shots`, { token: amy, body: { x: ax, y: ay } });
        shots++;
        if (reply.status !== 201) {
            unexpected++;
            console.log(`  unexpected ${reply.status} on amy's reply:`, reply.data);
            break;
        }
        const repeat = await request("POST", `/games/${id}/shots`, { token: ethan, body: { x, y } });
        check("firing at the same square twice returns 409", repeat.status === 409);
        repeatChecked = true;
        turn = reply.data.game.turn;
        status = reply.data.game.status;
        continue;
    }

    turn = shot.data.game.turn;
    status = shot.data.game.status;
}

check("every shot during the game returns 201", unexpected === 0);
check("no shot response leaks the opponent's ships", !leaked);
check("the game finishes", status === "finished");

if (status !== "finished") {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
}

//==================== After the game ====================

const final = await request("GET", `/games/${id}`, { token: ethan });
const winner = final.data.winner;
check("a winner is set", winner === "p1" || winner === "p2");

const afterEnd = await request("POST", `/games/${id}/shots`, { token: players[winner].token, body: { x: 0, y: 0 } });
check("cannot fire after the game is over (409)", afterEnd.status === 409);

const visitorAfter = await request("GET", `/games/${id}`);
check("a logged-out visitor can view the finished game (200)", visitorAfter.status === 200 && visitorAfter.data.you === null);

const bobAfter = await request("GET", `/games/${id}`, { token: bob });
check("a non-player can view the finished game (200)", bobAfter.status === 200);

//==================== AI opponent ====================

const aiGame = await request("POST", "/games", { token: amy });
const aiId = aiGame.data.id;

const bobChallenges = await request("POST", `/games/${aiId}/players`, { token: bob, body: { ai: true } });
check("only the creator can challenge the AI (403)", bobChallenges.status === 403);

const badAiBody = await request("POST", `/games/${aiId}/players`, { token: amy, body: { ai: "yes" } });
check("ai must be a boolean (400)", badAiBody.status === 400);

const challenge = await request("POST", `/games/${aiId}/players`, { token: amy, body: { ai: true } });
check("amy challenges the AI (201)", challenge.status === 201 && challenge.data.vsAi === true && challenge.data.status === "placing");
const amyAiReady = await confirmFleet(amy, aiId);
check("the AI game starts once amy confirms her fleet", amyAiReady.status === 201 && amyAiReady.data.status === "playing");

const bobJoinsAi = await request("POST", `/games/${aiId}/players`, { token: bob });
check("nobody can join a game against the AI (409)", bobJoinsAi.status === 409);

const aiInList = await request("GET", "/games", { token: bob });
check("a game against the AI is not in the waiting list", !aiInList.data.waiting.some((g) => g.id === aiId));

let aiStatus = "playing";
let aiShots = 0;
let aiTurnsOk = true;
let aiAnswered = true;
let aiReplies = 0;
const amyCoords = shuffle(allCoords());
let lastView = null;
while (aiStatus !== "finished" && amyCoords.length > 0) {
    const [x, y] = amyCoords.pop();
    const shot = await request("POST", `/games/${aiId}/shots`, { token: amy, body: { x, y } });
    if (shot.status !== 201) {
        aiTurnsOk = false;
        console.log(`  unexpected ${shot.status} in the AI game:`, shot.data);
        break;
    }
    aiShots++;
    lastView = shot.data.game;
    aiStatus = lastView.status;
    if (aiStatus === "playing" && lastView.turn !== "p1") {
        aiTurnsOk = false;
    }
    if (shot.data.aiShot !== null) {
        aiReplies++;
    } else if (!shot.data.gameOver) {
        aiAnswered = false;
    }
}
const amyShotsTaken = lastView.myBoard.flat().filter((cell) => cell.shot !== null).length;
check("the AI fires back after every shot", aiAnswered);
check("it is always the human's turn during an AI game", aiTurnsOk);
check("the AI game finishes", aiStatus === "finished");
// Every AI reply must land on a new square, so amy's board has exactly one shot per reply
check("the AI never fires at the same square twice", amyShotsTaken === aiReplies);
check("the AI game response does not include the AI's queue", !JSON.stringify(lastView).includes("aiQueue"));
console.log(`  AI game: winner ${lastView.winner === "p1" ? "amy" : "AI"} after ${aiShots} of amy's shots`);

const myGames = await request("GET", "/games", { token: amy });
check("a finished game stays in the list", myGames.status === 200 && myGames.data.mine.some((g) => g.id === id && g.status === "finished"));

//==================== Leaving games and the active game limit ====================

const gameA = await request("POST", "/games", { token: ethan });
check("after a game finishes, the player has a free slot again (201)", gameA.status === 201);
const idA = gameA.data.id;

const bobLeaves = await request("DELETE", `/games/${idA}/players/me`, { token: bob });
check("a non-player cannot leave a game (403)", bobLeaves.status === 403);

const leaveA = await request("DELETE", `/games/${idA}/players/me`, { token: ethan });
check("leaving a waiting game deletes it (200)", leaveA.status === 200 && leaveA.data.deleted === true);
const goneA = await request("GET", `/games/${idA}`, { token: ethan });
check("the deleted game is gone (404)", goneA.status === 404);

const gameB = await request("POST", "/games", { token: ethan });
const idB = gameB.data.id;
await request("POST", `/games/${idB}/players`, { token: bob });
const forfeit = await request("DELETE", `/games/${idB}/players/me`, { token: bob });
check(
    "leaving a game in progress forfeits it (200)",
    forfeit.status === 200 &&
        forfeit.data.game.status === "finished" &&
        forfeit.data.game.winner === "p1" &&
        forfeit.data.game.forfeitedBy === "p2"
);
const leaveFinished = await request("DELETE", `/games/${idB}/players/me`, { token: ethan });
check("cannot leave a game that is already over (409)", leaveFinished.status === 409);
const ethanList = await request("GET", "/games", { token: ethan });
check("the forfeited game stays in the list as finished", ethanList.data.mine.some((g) => g.id === idB && g.status === "finished"));

// bob fills both of his slots
const bobC = await request("POST", "/games", { token: bob });
const bobD = await request("POST", "/games", { token: bob });
check("bob creates two games (201, 201)", bobC.status === 201 && bobD.status === 201);
const bobE = await request("POST", "/games", { token: bob });
check("bob cannot create a third (409)", bobE.status === 409);

const gameF = await request("POST", "/games", { token: ethan });
const bobJoinFull = await request("POST", `/games/${gameF.data.id}/players`, { token: bob });
check("bob cannot join another game while he has two (409)", bobJoinFull.status === 409);

await request("DELETE", `/games/${bobC.data.id}/players/me`, { token: bob });
const bobJoinNow = await request("POST", `/games/${gameF.data.id}/players`, { token: bob });
check("after leaving one, bob can join (201)", bobJoinNow.status === 201);

const ethanChallenges = await request("POST", "/games", { token: ethan });
const aiNoSlot = await request("POST", `/games/${ethanChallenges.data.id}/players`, { token: ethan, body: { ai: true } });
check("challenging the AI does not use another slot (201)", aiNoSlot.status === 201);

//==================== Logout ====================

const logout = await request("POST", "/auth/logout", { token: ethan });
check("ethan logs out (200)", logout.status === 200);

const meAfter = await request("GET", "/auth/me", { token: ethan });
check("the old token no longer works after logout (401)", meAfter.status === 401);

console.log(`\nWinner: ${players[winner].name}, total shots: ${shots}`);
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;