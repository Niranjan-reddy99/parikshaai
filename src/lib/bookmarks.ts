import { type Question } from '../types';

const key = (uid: string) => `pyq_bookmarks_${uid}`;

export function loadBookmarkMap(uid: string): Record<string, Question> {
  try { return JSON.parse(localStorage.getItem(key(uid)) || '{}'); } catch { return {}; }
}

function saveBookmarkMap(uid: string, map: Record<string, Question>): void {
  try { localStorage.setItem(key(uid), JSON.stringify(map)); } catch {}
}

export function toggleBookmark(uid: string, q: Question): { map: Record<string, Question>; added: boolean } {
  const map = loadBookmarkMap(uid);
  if (map[q.id]) {
    delete map[q.id];
    saveBookmarkMap(uid, map);
    return { map, added: false };
  }
  map[q.id] = q;
  saveBookmarkMap(uid, map);
  return { map, added: true };
}

export function removeBookmark(uid: string, id: string): Record<string, Question> {
  const map = loadBookmarkMap(uid);
  delete map[id];
  saveBookmarkMap(uid, map);
  return map;
}

export function clearBookmarks(uid: string): void {
  try { localStorage.removeItem(key(uid)); } catch {}
}
