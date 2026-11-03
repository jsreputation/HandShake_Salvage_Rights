export type Choice = 'collect' | 'steal';

export type Phase = 'lobby' | 'choosing' | 'reveal' | 'finished';

export type Outcome = 'clean' | 'doublecross' | 'scramble' | 'standoff';

export type BotStyle = 'saint' | 'opportunist' | 'grudge' | 'wildcard' | 'shark';

export const TOTAL_ROUNDS = 8;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Base haul for each derelict (round). All multiples of 60 so every split is an integer. */
export const BASE_TAKES: readonly number[] = [120, 120, 180, 180, 240, 240, 360, 480];

/** The eight derelicts, in the order the crew reaches them. */
export const JOB_NAMES: readonly string[] = [
  'Drifter Pod',
  'Supply Hull',
  'The Coldstar',
  'Survey Barge',
  'The Meridian',
  'Reactor Frame',
  'The Leviathan',
  'The Mother Lode',
];

export interface Settings {
  /** Seconds players have to choose. 0 = no timer. */
  timerSeconds: number;
  /** Seconds the reveal is shown before the next job starts automatically. 0 = wait for host. */
  revealSeconds: number;
  /** Whether the room is listed in the public directory. */
  isPublic: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timerSeconds: 40,
  revealSeconds: 10,
  isPublic: false,
};

export interface Player {
  id: string;
  name: string;
  seat: number;
  isBot: boolean;
  botStyle?: BotStyle;
  connected: boolean;
  score: number;
  steals: number;
  /** Secret choice for the current job. Never leaves the server except to its owner. */
  choice: Choice | null;
  rematchVote: boolean;
  joinedAt: number;
}

export interface RoundResult {
  round: number;
  jobName: string;
  base: number;
  carryIn: number;
  pot: number;
  choices: Record<string, Choice>;
  outcome: Outcome;
  deltas: Record<string, number>;
  carryOut: number;
  timedOut: string[];
  narration: string;
}

export interface GameState {
  code: string;
  seed: string;
  phase: Phase;
  /** 1..8 while playing, 0 in the lobby. Stays at 8 when finished. */
  round: number;
  players: Player[];
  hostId: string | null;
  history: RoundResult[];
  carry: number;
  settings: Settings;
  /** 1 for the first game in the room, incremented by rematches. */
  gameNumber: number;
  /** Series wins per player id (kept across rematches). */
  series: Record<string, number>;
  winners: string[];
  /** Epoch ms when the current phase auto-advances, or null. */
  deadline: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FixerRead {
  playerId: string;
  name: string;
  stealRate: number;
  steals: number;
  rounds: number;
  lastChoice: Choice | null;
  note: string;
}

export interface FixerAdvice {
  round: number;
  recommendation: Choice;
  confidence: number;
  headline: string;
  reasoning: string[];
  reads: FixerRead[];
  /** 'heuristic' or the model id that produced the advice. */
  source: string;
}

export interface PlayerPublic {
  id: string;
  name: string;
  seat: number;
  isBot: boolean;
  botStyle?: BotStyle;
  connected: boolean;
  isHost: boolean;
  score: number;
  steals: number;
  locked: boolean;
  rematchVote: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  round: number;
  totalRounds: number;
  jobName: string;
  baseTake: number;
  carry: number;
  pot: number;
  players: PlayerPublic[];
  spectators: number;
  history: RoundResult[];
  settings: Settings;
  gameNumber: number;
  series: Record<string, number>;
  winners: string[];
  deadline: number | null;
  now: number;
  me: {
    id: string;
    role: 'player' | 'spectator';
    choice: Choice | null;
    fixer: FixerAdvice | null;
  } | null;
  report: string | null;
}

export class GameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'GameError';
  }
}
