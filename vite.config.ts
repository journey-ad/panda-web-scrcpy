import { defineConfig, Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import Markdown from './plugins/md-loader.js';
import Binary from './plugins/binary-loader.js';
import { analyzer } from 'vite-bundle-analyzer';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    Markdown() as Plugin,
    Binary() as Plugin,
    analyzer({ analyzerMode: 'static', openAnalyzer: false }),
  ],
  base: '/PandaScrcpy/', // 须与 GitHub 仓库名一致（GitHub Pages 项目站点路径）
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/vuetify')) {
            return 'vuetify';
          }
          if (id.includes('node_modules/@xterm')) {
            return 'xterm';
          }
        },
      },
    },
  }
});
