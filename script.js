import { GoogleGenAI, Type } from "@google/genai";

// --- CONSTANTS ---
const SYNC_CHANNEL = new BroadcastChannel('mafia_paradise_sync');
const GamePhase = {
    IDLE: 'IDLE',
    LOBBY: 'LOBBY',
    REVEAL: 'REVEAL',
    HINTING: 'HINTING',
    VOTING: 'VOTING',
    RESOLUTION: 'RESOLUTION'
};

const Icons = {
    Anchor: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/></svg>`,
    Compass: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    Ship: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.26.59 4.39 1.62 6.22"/><path d="M12 10V2"/><path d="M12 4H7"/></svg>`,
    Shield: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    Skull: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M12 2v2"/><path d="M7 2a5 5 0 0 0-5 5v1"/><path d="M17 2a5 5 0 0 1 5 5v1"/><path d="M2 15h20"/><path d="M2 18h20"/><path d="M5 20a4 4 0 0 0 14 0"/></svg>`,
    Copy: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
};

// --- STATE ---
let myId = sessionStorage.getItem('mafia_player_id') || Math.random().toString(36).substring(2, 10);
sessionStorage.setItem('mafia_player_id', myId);

let gameState = null;

// --- ACTIONS ---
function saveState(newState) {
    gameState = newState;
    localStorage.setItem(`room_${newState.id}`, JSON.stringify(newState));
    SYNC_CHANNEL.postMessage({ type: 'UPDATE', roomId: newState.id, state: newState });
    render();
}

async function handleStart() {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    let wordPair = { innocent: "Shark", mafia: "Dolphin" };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: "Generate a pair of nautical words for a social deduction game. One for 'Innocents' and one for 'Mafia'. Related but distinct. Return JSON.",
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        innocent: { type: Type.STRING },
                        mafia: { type: Type.STRING }
                    },
                    required: ["innocent", "mafia"]
                }
            }
        });
        wordPair = JSON.parse(response.text);
    } catch (e) { console.error("Gemini failed, using fallback.", e); }

    const playerIds = Object.keys(gameState.players);
    const mafiaId = playerIds[Math.floor(Math.random() * playerIds.length)];
    const updatedPlayers = { ...gameState.players };

    playerIds.forEach(id => {
        const isMafia = id === mafiaId;
        updatedPlayers[id].role = isMafia ? 'mafia' : 'innocent';
        updatedPlayers[id].word = isMafia ? wordPair.mafia : wordPair.innocent;
        updatedPlayers[id].votedFor = null;
    });

    saveState({
        ...gameState,
        phase: GamePhase.REVEAL,
        wordPair,
        players: updatedPlayers,
        hints: [],
        currentTurnIndex: 0
    });
}

function handlePostHint() {
    const input = document.getElementById('hint-input');
    const text = input.value.trim();
    if (!text || !gameState) return;

    const playerIds = Object.keys(gameState.players);
    const newHint = {
        playerId: myId,
        playerName: gameState.players[myId].name,
        text,
        timestamp: Date.now()
    };

    const isLast = gameState.currentTurnIndex === playerIds.length - 1;
    saveState({
        ...gameState,
        hints: [...gameState.hints, newHint],
        currentTurnIndex: isLast ? 0 : gameState.currentTurnIndex + 1,
        phase: isLast ? GamePhase.VOTING : GamePhase.HINTING
    });
}

function handleVote(targetId) {
    if (!gameState || targetId === myId) return;
    const players = { ...gameState.players };
    players[myId].votedFor = targetId;

    const allVoted = Object.values(players).every(p => p.votedFor !== null);
    if (allVoted) {
        const tallies = {};
        Object.values(players).forEach(p => tallies[p.votedFor] = (tallies[p.votedFor] || 0) + 1);
        const sorted = Object.entries(tallies).sort((a, b) => b[1] - a[1]);
        const votedOutId = sorted[0][0];
        const winner = players[votedOutId].role === 'mafia' ? 'innocent' : 'mafia';

        saveState({ ...gameState, players, phase: GamePhase.RESOLUTION, winner });
    } else {
        saveState({ ...gameState, players });
    }
}

