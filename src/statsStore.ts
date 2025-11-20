// Stats Store Module
// Handles persistent storage of button usage statistics

export type ElementKey = string;      // e.g. visible label like "Compose", "Create", "Search"
export type PageKey = string;         // e.g. domain + simple page identifier

export interface ButtonStats {
  shown: number;   // how many times this button was shown as a candidate
  clicked: number; // how many times this button ended up actually being clicked
}

export type PageStats = Record<ElementKey, ButtonStats>;

export interface StatsDB {
  [pageKey: string]: PageStats;
}

const STORAGE_KEY = 'tabtabgo_stats';

// In-memory cache for fast reads
let statsCache: StatsDB | null = null;
let isInitialized = false;

// Debounce timer for writes (browser setTimeout returns number)
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_DEBOUNCE_MS = 500; // Wait 500ms after last change before writing

/**
 * Ensures the stats store is initialized.
 * Lazy initialization if initStatsStore() hasn't been called yet.
 */
async function ensureInitialized(): Promise<void> {
  if (!isInitialized || statsCache === null) {
    await initStatsStore();
  }
}

/**
 * Loads existing stats from chrome.storage.local into an in-memory object.
 * If nothing exists, starts with an empty object.
 */
export async function initStatsStore(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const storedData = result[STORAGE_KEY];
    
    if (storedData && typeof storedData === 'object') {
      statsCache = storedData as StatsDB;
    } else {
      statsCache = {};
    }
    
    isInitialized = true;
  } catch (error) {
    console.error('[StatsStore] Error loading stats from storage:', error);
    statsCache = {};
    isInitialized = true;
  }
}

/**
 * Loads the stats database from storage.
 * Internal helper function.
 */
async function loadStatsDB(): Promise<StatsDB> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const storedData = result[STORAGE_KEY];
    
    if (storedData && typeof storedData === 'object') {
      return storedData as StatsDB;
    }
    return {};
  } catch (error) {
    console.error('[StatsStore] Error loading stats DB:', error);
    return {};
  }
}

/**
 * Saves the stats database to storage.
 * Internal helper function.
 */
async function saveStatsDB(db: StatsDB): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: db });
  } catch (error) {
    console.error('[StatsStore] Error saving stats DB:', error);
  }
}

/**
 * Schedules a debounced write to storage.
 * Internal helper function.
 */
function scheduleWrite(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
  }
  
  writeTimer = setTimeout(async () => {
    if (statsCache !== null) {
      await saveStatsDB(statsCache);
    }
    writeTimer = null;
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Ensures an entry exists for [pageKey][elementKey] with default values.
 * Internal helper function.
 */
function ensureEntry(pageKey: PageKey, elementKey: ElementKey): void {
  if (statsCache === null) {
    statsCache = {};
  }
  
  if (!statsCache[pageKey]) {
    statsCache[pageKey] = {};
  }
  
  if (!statsCache[pageKey][elementKey]) {
    statsCache[pageKey][elementKey] = {
      shown: 0,
      clicked: 0
    };
  }
}

/**
 * Returns the stats for a given pageKey, or an empty object if not present.
 */
export async function getStatsForPage(pageKey: PageKey): Promise<PageStats> {
  await ensureInitialized();
  
  if (statsCache === null) {
    return {};
  }
  
  return statsCache[pageKey] || {};
}

/**
 * Ensures the entry exists for [pageKey][elementKey].
 * Increments the `shown` counter.
 * Writes back to storage (or schedules a debounced write).
 */
export async function recordButtonShown(pageKey: PageKey, elementKey: ElementKey): Promise<void> {
  await ensureInitialized();
  
  ensureEntry(pageKey, elementKey);
  
  if (statsCache !== null && statsCache[pageKey] && statsCache[pageKey][elementKey]) {
    statsCache[pageKey][elementKey].shown++;
    scheduleWrite();
  }
}

/**
 * Ensures the entry exists for [pageKey][elementKey].
 * Increments the `clicked` counter.
 * Writes back to storage (or schedules a debounced write).
 */
export async function recordButtonClicked(pageKey: PageKey, elementKey: ElementKey): Promise<void> {
  await ensureInitialized();
  
  ensureEntry(pageKey, elementKey);
  
  if (statsCache !== null && statsCache[pageKey] && statsCache[pageKey][elementKey]) {
    statsCache[pageKey][elementKey].clicked++;
    scheduleWrite();
  }
}

/**
 * Convenience helper to read stats for one button.
 */
export async function getButtonStats(
  pageKey: PageKey, 
  elementKey: ElementKey
): Promise<ButtonStats | undefined> {
  await ensureInitialized();
  
  if (statsCache === null) {
    return undefined;
  }
  
  return statsCache[pageKey]?.[elementKey];
}

/**
 * Example usage:
 * 
 * // Initialize on extension load (optional - lazy init is supported)
 * await initStatsStore();
 * 
 * // Compute page and element keys (from your existing logic)
 * const pageKey = makePageKey(window.location); // e.g. "gmail.com/inbox"
 * const elementKey = getElementKeyForButton(buttonElement); // e.g. "Compose"
 * 
 * // Record when a button is shown as a candidate
 * await recordButtonShown(pageKey, elementKey);
 * 
 * // Record when user actually clicks the button
 * await recordButtonClicked(pageKey, elementKey);
 * 
 * // Fetch stats for ranking (before proposing candidates)
 * const pageStats = await getStatsForPage(pageKey);
 * const buttonStats = await getButtonStats(pageKey, elementKey);
 * // Use buttonStats?.clicked or clicked/shown ratio to inform ranking
 */

