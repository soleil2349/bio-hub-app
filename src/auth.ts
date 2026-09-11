/**
 * Auth session store — persists a JWT access token + basic user info
 * to AsyncStorage and lets the rest of the app subscribe to changes.
 *
 * Kept intentionally lean: the actual login/register HTTP calls live in
 * ``src/api.ts`` and they push the resulting session in here via
 * ``setSession``.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/* ─── Types ─── */

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string | null;
  isAdmin: boolean;
  createdAt: number;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: number; // epoch ms — client-side hint only
}

type Listener = (s: AuthSession | null) => void;

/* ─── Constants ─── */

const STORAGE_KEY = '@biohub_auth_v1';

/* ─── Store ─── */

class AuthStore {
  private session: AuthSession | null = null;
  private listeners = new Set<Listener>();
  private loaded = false;

  async init(): Promise<AuthSession | null> {
    if (this.loaded) return this.session;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AuthSession;
        // Treat expired token as logged-out (avoid hitting server with dead JWT).
        if (parsed.expiresAt > Date.now()) {
          this.session = parsed;
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {}
    this.loaded = true;
    return this.session;
  }

  getSession(): AuthSession | null {
    return this.session;
  }

  isAuthenticated(): boolean {
    return this.session != null && this.session.expiresAt > Date.now();
  }

  getToken(): string | null {
    return this.isAuthenticated() ? this.session!.token : null;
  }

  getUser(): AuthUser | null {
    return this.session?.user ?? null;
  }

  async setSession(session: AuthSession): Promise<void> {
    this.session = session;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.emit();
  }

  async updateUser(user: AuthUser): Promise<void> {
    if (!this.session) return;
    this.session = { ...this.session, user };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    this.emit();
  }

  async clear(): Promise<void> {
    this.session = null;
    await AsyncStorage.removeItem(STORAGE_KEY);
    this.emit();
  }

  /** Subscribe to auth state changes. Returns an unsubscribe function. */
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.session);
      } catch {}
    }
  }
}

/* ─── Singleton ─── */

export const authStore = new AuthStore();
