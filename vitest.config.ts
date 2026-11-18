import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "addon/tests/**/*.test.ts",
      "streamdeck/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
