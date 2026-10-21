import { defineConfig } from 'vite';

// GitHub Pages serves the project at /<repo>/ so the base must match.
// Override with BASE_PATH=/ when hosting at a domain root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Genesys/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
