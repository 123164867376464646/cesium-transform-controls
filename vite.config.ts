import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      outDir: 'dist',
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'CesiumTransformControls',
      formats: ['es', 'umd'],
      fileName: (format) => `cesium-transform-controls.${format}.js`,
    },
    rollupOptions: {
      external: ['cesium'],
      output: {
        globals: {
          cesium: 'Cesium',
        },
      },
    },
    sourcemap: true,
  },
})
