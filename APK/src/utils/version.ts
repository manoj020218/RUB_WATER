import type { AppRelease } from '@/types';

export function cmpVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export function isUpdateAvailable(
  latest: AppRelease | null | undefined,
  currentVersion: string,
  currentVersionCode: number,
): boolean {
  if (!latest) return false;
  return (latest.versionCode ?? 0) > currentVersionCode || cmpVersions(latest.version ?? '0', currentVersion) > 0;
}
