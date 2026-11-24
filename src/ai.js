import { battleship } from "@ethanhua/arcade-core";

export const AI_PLAYER = { id: "ai", email: "AI opponent", ai: true };

export function isAiPlayer(player) {
    return player !== null && player.ai === true;
}

function allCoords() {
    const res = [];
    for (let y = 0; y < battleship.BOARD_SIZE; y++) {
        for (let x = 0; x < battleship.BOARD_SIZE; x++) {
            res.push([x, y]);
        }
    }
    return res;
}

function shuffle(arr, random) {
    const res = [...arr];
    for (let i = res.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [res[i], res[j]] = [res[j], res[i]];
    }
    return res;
}

export function createAiQueue(random = Math.random) {
    return shuffle(allCoords(), random);
}

export function nextAiShot(board, queue) {
    const rest = [...queue];
    while (rest.length > 0) {
        const [x, y] = rest.pop();
        if (battleship.isValidShot(board, x, y)) {
            return { x, y, queue: rest };
        }
    }
    return null;
}