import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderBadgeJson, renderBadgeSvg, securityBadgeFor } from './badge.mjs';
import { BADGE_DIR } from './coverage-badge.mjs';

/** Write `security.svg` + `security.json` into `outDir`; returns the badge. */
export function writeSecurityBadge({ outDir = BADGE_DIR, label = 'Security', verdict }) {
  // Parsed before anything touches the disk, so a bad verdict leaves no file.
  const badge = securityBadgeFor(verdict, label);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'security.svg'), renderBadgeSvg(badge));
  writeFileSync(path.join(outDir, 'security.json'), renderBadgeJson(badge));
  return badge;
}
