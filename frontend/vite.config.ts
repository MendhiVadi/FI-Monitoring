import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import mapHandler from './api/maps.js'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // The Capacitor Android project's Gradle build output holds OS-level file
    // locks on Windows; watching it crashes Vite's dev server with EBUSY the
    // moment a build touches those files (e.g. Android Studio running
    // alongside `npm run dev`). The web app never needs to watch native
    // Android sources or build output.
    watch: { ignored: ['**/android/**'] },
  },
  plugins: [react(), {
    name: 'local-map-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/api/maps') {
          void mapHandler(req, res).catch(next)
        } else next()
      })
    },
  }],
})
