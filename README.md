# kanpla-mcp

An unofficial **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server that lets an agent log in to Kanpla under your account and read the canteen menu.

It wraps the internal frontend API that the `app.kanpla.io` web app itself uses: Firebase (Google Identity Toolkit) for auth, then a single `load/frontend` call for the offers. Your credentials stay inside the server's environment — the agent only ever sees tool results (menu items), never your e-mail, password, or Firebase key.

> ⚠️ **Disclaimer.** This talks to an **undocumented internal API** (`/api/internal/…`), not Kanpla's official partner API. It can break without notice if Kanpla changes their frontend, and it is not endorsed by Kanpla. Use at your own risk, for your own account only.

---

## Features

- 🔐 Credentials and Firebase key live in server env, never in the model's context.
- ♻️ Token is cached and auto-refreshed (Firebase idTokens expire ~1h) — the agent never handles tokens.
- 📅 Menu for today or any specific date, with allergens.
- 🚫 **Read-only by design.** No ordering, no payments, no account mutations.

---

## Requirements

- Node.js ≥ 18 (uses global `fetch`)
- A Kanpla account you can log in to with e-mail + password
- Three account-specific values (see [Getting your values](#getting-your-values))

---

## Installation

```bash
git clone https://github.com/<you>/kanpla-mcp.git
cd kanpla-mcp
npm install
npm run build
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
npm run dev     # tsx watch, rebuilds on change
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
  "name": "Butter chicken with rice",
  "description": "Mild curry, basmati rice, coriander",
  "allergens": ["milk", "gluten"],
  "date": "2026-07-11"
}
```

Empty array means no menu today (weekend / closed / wrong module).

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
   headers: authorization: Bearer <idToken>, kanpla-app-env: PROD, kanpla-auth-provider: GAuth
   { userId: localId, url: "app", language }  ->  offers[moduleId].items

4. Filter items where dates{} has a unix-second timestamp inside the target day
   and available === true; expose menu.{name, description, allergens}.
```

The idToken is cached in memory and refreshed automatically; nothing is persisted to disk.

---

## Project layout

```
kanpla-mcp/
├─ src/
│  ├─ index.ts          # MCP server entry (stdio transport, tool registration)
│  ├─ kanpla.ts         # Kanpla client: login, token cache, load/frontend
│  ├─ auth.ts           # Firebase signInWithPassword + securetoken refresh
│  └─ menu.ts           # date filtering, item -> menu mapping
├─ dist/                # compiled output (npm run build)
├─ package.json
├─ tsconfig.json
└─ README.md
```

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run build` | Compile TypeScript to `dist/`.       |
| `npm run dev`   | Watch mode via `tsx`.                |
| `npm start`     | Run the built server (`dist/index.js`). |

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
