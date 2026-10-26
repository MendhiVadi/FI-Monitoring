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
  build: {
    rolldownOptions: {
      output: {
        // Vendor code changes far less often than app code. Giving React and
        // the 3D globe stack their own chunks keeps them cached across
        // deploys: editing a page no longer invalidates the ~1MB three.js
        // bundle or the React runtime every visitor already has. The globe
        // group is only imported by the lazy landing-page scene.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 20 },
            { name: 'globe-vendor', test: /[\\/]node_modules[\\/](three|@react-three|gsap|react-reconciler|its-fine|zustand|suspend-react|react-use-measure)[\\/]/, priority: 10 },
          ],
        },
      },
    },
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