// --- GLOBAL EXPOSURE FOR DOM EVENTS ---
window.createRoom = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initialState = {
        id,
        phase: GamePhase.LOBBY,
        players: {},
        hints: [],
        currentTurnIndex: 0,
        winner: null,
        wordPair: null,
        maxPlayers: 4
    };
    window.location.hash = id;
    saveState(initialState);
};

window.joinAdventure = () => {
    const nameInput = document.getElementById('name-input');
    const codeInput = document.getElementById('code-input');
    const name = nameInput.value.trim();
    const code = (codeInput.value || window.location.hash.replace('#', '')).toUpperCase();

    if (!name || !code) {
        alert("Enter your name and the room code!");
        return;
    }

    const stored = localStorage.getItem(`room_${code}`);
    if (!stored) {
        alert("Adventure not found!");
        return;
    }

    const state = JSON.parse(stored);
    const players = { ...state.players };

    if (!players[myId]) {
        if (Object.keys(players).length >= state.maxPlayers) {
            alert("This crew is full!");
            return;
        }
        players[myId] = {
            id: myId,
            name: name,
            isHost: Object.keys(players).length === 0,
            role: null,
            word: null,
            votedFor: null,
            isAlive: true
        };
    }

    window.location.hash = code;
    saveState({ ...state, players });
};

window.startGame = handleStart;
window.postHint = handlePostHint;
window.castVote = handleVote;
window.resetGame = () => {
    const players = { ...gameState.players };
    Object.keys(players).forEach(id => {
        players[id].votedFor = null;
        players[id].role = null;
    });
    saveState({ ...gameState, phase: GamePhase.LOBBY, players, hints: [], winner: null, wordPair: null });
};
window.copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Invite link copied!");
};

