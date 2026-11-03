// Renders the link-preview banner (og:image) for the page.
//
// SVG template -> rsvg-convert -> pango -> fontconfig. fontconfig cannot read
// the variable .woff2 the site ships, so static Inter / Cormorant TTFs live in
// scripts/og-fonts/ next to a fonts.conf whose <dir> is cwd-relative: the
// renderer must therefore run with cwd = scripts/og-fonts, and PangoCairo has
// to be forced onto the fontconfig backend or macOS silently falls back to
// Helvetica.
//
// Not wired into `astro build` — the PNG is committed, so a CI build never
// needs librsvg. Run `bun run og` after editing the template.
//
// The right-hand half is a real screenshot of the deployed page: a preview
// card must show what the link actually opens.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fontsDir = join(root, "scripts/og-fonts");
const screenshot = join(root, "docs/reference/desktop-top.png");
const outPath = join(root, "src/assets/og/program-2026.png");

const BRAND = "#1400c3";
const SURFACE = "#f4efca";

const shot = readFileSync(screenshot).toString("base64");

// Favicon mark, same geometry as public/favicon.svg — the banner and the tab
// icon must not drift into two different logos.
const mark = `
  <g transform="translate(80 46) scale(0.68)">
    <path fill="${BRAND}" d="M96 50 73 89.8 27 89.8 4 50 27 10.2 73 10.2Z"/>
    <text x="50" y="65" font-family="Inter" font-size="42" font-weight="800"
          letter-spacing="-2" text-anchor="middle" fill="#f8f2d8">NB</text>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="cardClip"><rect x="636" y="140" width="484" height="336" rx="16"/></clipPath>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="${BRAND}" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1a1a1a" flood-opacity="0.18"/>
    </filter>
  </defs>

  <rect width="1200" height="630" fill="${SURFACE}"/>

  ${mark}

  <text x="80" y="196" font-family="Inter" font-size="25" font-weight="600"
        letter-spacing="3.4" fill="${BRAND}" fill-opacity="0.72">ПРОГРАММА КОНФЕРЕНЦИИ</text>

  <text x="78" y="276" font-family="Cormorant" font-size="58" font-weight="700"
        fill="${BRAND}">Матемаркетинг 2026</text>

  <text x="80" y="330" font-family="Inter" font-size="24" font-weight="500"
        fill="${BRAND}" fill-opacity="0.82">26–27 ноября и онлайн-день</text>
  <text x="80" y="366" font-family="Inter" font-size="22" font-weight="400"
        fill="${BRAND}" fill-opacity="0.62">расписание по дням, залам и трекам</text>

  <rect x="80" y="416" width="300" height="3" fill="url(#rule)"/>

  <text x="80" y="558" font-family="Inter" font-size="21" font-weight="500"
        fill="${BRAND}" fill-opacity="0.72">nikitaboyarkin.github.io/mm-program-page</text>

  <g filter="url(#shadow)">
    <g clip-path="url(#cardClip)">
      <svg x="636" y="140" width="484" height="336" viewBox="305 0 1095 760"
           preserveAspectRatio="xMidYMid slice">
        <image xlink:href="data:image/png;base64,${shot}" width="1440" height="1000"/>
      </svg>
    </g>
  </g>
  <rect x="636" y="140" width="484" height="336" rx="16" fill="none"
        stroke="${BRAND}" stroke-opacity="0.16" stroke-width="2"/>
</svg>`;

const svgPath = join(tmpdir(), "mm-program-og.svg");
writeFileSync(svgPath, svg);
mkdirSync(dirname(outPath), { recursive: true });

const res = spawnSync("rsvg-convert", [svgPath, "-o", outPath], {
  encoding: "utf8",
  cwd: fontsDir,
  env: {
    ...process.env,
    FONTCONFIG_FILE: join(fontsDir, "fonts.conf"),
    PANGOCAIRO_BACKEND: "fc",
  },
});
try {
  unlinkSync(svgPath);
} catch {}

if (res.status !== 0) {
  console.error("rsvg-convert failed:", res.stderr || res.stdout);
  process.exit(1);
}
console.log(`og banner -> ${outPath}`);
