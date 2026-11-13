import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// A single prerendered surface: three day pages, one data endpoint, no adapter.
// Deployed to a project subpath on GitHub Pages, so `site` fixes the absolute
// origin and `base` prefixes every link, asset and `program.json` fetch.
// `sitemap()` writes dist/sitemap-index.xml + dist/sitemap-0.xml; 404/500 and
// JSON endpoints are excluded by the integration itself.
export default defineConfig({
  site: "https://nikitaboyarkin.github.io",
  base: "/mm-program-page",
  integrations: [sitemap()],
  output: "static",
  build: { format: "directory" },
  trailingSlash: "ignore",
  compressHTML: true,
  devToolbar: { enabled: false },
});
