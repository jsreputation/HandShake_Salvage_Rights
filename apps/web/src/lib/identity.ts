import { randomId } from '@salvage-rights/engine';

export interface Identity {
  id: string;
  secret: string;
  name: string;
}

const KEY = 'salvage-rights:identity';

export function loadIdentity(): Identity {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (parsed.id && parsed.secret) return { id: parsed.id, secret: parsed.secret, name: parsed.name ?? '' };
    }
  } catch {
    /* storage unavailable: fall through to a fresh identity */
  }
  const fresh: Identity = { id: randomId(16), secret: randomId(32), name: '' };
  saveIdentity(fresh);
  return fresh;
}

export function saveIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* ignore */
  }
}

export function setName(name: string): Identity {
  const id = loadIdentity();
  const next = { ...id, name };
  saveIdentity(next);
  return next;
}
