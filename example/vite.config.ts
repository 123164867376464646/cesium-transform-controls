import { defineConfig } from 'vite'
import cesium from 'vite-plugin-cesium'
import path from 'path'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [cesium()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      'cesium-transform-controls': path.resolve(__dirname, '../src/index.ts'),
    },
  },
}))

