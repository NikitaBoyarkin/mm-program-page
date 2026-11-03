import { defineConfig } from "astro/config";

// A single prerendered surface: three day pages, one data endpoint, no adapter.
// `site` is deliberately unset — the deploy target (user Pages root vs a
// project subpath) decides it, and a wrong absolute URL is worse than none.
// Set `site` (and `base` when the page lives under a subpath) at deploy time.
export default defineConfig({
  output: "static",
  build: { format: "directory" },
  trailingSlash: "ignore",
  compressHTML: true,
  devToolbar: { enabled: false },
});
