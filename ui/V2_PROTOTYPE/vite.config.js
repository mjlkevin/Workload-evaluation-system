/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3002,
    strictPort: false,
    proxy: {
      // 加尾斜杠避免吞掉 /api-keys 路由（前缀匹配 /api/ 而非 /api）
      '/api/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // 禁用代理缓冲，确保 SSE 流式事件实时转发到前端
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // 前端插批（项三）：vendor 切分——react 生态独立缓存，
        // 配合路由级 lazy import 避免单 chunk 全量下载。
        // 用函数式按 node_modules 目录归属匹配，覆盖 CJS 包内
        // 全部子模块（react 主体在 react/cjs/* 而非入口 index.js）
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/react-router') || id.includes('/@remix-run/')) return 'vendor-router'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/__tests__/setup.js',
  },
})
