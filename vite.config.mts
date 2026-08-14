/**
 * Builds the Electron main, preload, and React renderer processes with Vite.
 */

import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import { notBundle } from 'vite-plugin-electron/plugin'

const repositoryRoot = resolve('.')

/** Starts Electron from the repository root without weakening its sandbox flags. */
const startElectron = async ({
  startup,
}: {
  startup: (
    argv?: string[],
    options?: import('node:child_process').SpawnOptions,
  ) => Promise<boolean>
}): Promise<void> => {
  await startup(['.'], { cwd: repositoryRoot })
}

export default defineConfig({
  root: resolve(repositoryRoot, 'src/renderer'),
  base: './',
  publicDir: false,
  plugins: [
    react({}),
    electron({
      main: {
        entry: resolve(repositoryRoot, 'src/main/index.ts'),
        onstart: startElectron,
        vite: {
          root: repositoryRoot,
          plugins: [notBundle({})],
          resolve: {
            alias: {
              '@main': resolve(repositoryRoot, 'src/main'),
              '@shared': resolve(repositoryRoot, 'src/shared'),
            },
          },
          build: {
            outDir: resolve(repositoryRoot, 'out/main'),
            emptyOutDir: true,
          },
        },
      },
      preload: {
        input: resolve(repositoryRoot, 'src/preload/index.ts'),
        onstart: startElectron,
        vite: {
          root: repositoryRoot,
          plugins: [notBundle({})],
          resolve: {
            alias: {
              '@shared': resolve(repositoryRoot, 'src/shared'),
            },
          },
          build: {
            outDir: resolve(repositoryRoot, 'out/preload'),
            emptyOutDir: true,
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@renderer': resolve(repositoryRoot, 'src/renderer/src'),
      '@shared': resolve(repositoryRoot, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(repositoryRoot, 'out/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1_500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /node_modules/,
            },
          ],
        },
      },
    },
  },
})
