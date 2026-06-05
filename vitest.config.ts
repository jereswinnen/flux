import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    globals: false,
    // DB-backed tests share one Railway database (no separate test DB), and
    // several reset the `episodes` table between cases. Run test files
    // sequentially so concurrent resets can't interfere with each other.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
