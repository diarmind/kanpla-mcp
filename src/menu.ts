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
 *       menu?: { name, description?, allergens?: { [code]: boolean },
 *                nutrition?: { servingSize, servingBasis, energy, protein, … } }
 *     }
 *
 *   `menu` is populated only on days a dish is assigned (empty on weekends /
 *   closed days). Allergen codes are keys whose value is `true`; nested codes
 *   like "wheat:rye" are sub-classifications we drop, keeping the top-level ones.
 *   Timestamp keys are UTC midnight for the calendar day.
 *
 *   `menu.nutrition` holds nutrients per `servingBasis` (always "100g" in
 *   practice; `energy` is kcal) plus `servingSize` — the portion in grams. The
 *   category item may carry its own `nutrition.servingSize`, used as a fallback
 *   portion when the dish has none.
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
  /** Portion (serving) size in grams, if known. */
  portionGrams: number | null;
  /** Nutrition facts, or null when the canteen published none for the dish. */
  nutrition: Nutrition | null;
}

/** Nutrient amounts; null where the canteen didn't provide a value. */
export interface Macros {
  /** Energy, kcal. */
  kcal: number | null;
  /** Grams. */
  protein: number | null;
  fat: number | null;
  saturatedFat: number | null;
  carbs: number | null;
  sugar: number | null;
  fiber: number | null;
  salt: number | null;
}

export interface Nutrition {
  per100g: Macros;
  /** `per100g` scaled to the portion; null when the portion size is unknown. */
  perPortion: Macros | null;
}

/** Raw `nutrition` object from the API. */
interface RawNutrition {
  servingSize?: unknown;
  servingBasis?: unknown;
  energy?: unknown;
  protein?: unknown;
  fat?: unknown;
  fatSaturated?: unknown;
  carbohydrates?: unknown;
  sugar?: unknown;
  fibre?: unknown;
  salt?: unknown;
}

/** The per-day dish payload nested under an item's `dates` map. */
export interface RawMenu {
  name?: unknown;
  description?: unknown;
  allergens?: unknown;
  nutrition?: unknown;
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
  nutrition?: unknown;
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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNutrition(value: unknown): RawNutrition | undefined {
  return value && typeof value === "object" ? (value as RawNutrition) : undefined;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function scaleMacros(m: Macros, factor: number): Macros {
  const scale = (v: number | null, round: (x: number) => number) =>
    v === null ? null : round(v * factor);
  return {
    kcal: scale(m.kcal, Math.round),
    protein: scale(m.protein, round1),
    fat: scale(m.fat, round1),
    saturatedFat: scale(m.saturatedFat, round1),
    carbs: scale(m.carbs, round1),
    sugar: scale(m.sugar, round1),
    fiber: scale(m.fiber, round1),
    salt: scale(m.salt, round1),
  };
}

function normalizeNutrition(
  raw: RawNutrition | undefined,
  portionGrams: number | null,
): Nutrition | null {
  if (!raw) return null;
  // Only per-100g values have been observed; any other basis can't be scaled safely.
  if (raw.servingBasis !== undefined && raw.servingBasis !== "100g") return null;

  const per100g: Macros = {
    kcal: asNumber(raw.energy),
    protein: asNumber(raw.protein),
    fat: asNumber(raw.fat),
    saturatedFat: asNumber(raw.fatSaturated),
    carbs: asNumber(raw.carbohydrates),
    sugar: asNumber(raw.sugar),
    fiber: asNumber(raw.fibre),
    salt: asNumber(raw.salt),
  };
  if (Object.values(per100g).every((v) => v === null)) return null;

  return {
    per100g,
    perPortion: portionGrams ? scaleMacros(per100g, portionGrams / 100) : null,
  };
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
    const categoryPortion = asNumber(asNutrition(item.nutrition)?.servingSize);
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

      const nutrition = asNutrition(menu?.nutrition);
      const portionGrams = asNumber(nutrition?.servingSize) ?? categoryPortion;

      result.push({
        name,
        description: asString(menu?.description),
        allergens: normalizeAllergens(menu?.allergens),
        category,
        date: isoDate,
        portionGrams,
        nutrition: normalizeNutrition(nutrition, portionGrams),
      });
    }
  }

  return result;
}
