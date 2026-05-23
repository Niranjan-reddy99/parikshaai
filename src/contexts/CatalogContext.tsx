import { createContext, useContext, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { API_BASE } from '../lib/api';
import { type CatalogSummary, type FeedSummary } from '../types/index';

// ── Cache helpers (shared with consumers) ────────────────────────────────────

export const CATALOG_CACHE_KEY = "catalog_summary_v15_public";
export const FEED_CACHE_KEY    = "feed_summary_v15_public";
const META_CACHE_MAX_AGE_MS    = 10 * 60 * 1000;

export function readFreshMetaCache<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (!parsed?.ts || Date.now() - Number(parsed.ts) > META_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data as T;
  } catch {
    return null;
  }
}

// ── Context types ─────────────────────────────────────────────────────────────

interface CatalogContextValue {
  catalogSummary: CatalogSummary | null;
  feedSummary: FeedSummary | null;
  dataLoading: boolean;
  globalError: string | null;
  setGlobalError: (error: string | null | ((prev: string | null) => string | null)) => void;
  fetchData: (options?: { background?: boolean }) => Promise<void>;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [catalogSummary, setCatalogSummary] = useState<CatalogSummary | null>(() =>
    readFreshMetaCache<CatalogSummary>(CATALOG_CACHE_KEY)
  );
  const [feedSummary, setFeedSummary] = useState<FeedSummary | null>(() =>
    readFreshMetaCache<FeedSummary>(FEED_CACHE_KEY)
  );
  const [dataLoading, setDataLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const fetchData = async (options?: { background?: boolean }) => {
    if (!user) return;
    const background = options?.background === true;
    const hasVisibleCatalog = Boolean(catalogSummary);
    const hasVisibleFeed    = Boolean(feedSummary);

    const fetchWithTimeout = (url: string, ms = 18000): Promise<Response> => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), ms);
      return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(timer));
    };

    const fetchCatalog = async () => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/meta/catalog`);
        if (!res.ok) return { ok: false as const, kind: "http" as const };
        const data = await res.json();
        setCatalogSummary(data);
        try {
          localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
        } catch {}
        return { ok: true as const };
      } catch {
        return { ok: false as const, kind: "network" as const };
      }
    };

    const fetchFeed = async () => {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/meta/feed`);
        if (!res.ok) return { ok: false as const, kind: "http" as const };
        const data = await res.json();
        setFeedSummary(data);
        try {
          localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
        } catch {}
        return { ok: true as const };
      } catch {
        return { ok: false as const, kind: "network" as const };
      }
    };

    if (!background && !hasVisibleCatalog) setDataLoading(true);

    const feedPromise   = fetchFeed();
    const catalogResult = await fetchCatalog();

    if (!background && !hasVisibleCatalog) setDataLoading(false);

    if (catalogResult.ok) {
      setGlobalError(null);
    } else if (!background || !hasVisibleCatalog) {
      setGlobalError(
        catalogResult.kind === "network"
          ? `Cannot reach backend at ${API_BASE}.`
          : `Backend returned an error from ${API_BASE}.`
      );
    }

    const feedResult = await feedPromise;
    if (feedResult.ok) {
      setGlobalError((current) =>
        current === `Backend returned an error from ${API_BASE}.` ||
        current === `Cannot reach backend at ${API_BASE}.`
          ? null
          : current
      );
      return;
    }

    if (!hasVisibleFeed && (!background || !hasVisibleCatalog)) {
      setGlobalError(
        feedResult.kind === "network"
          ? `Cannot reach backend at ${API_BASE}.`
          : `Backend returned an error from ${API_BASE}.`
      );
    }

    if (!background && hasVisibleCatalog) setDataLoading(false);
  };

  return (
    <CatalogContext.Provider value={{
      catalogSummary,
      feedSummary,
      dataLoading,
      globalError,
      setGlobalError,
      fetchData,
    }}>
      {children}
    </CatalogContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider');
  return ctx;
}