// --- RENDER ENGINE ---
function render() {
    const root = document.getElementById('app-root');
    const me = gameState?.players?.[myId];

    if (!gameState || !me) {
        root.innerHTML = `
            <div class="w-full max-w-md glass p-8 rounded-3xl space-y-8">
                <h1 class="cinzel text-4xl text-sky-400 font-bold tracking-widest text-center uppercase">Mafia's Paradise</h1>
                <div class="space-y-4">
                    <input id="name-input" type="text" placeholder="Enter Your Sailor Name" class="w-full bg-slate-800 border border-slate-700 rounded-xl py-4 px-6 text-white focus:ring-2 focus:ring-sky-500 outline-none text-lg">
                    <div class="grid grid-cols-2 gap-4">
                        <button onclick="createRoom()" class="bg-sky-600 hover:bg-sky-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg">New Room</button>
                        <input id="code-input" type="text" placeholder="CODE" class="bg-slate-800 border border-slate-700 rounded-xl py-3 px-4 text-center text-sky-400 font-bold focus:ring-2 focus:ring-sky-500 outline-none uppercase" value="${window.location.hash.replace('#', '')}">
                    </div>
                    <button onclick="joinAdventure()" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-4 rounded-xl transition-all shadow-xl text-lg flex items-center justify-center gap-2">
                        ${Icons.Compass} Join Adventure
                    </button>
                </div>
            </div>`;
        return;
    }

    const wrapper = (title, content) => {
        root.innerHTML = `
            <h1 class="cinzel text-3xl md:text-5xl text-sky-400 font-bold mb-6 tracking-widest text-center uppercase">${title}</h1>
            <div class="w-full max-w-md glass p-6 rounded-3xl shadow-2xl relative">
                ${content}
            </div>
            <div class="mt-8 flex flex-col items-center gap-2">
                <div class="text-slate-500 text-sm flex items-center gap-2">
                    ${Icons.Anchor} <span>Room: ${gameState.id}</span>
                </div>
                <button onclick="copyLink()" class="flex items-center gap-2 text-xs text-sky-500 hover:text-sky-400">
                    ${Icons.Copy} Copy Invite Link
                </button>
            </div>`;
    };

    switch (gameState.phase) {
        case GamePhase.LOBBY:
            const playerList = Object.values(gameState.players).map(p => `
                <div class="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl border border-slate-700/30">
                    <span class="flex items-center gap-3">
                        <div class="w-3 h-3 rounded-full ${p.id === myId ? 'bg-amber-400' : 'bg-sky-400'}"></div>
                        <span class="${p.id === myId ? 'font-bold text-amber-400' : ''}">${p.name} ${p.isHost ? '⚓' : ''}</span>
                    </span>
                </div>`).join('');

            wrapper("The Dock", `
                <div class="space-y-6">
                    <h2 class="text-lg font-bold text-sky-400 flex items-center gap-2">${Icons.Ship} Crew (${Object.keys(gameState.players).length}/${gameState.maxPlayers})</h2>
                    <div class="space-y-2 max-h-60 overflow-y-auto pr-2">${playerList}</div>
                    ${me.isHost ? 
                        `<button onclick="startGame()" ${Object.keys(gameState.players).length < 3 ? 'disabled class="w-full bg-slate-700 text-slate-500 cursor-not-allowed"' : 'class="w-full bg-emerald-600 hover:bg-emerald-500 text-white"'} class="font-bold py-4 rounded-xl shadow-xl transition-all">Set Sail (Start)</button>` : 
                        `<div class="text-center p-4 bg-slate-800/20 border border-dashed border-slate-700 rounded-xl text-slate-500 animate-pulse">Waiting for Captain...</div>`
                    }
                </div>`);
            break;

        case GamePhase.REVEAL:
            wrapper("Secret Log", `
                <div class="text-center space-y-8">
                    <p class="text-slate-400 text-sm">Tap the card to reveal your identity.</p>
                    <div onclick="this.querySelector('.card-inner').classList.toggle('card-flipped')" class="relative h-64 w-full cursor-pointer perspective-1000">
                        <div class="card-inner">
                            <div class="absolute inset-0 bg-slate-800 border-4 border-sky-900 rounded-3xl flex flex-col items-center justify-center backface-hidden shadow-2xl">
                                <div class="opacity-20 text-sky-400 scale-[2]">${Icons.Anchor}</div>
                                <span class="cinzel text-slate-600 font-bold uppercase mt-4">Reveal Log</span>
                            </div>
                            <div class="absolute inset-0 bg-gradient-to-br from-sky-600 to-indigo-900 rounded-3xl flex flex-col items-center justify-center backface-hidden rotate-y-180 shadow-2xl border-4 border-amber-400/30">
                                <span class="text-slate-200 text-xs uppercase opacity-70">Your Word</span>
                                <span class="cinzel text-4xl font-black text-white">${me.word}</span>
                                <div class="mt-4 px-4 py-1 bg-white/10 rounded-full text-[10px] uppercase font-bold text-amber-200">${me.role === 'mafia' ? 'You are the Mafia' : 'You are Innocent'}</div>
                            </div>
                        </div>
                    </div>
                    <button onclick="saveState({...gameState, phase: GamePhase.HINTING})" class="w-full bg-slate-800 hover:bg-slate-700 text-sky-400 border border-sky-400/20 font-bold py-4 rounded-xl">I'm Ready</button>
                </div>`);
            break;

        case GamePhase.HINTING:
            const turnId = Object.keys(gameState.players)[gameState.currentTurnIndex];
            const isMyTurn = turnId === myId;
            const hintsHtml = gameState.hints.map(h => `
                <div class="flex flex-col animate-hint-entry ${h.playerId === myId ? 'items-end' : 'items-start'}">
                    <span class="text-[10px] text-slate-500 mb-1">${h.playerName}</span>
                    <div class="p-3 rounded-2xl max-w-[85%] ${h.playerId === myId ? 'bg-sky-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 rounded-tl-none'}">
                        ${h.text}
                    </div>
                </div>`).join('');

            wrapper("Whispers", `
                <div class="flex flex-col h-[450px]">
                    <div class="mb-4 p-3 bg-sky-900/20 rounded-xl border border-sky-500/20 flex items-center justify-between">
                        <span class="text-xs text-sky-400 font-bold">SPEAKER:</span>
                        <span class="text-sm font-bold ${isMyTurn ? 'text-amber-400' : 'text-white'}">${isMyTurn ? "YOU" : gameState.players[turnId].name}</span>
                    </div>
                    <div id="hint-scroll" class="flex-grow overflow-y-auto space-y-4 mb-4 pr-2 custom-scrollbar">${hintsHtml}</div>
                    <div class="mt-auto pt-4 border-t border-slate-800">
                        ${isMyTurn ? `
                            <div class="flex gap-2">
                                <input id="hint-input" type="text" placeholder="Speak carefully..." class="flex-grow bg-slate-800 border border-slate-700 rounded-xl p-3 text-white outline-none" onkeydown="if(event.key==='Enter') postHint()">
                                <button onclick="postHint()" class="bg-sky-500 hover:bg-sky-400 text-white px-4 rounded-xl">Send</button>
                            </div>` : 
                            `<div class="text-center text-slate-500 italic text-sm animate-pulse">Listening to ${gameState.players[turnId].name}...</div>`
                        }
                    </div>
                </div>`);
            
            // Scroll to bottom
            const scroll = document.getElementById('hint-scroll');
            if (scroll) scroll.scrollTop = scroll.scrollHeight;
            break;

        case GamePhase.VOTING:
            const voteOptions = Object.values(gameState.players).map(p => `
                <button onclick="castVote('${p.id}')" ${p.id === myId || me.votedFor !== null ? 'disabled' : ''} 
                    class="relative w-full p-4 rounded-2xl border transition-all flex items-center justify-between
                    ${p.id === myId ? 'bg-slate-800/20 border-slate-800 text-slate-600' : 'hover:scale-[1.02]'}
                    ${me.votedFor === p.id ? 'bg-rose-900/30 border-rose-500 text-white shadow-xl' : 'bg-slate-800 border-slate-700 text-slate-300'}
                    ${me.votedFor !== null && me.votedFor !== p.id ? 'opacity-40 grayscale' : ''}">
                    <span class="font-semibold">${p.name} ${p.id === myId ? '(You)' : ''}</span>
                    ${me.votedFor === p.id ? Icons.Shield : ''}
                </button>`).join('');

            wrapper("The Gallows", `
                <div class="space-y-4">
                    <p class="text-center text-slate-400 text-sm mb-4">Identify the Impostor. Cast your vote.</p>
                    <div class="grid grid-cols-1 gap-3">${voteOptions}</div>
                </div>`);
            break;

        case GamePhase.RESOLUTION:
            const win = gameState.winner === me.role;
            const revealList = Object.values(gameState.players).map(p => `
                <div class="flex justify-between items-center text-sm py-1 border-b border-slate-700/50 last:border-0">
                    <span>${p.name}</span>
                    <span class="text-[10px] px-2 py-0.5 rounded ${p.role==='mafia'?'bg-rose-900 text-rose-300':'bg-sky-900 text-sky-300'}">${p.role.toUpperCase()}</span>
                </div>`).join('');

            wrapper(gameState.winner === 'mafia' ? "Mafia Wins!" : "Innocents Win!", `
                <div class="text-center space-y-6">
                    <div class="p-8 rounded-full inline-flex items-center justify-center ${win ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">
                        <div class="scale-[3]">${gameState.winner === 'mafia' ? Icons.Skull : Icons.Shield}</div>
                    </div>
                    <div class="space-y-2">
                        <h3 class="text-2xl font-bold cinzel">${win ? "VICTORY!" : "DEFEAT!"}</h3>
                        <p class="text-slate-400">Words: <span class="text-sky-400">${gameState.wordPair.innocent}</span> vs <span class="text-rose-400">${gameState.wordPair.mafia}</span></p>
                    </div>
                    <div class="bg-slate-800/50 p-4 rounded-2xl border border-slate-700 space-y-2">${revealList}</div>
                    ${me.isHost ? `<button onclick="resetGame()" class="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold py-4 rounded-xl shadow-xl">New Journey</button>` : ''}
                </div>`);
            break;
    }
}

// --- SYNC LISTENERS ---
SYNC_CHANNEL.onmessage = (event) => {
    if (event.data.type === 'UPDATE' && (!gameState || event.data.roomId === gameState.id)) {
        gameState = event.data.state;
        render();
    }
};

// Initial load check
const initialHash = window.location.hash.replace('#', '');
if (initialHash) {
    const stored = localStorage.getItem(`room_${initialHash}`);
    if (stored) {
        gameState = JSON.parse(stored);
    }
}

// First render
render();