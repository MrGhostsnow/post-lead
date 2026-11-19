import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one database and a global job queue.
    fileParallelism: false,
  },
});
