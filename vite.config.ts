import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map(
    (module) => `node:${module}`
  ),
];

export default defineConfig({
  build: {
    ssr: 'src/server/index.ts',

    outDir: 'dist/server',

    emptyOutDir: true,

    target: 'node24',

    rollupOptions: {
      external: nodeBuiltins,

      output: {
        format: 'cjs',
        entryFileNames: 'index.cjs',
      },
    },
  },

  ssr: {
    noExternal: true,
  },
});
