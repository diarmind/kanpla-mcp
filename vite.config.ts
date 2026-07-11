import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// The published artifact is a Node CLI (stdio MCP server), not a browser bundle.
// We transpile src/index.ts to a single ESM file and keep runtime deps external
// so npm resolves them from node_modules — standard for an npm-installable CLI.
export default defineConfig({
  build: {
    target: "node18",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        /^@modelcontextprotocol\/sdk(\/.*)?$/,
        "dotenv",
        "dotenv/config",
        /^zod(\/.*)?$/,
      ],
      output: {
        // Executable shebang so `npx kanpla-mcp` / the bin entry runs directly.
        banner: "#!/usr/bin/env node",
      },
    },
  },
});
