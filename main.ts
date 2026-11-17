// Viceroy Bay — an open-world crime story for the gta6-01 bounty.
//
// You are a wheelman making a name around a sun-bleached bay city: cruise the
// streets, take on missions, shake police chases, and work up to the final
// heist. The game itself is plain static files under game/ — a desktop browser
// loads game/index.html offline, no build step and no network — and this file
// is only the hand-in. It checks the pieces are really there first, then
// copies game/ and screenshots/ into the output directory and writes
// dossier.json, the summary the judge reads, using the vendored make.fun
// library in vendor/makefun-game.ts.
//
// Run it from this directory with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// A hand-in carries three or four screenshots; the first by name is the cover.
const SHOTS_MIN = 3;
const SHOTS_MAX = 4;

const repoRoot = fileURLToPath(new URL('./', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');

/** Stop the hand-in loudly, with a reason the builder can act on. */
function refuse(message: string): never {
  throw new Error(`Viceroy Bay hand-in refused: ${message}`);
}

/** The playable page has to exist as a real file before anything is copied. */
function checkEntryPage(): void {
  const page = join(gameDir, 'index.html');
  if (!existsSync(page) || !statSync(page).isFile()) {
    refuse('game/index.html is missing — the game needs its entry page');
  }
}

/** The screenshots folder has to hold 3–4 image files, or there is no cover. */
function checkShots(): string[] {
  if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
    refuse('screenshots/ is missing — the hand-in needs 3 or 4 screenshots');
  }
  const pictures = readdirSync(shotsDir).filter((name) => {
    const suffix = extname(name).toLowerCase();
    const isPicture = suffix === '.png' || suffix === '.jpg' || suffix === '.jpeg';
    return isPicture && statSync(join(shotsDir, name)).isFile();
  });
  if (pictures.length < SHOTS_MIN || pictures.length > SHOTS_MAX) {
    refuse(
      `screenshots/ holds ${pictures.length} image(s), but a hand-in needs ` +
        `${SHOTS_MIN} to ${SHOTS_MAX}`,
    );
  }
  return pictures;
}

/** Copy a folder fresh, so a stale file from an earlier run can never linger. */
function copyFresh(source: string, target: string): void {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

// The caps the scorer itself uses: only text_max_bytes shapes the bytes, the
// rest refuse an entry the scorer would refuse (over 4 screenshots or one
// over 256 KiB; over 993 files in game/ or 48 MiB of game files in all, or a
// game/ path over 1000 bytes — game/ counts beside the output's own cap).
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

checkEntryPage();
const shots = checkShots();

mkdirSync(outputDir, { recursive: true });
copyFresh(gameDir, join(outputDir, 'game'));
copyFresh(shotsDir, join(outputDir, 'screenshots'));

writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, dossierCaps),
);
