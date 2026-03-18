import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_PORT = process.env.VITE_API_PORT || '8766'
const API_URL = `http://localhost:${API_PORT}`
const WS_URL = `ws://localhost:${API_PORT}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    proxy: {
      '/sessions': API_URL,
      '/pipeline': API_URL,
      '/config': API_URL,
      '/campaigns': API_URL,
      '/auth': API_URL,
      '/invites': API_URL,
      '/merge': API_URL,
      '/ws': { target: WS_URL, ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
})
