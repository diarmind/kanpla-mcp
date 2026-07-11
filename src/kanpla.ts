import type { KanplaConfig } from "./config.js";
import {
  refreshIdToken,
  signInWithPassword,
  type FirebaseSession,
} from "./auth.js";
import {
  itemsForDate,
  type MenuItem,
  type RawItem,
  type RawOffer,
} from "./menu.js";

export interface ModuleSummary {
  moduleId: string;
  name: string;
}

/** A module entry from the top-level `modules` list (carries the display name). */
interface RawModule {
  id?: unknown;
  moduleId?: unknown;
  name?: unknown;
}

/** Shape of the `load/frontend` response we rely on (parsed defensively). */
interface FrontendResponse {
  offers?: Record<string, RawOffer>;
  modules?: RawModule[];
}

/**
 * Stateful Kanpla client. Owns the in-memory Firebase token cache and wraps the
 * single `load/frontend` endpoint. Credentials never leave this object.
 */
export class KanplaClient {
  private session: FirebaseSession | null = null;
  private loginInFlight: Promise<FirebaseSession> | null = null;

  constructor(private readonly config: KanplaConfig) {}

  /** Return a valid session, logging in or refreshing as needed. */
  private async ensureSession(): Promise<FirebaseSession> {
    const current = this.session;
    if (current && current.expiresAt > Date.now()) {
      return current;
    }

    // De-dupe concurrent auth so parallel tool calls don't each hit Firebase.
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = this.authenticate(current)
      .then((session) => {
        this.session = session;
        return session;
      })
      .finally(() => {
        this.loginInFlight = null;
      });

    return this.loginInFlight;
  }

  private async authenticate(
    stale: FirebaseSession | null,
  ): Promise<FirebaseSession> {
    const { firebaseApiKey, email, password } = this.config;

    if (stale?.refreshToken) {
      try {
        const refreshed = await refreshIdToken(firebaseApiKey, stale.refreshToken);
        return { ...refreshed, localId: stale.localId };
      } catch {
        // Refresh token rejected/expired — fall back to a full password login.
      }
    }

    return signInWithPassword(firebaseApiKey, email, password);
  }

  private async loadFrontend(): Promise<FrontendResponse> {
    const session = await this.ensureSession();
    const res = await fetch(`${this.config.base}/api/internal/load/frontend`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.idToken}`,
        "kanpla-app-env": "PROD",
        "kanpla-auth-provider": "GAuth",
        // The backend derives the tenant from Origin; without it, it 500s
        // with "Invalid URL".
        origin: this.config.base,
        referer: `${this.config.base}/`,
      },
      body: JSON.stringify({
        userId: session.localId,
        url: "app",
        language: this.config.language,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Kanpla load/frontend failed: ${res.status} ${res.statusText}${
          detail ? ` — ${detail.slice(0, 200)}` : ""
        }`,
      );
    }

    return (await res.json()) as FrontendResponse;
  }

  /** List the canteens/modules available to the account. */
  async listModules(): Promise<ModuleSummary[]> {
    const data = await this.loadFrontend();

    // Names live in the top-level `modules` list; offers are keyed by moduleId.
    const names = new Map<string, string>();
    for (const mod of data.modules ?? []) {
      const id = typeof mod.id === "string" ? mod.id : mod.moduleId;
      if (typeof id === "string" && typeof mod.name === "string") {
        names.set(id, mod.name);
      }
    }

    return Object.keys(data.offers ?? {}).map((moduleId) => ({
      moduleId,
      name: names.get(moduleId) ?? moduleId,
    }));
  }

  /** Menu items for `isoDate` in the given (or configured) module. */
  async getMenu(isoDate: string, moduleIdArg?: string): Promise<MenuItem[]> {
    const moduleId = moduleIdArg ?? this.config.moduleId;
    if (!moduleId) {
      throw new Error(
        "No moduleId provided. Set KANPLA_MODULE_ID, pass moduleId, or call list_modules to find it.",
      );
    }

    const data = await this.loadFrontend();
    const offer = data.offers?.[moduleId];
    if (!offer) {
      const available = Object.keys(data.offers ?? {});
      throw new Error(
        `Module "${moduleId}" not found in your offers.${
          available.length ? ` Available: ${available.join(", ")}` : ""
        }`,
      );
    }

    const items = Array.isArray(offer.items) ? (offer.items as RawItem[]) : [];
    return itemsForDate(items, isoDate);
  }
}
