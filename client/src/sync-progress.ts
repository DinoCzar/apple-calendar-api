import type { SyncAllProgressItem } from './types';

export function getSyncAllProgressPercent(items: SyncAllProgressItem[]): number {
  if (items.length === 0) return 0;

  const completed = items.filter(
    (item) =>
      item.status === 'synced' || item.status === 'skipped' || item.status === 'error'
  ).length;
  const syncing = items.some((item) => item.status === 'syncing');
  const fraction = (completed + (syncing ? 0.5 : 0)) / items.length;

  return Math.min(Math.round(fraction * 100), syncing ? 95 : 100);
}
