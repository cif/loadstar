import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "cloudflare:workers": new URL(
        "./src/stubs/cloudflare-workers.ts",
        import.meta.url
      ).pathname,
    },
  },
});
