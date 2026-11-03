import { BOT_STYLES, NAME_MAX, REACTIONS, type BotStyle, type ClientMessage } from '@salvage-rights/engine';
import { z } from 'zod';

/** Identity ids and secrets are client-generated, lowercase alphanumerics. */
export const IdSchema = z.string().regex(/^[a-z0-9]{8,32}$/, 'invalid id');
export const SecretSchema = z.string().regex(/^[a-z0-9]{16,64}$/, 'invalid secret');
export const RoomCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{4,8}$/, 'invalid room code');
export const NameSchema = z.string().max(NAME_MAX * 4); // sanitized further by the engine
export const ChoiceSchema = z.enum(['collect', 'steal']);
export const BotStyleSchema = z.enum(BOT_STYLES as unknown as [BotStyle, ...BotStyle[]]);

export const SettingsPatchSchema = z.object({
  timerSeconds: z.number().int().min(0).max(180).optional(),
  revealSeconds: z.number().int().min(0).max(60).optional(),
  isPublic: z.boolean().optional(),
});

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), id: IdSchema, secret: SecretSchema, name: NameSchema, spectate: z.boolean().optional() }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('settings'), patch: SettingsPatchSchema }),
  z.object({ t: z.literal('addBot'), style: BotStyleSchema.optional() }),
  z.object({ t: z.literal('removePlayer'), playerId: z.string().min(1).max(64) }),
  z.object({ t: z.literal('choose'), choice: ChoiceSchema }),
  z.object({ t: z.literal('next') }),
  z.object({ t: z.literal('fixer') }),
  z.object({ t: z.literal('rematch'), vote: z.boolean().optional(), force: z.boolean().optional() }),
  z.object({ t: z.literal('lobby') }),
  z.object({ t: z.literal('react'), emoji: z.enum(REACTIONS as unknown as [string, ...string[]]) }),
  z.object({ t: z.literal('rename'), name: NameSchema }),
  z.object({ t: z.literal('ping') }),
]);

export type ParsedClientMessage = z.infer<typeof ClientMessageSchema>;

// The schema must describe exactly the engine's protocol type; this line fails to compile if they drift.
const _check: ClientMessage = null as unknown as ParsedClientMessage;
void _check;

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; code: 'bad_json' | 'bad_message'; message: string };

export const MAX_MESSAGE_BYTES = 4096;

/** Parse and validate one raw WebSocket frame. Never throws. */
export function parseClientMessage(raw: unknown): ParseResult {
  if (typeof raw !== 'string') return { ok: false, code: 'bad_message', message: 'Binary frames are not accepted.' };
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, code: 'bad_message', message: 'Message too large.' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'bad_json', message: 'Malformed message.' };
  }
  const result = ClientMessageSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    return { ok: false, code: 'bad_message', message: `Invalid message${where}: ${issue?.message ?? 'unknown'}` };
  }
  return { ok: true, msg: result.data as ClientMessage };
}

export const CreateRoomBodySchema = z.object({ settings: SettingsPatchSchema.optional() });
