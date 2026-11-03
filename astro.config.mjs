import { defineConfig } from "astro/config";

// A single prerendered surface: three day pages, one data endpoint, no adapter.
// Deployed to a project subpath on GitHub Pages, so `site` fixes the absolute
// origin and `base` prefixes every link, asset and `program.json` fetch.
export default defineConfig({
  site: "https://nikitaboyarkin.github.io",
  base: "/mm-program-page",
  output: "static",
  build: { format: "directory" },
  trailingSlash: "ignore",
  compressHTML: true,
  devToolbar: { enabled: false },
});
