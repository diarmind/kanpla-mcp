/**
 * Date filtering and item → menu mapping over the `load/frontend` payload.
 *
 * Real shape of the internal API (discovered empirically):
 *   offers[moduleId].items[] — each item is a *category* (e.g. "Main dish",
 *   "Soup") whose `name` is the category label. The actual dish for a given day
 *   lives in `item.dates[<unixSeconds>]`:
 *
 *     item.dates[ts] = {
 *       available: boolean,
 *       menu?: { name, description?, allergens?: { [code]: boolean }, labels? }
 *     }
 *
 *   `menu` is populated only on days a dish is assigned (empty on weekends /
 *   closed days). Allergen codes are keys whose value is `true`; nested codes
 *   like "wheat:rye" are sub-classifications we drop, keeping the top-level ones.
 *   Timestamp keys are UTC midnight for the calendar day.
 */

export interface MenuItem {
  /** Dish name for the day. */
  name: string;
  /** Dish description (may be empty). */
  description: string;
  /** Allergen codes present in the dish, e.g. ["milk", "wheat"]. */
  allergens: string[];
  /** Category the dish belongs to, e.g. "Main dish". */
  category: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
}

/** The per-day dish payload nested under an item's `dates` map. */
export interface RawMenu {
  name?: unknown;
  description?: unknown;
  allergens?: unknown;
}

/** One day's entry inside `item.dates`. */
export interface RawDateEntry {
  available?: unknown;
  menu?: RawMenu;
}

/** Loosely-typed item as it appears inside `offers[moduleId].items`. */
export interface RawItem {
  name?: unknown;
  description?: unknown;
  dates?: unknown;
}

/** One canteen/module entry inside the `offers` map. */
export interface RawOffer {
  items?: unknown;
}

/**
 * [start, end) epoch-second bounds for the UTC calendar day of `isoDate`.
 * The API keys dates at UTC midnight, so bounds are computed in UTC too.
 */
export function dayBounds(isoDate: string): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid date "${isoDate}", expected YYYY-MM-DD.`);
  }
  const [, y, m, d] = match;
  const start = Math.floor(Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000);
  return { start, end: start + 86_400 };
}

/** Today's date as a UTC YYYY-MM-DD string (matches the API's day keys). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizeAllergens(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([code, value]) => value === true && !code.includes(":"))
    .map(([code]) => code);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Select available dishes for `isoDate` across a module's items and map them to
 * the public MenuItem shape. Items with no dish assigned that day are skipped.
 */
export function itemsForDate(items: RawItem[], isoDate: string): MenuItem[] {
  const { start, end } = dayBounds(isoDate);
  const result: MenuItem[] = [];

  for (const item of items) {
    const category = asString(item.name);
    const dates = item.dates;
    if (!dates || typeof dates !== "object") continue;

    for (const [key, rawEntry] of Object.entries(dates as Record<string, unknown>)) {
      const ts = Number(key);
      if (!Number.isFinite(ts) || ts < start || ts >= end) continue;

      const entry = rawEntry as RawDateEntry;
      if (entry.available === false) continue;

      const menu = entry.menu;
      const name = asString(menu?.name);
      if (!name) continue; // no dish assigned that day (weekend / closed)

      result.push({
        name,
        description: asString(menu?.description),
        allergens: normalizeAllergens(menu?.allergens),
        category,
        date: isoDate,
      });
    }
  }

  return result;
}
