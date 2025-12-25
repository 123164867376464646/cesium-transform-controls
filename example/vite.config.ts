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
    alias: mode === 'development'
      ? {
          'cesium-transform-controls': path.resolve(__dirname, '../src/index.ts'),
        }
      : undefined,//使用 npm 包（用于 netlify 部署）
  },
}))

