# kanpla-mcp

An unofficial **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server that lets an agent log in to Kanpla under your account and read the canteen menu.

It wraps the internal frontend API that the `app.kanpla.io` web app itself uses: Firebase (Google Identity Toolkit) for auth, then a single `load/frontend` call for the offers. Your credentials stay inside the server's environment — the agent only ever sees tool results (menu items), never your e-mail, password, or Firebase key.

> ⚠️ **Disclaimer.** This talks to an **undocumented internal API** (`/api/internal/…`), not Kanpla's official partner API. It can break without notice if Kanpla changes their frontend, and it is not endorsed by Kanpla. Use at your own risk, for your own account only.

---

## Features

- 🔐 Credentials and Firebase key live in server env, never in the model's context.
- ♻️ Token is cached and auto-refreshed (Firebase idTokens expire ~1h) — the agent never handles tokens.
- 📅 Menu for today or any specific date, with allergens.
- 🥗 Portion sizes and nutrition facts (kcal, protein, fat, carbs…) per 100 g and per portion.
- 🚫 **Read-only by design.** No ordering, no payments, no account mutations.

---

## Requirements

- Node.js ≥ 18 (uses global `fetch`)
- A Kanpla account you can log in to with e-mail + password
- Three account-specific values (see [Getting your values](#getting-your-values))

---

## Installation

Install from npm:

```bash
npm install -g @diarmind/kanpla-mcp
# or run without installing:
npx @diarmind/kanpla-mcp
```

(The installed command is `kanpla-mcp`.)

Or build from source (uses **pnpm** via Corepack and **Vite**):

```bash
git clone https://github.com/diarmind/kanpla-mcp.git
cd kanpla-mcp
corepack enable
pnpm install
pnpm build
```

---

## Configuration

All configuration is via environment variables. Create a `.env` (loaded by the server on startup) or export them in your MCP client config.

| Variable                 | Required | Default                  | Description                                                                 |
| ------------------------ | -------- | ------------------------ | --------------------------------------------------------------------------- |
| `KANPLA_FIREBASE_API_KEY`| Yes      | —                        | Public Firebase client key (`AIza…`). See below.                            |
| `KANPLA_EMAIL`           | Yes      | —                        | Your Kanpla login e-mail.                                                    |
| `KANPLA_PASSWORD`        | Yes      | —                        | Your Kanpla password.                                                        |
| `KANPLA_MODULE_ID`       | No\*     | —                        | Canteen/module id. Optional if you use `list_modules` to discover it first. |
| `KANPLA_BASE`            | No       | `https://app.kanpla.io`  | Might differ for regional accounts.                            |
| `KANPLA_LANGUAGE`        | No       | `en`                     | Language code for menu text (e.g. `en`, `da`, `nb`).                        |

\* `KANPLA_MODULE_ID` is not required to start the server, but `get_today_menu` / `get_menu_for_date` need a module id — either from this variable or passed as a tool argument.

### Getting your values

Open `app.kanpla.io`, launch browser DevTools → **Network**, and log in.

- **`KANPLA_FIREBASE_API_KEY`** — find the request to `identitytoolkit.googleapis.com/…signInWithPassword`. The key is the `AIza…` string in its URL (`?key=AIza…`) or in the `x-goog-api-key` request header. It is a public client key, not a secret.
- **`KANPLA_MODULE_ID`** — the key under `offers` in the `load/frontend` response, or run the `list_modules` tool once and copy the id.

---

## Running

### Standalone (stdio)

```bash
node dist/index.js
```

The server speaks MCP over **stdio**. It's meant to be launched by an MCP client, not used interactively.

### With an MCP client (e.g. Claude Desktop)

Add to your client's MCP servers config:

```json
{
  "mcpServers": {
    "kanpla": {
      "command": "node",
      "args": ["/absolute/path/to/kanpla-mcp/dist/index.js"],
      "env": {
        "KANPLA_FIREBASE_API_KEY": "AIza...",
        "KANPLA_EMAIL": "you@example.com",
        "KANPLA_PASSWORD": "your-password",
        "KANPLA_MODULE_ID": "your-module-id",
        "KANPLA_BASE": "https://app.kanpla.io",
        "KANPLA_LANGUAGE": "en"
      }
    }
  }
}
```

Keep this config file readable only by you — it contains your password.

### Dev mode

```bash
pnpm dev     # tsx watch, reloads on change
```

---

## MCP tools

All tools are read-only.

### `get_today_menu`

Returns the available menu items for today.

**Arguments**

| Name       | Type   | Required | Description                                            |
| ---------- | ------ | -------- | ------------------------------------------------------ |
| `moduleId` | string | No       | Overrides `KANPLA_MODULE_ID` for this call.            |

**Returns** — array of:

```jsonc
{
  "name": "Fried calamares",
  "description": "With sweet potato fries, mini caesar salad & tartar sauce",
  "allergens": ["molluscs", "wheat", "milk", "sulphurdioxide"],
  "category": "Main dish",
  "date": "2026-10-16",
  "portionGrams": 400,
  "nutrition": {
    "per100g":    { "kcal": 175, "protein": 5.9,  "fat": 10.4, "saturatedFat": null, "carbs": 14.6, "sugar": null, "fiber": 1.3, "salt": 0.89 },
    "perPortion": { "kcal": 700, "protein": 23.6, "fat": 41.6, "saturatedFat": null, "carbs": 58.4, "sugar": null, "fiber": 5.2, "salt": 3.6 }
  }
}
```

- `category` — the section the dish belongs to (e.g. `Main dish`, `Soup`, `Drinks`).
- `portionGrams` — portion size in grams, or `null` if unknown.
- `nutrition` — energy in kcal, everything else in grams; individual values are `null` where the canteen didn't publish them. `perPortion` is `per100g` scaled to `portionGrams` (`null` when the portion is unknown). The whole `nutrition` is `null` for dishes without nutrition facts (often drinks).

Empty array means no dishes that day (weekend / closed / wrong module).

---

### `get_menu_for_date`

Menu for a specific day.

**Arguments**

| Name       | Type   | Required | Description                                 |
| ---------- | ------ | -------- | ------------------------------------------- |
| `date`     | string | Yes      | ISO date, `YYYY-MM-DD`.                     |
| `moduleId` | string | No       | Overrides `KANPLA_MODULE_ID` for this call. |

**Returns** — same shape as `get_today_menu`.

---

### `list_modules`

Lists the canteens/modules available to your account, so you can find your `moduleId`.

**Arguments** — none.

**Returns** — array of:

```jsonc
{ "moduleId": "abc123", "name": "HQ Canteen" }
```

---

## How it works

```
1. Firebase login
   POST identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>
   { email, password, returnSecureToken: true }  ->  idToken, localId

2. (on expiry) refresh
   POST securetoken.googleapis.com/v1/token?key=<API_KEY>
   grant_type=refresh_token  ->  new idToken

3. Load offers
   POST <BASE>/api/internal/load/frontend
   headers: authorization: Bearer <idToken>, kanpla-app-env: PROD,
            kanpla-auth-provider: GAuth, origin: <BASE>   # origin is required
   { userId: localId, url: "app", language }  ->  offers[moduleId].items + modules[]

4. For each item (a category) look at item.dates{<unixSeconds>} whose key falls in
   the target UTC day, keep entries with available !== false and a populated
   .menu, then expose { name, description, allergens, category, date } — where
   allergens are the true-valued top-level keys of menu.allergens.

5. Nutrition comes from menu.nutrition (servingBasis "100g", energy in kcal);
   portion = menu.nutrition.servingSize, falling back to the category item's
   nutrition.servingSize. perPortion = per100g × portion / 100.
```

> Module display names come from the top-level `modules[]` list; `offers` is
> keyed by `moduleId` and carries no name. `origin` must be sent or the backend
> responds `500 {"message":"Invalid URL"}`.

The idToken is cached in memory and refreshed automatically; nothing is persisted to disk.

---

## Project layout

```
kanpla-mcp/
├─ src/
│  ├─ index.ts          # MCP server entry (stdio transport, tool registration)
│  ├─ kanpla.ts         # Kanpla client: login, token cache, load/frontend
│  ├─ auth.ts           # Firebase signInWithPassword + securetoken refresh
│  ├─ menu.ts           # date filtering, item -> menu mapping
│  └─ config.ts         # env parsing/validation (zod)
├─ dist/                # bundled output (pnpm build)
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
└─ README.md
```

## Scripts

| Command          | Description                             |
| ---------------- | --------------------------------------- |
| `pnpm build`     | Bundle to `dist/` with Vite.            |
| `pnpm dev`       | Watch mode via `tsx`.                   |
| `pnpm typecheck` | Type-check with `tsc --noEmit`.         |
| `pnpm start`     | Run the built server (`dist/index.js`). |

---

## Security notes

- Your password and Firebase key are read from env only; they are **never** returned by any tool and never enter the agent's context.
- The Firebase API key is a public client key — safe to store, but treat the config file as sensitive because it also holds your password.
- Restrict file permissions on any `.env` or client config: `chmod 600`.

## Limitations

- Depends on an undocumented internal endpoint; may break on Kanpla frontend changes.
- Not affiliated with or supported by Kanpla ApS.
- Read-only: ordering and payments are intentionally out of scope.

## License

MIT
