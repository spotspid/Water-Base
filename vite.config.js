import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// The time of the build, printed in the rebuilt shell's sidebar.
//
// Not decoration. Half an hour went into a missing logo that was present in
// every file, in the built chunk and in the server's response, because there
// was no way to tell from the screen which build was on it. A visible stamp
// answers that in one glance instead of three rounds of guessing.
const BUILT = new Date().toLocaleString('en-US', {
  timeZone: 'America/Detroit',
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

export default defineConfig({
  plugins: [react()],
  define: { __BUILT__: JSON.stringify(BUILT) },
})
