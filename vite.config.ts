import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// getUserMedia (Food barcode scanner) requires a secure context. Plain HTTP is
// only treated as secure on localhost, not on LAN/Tailscale/mobile origins.
// Use a cached self-signed cert for the dev server so camera scanning works
// when testing from another device. Browsers may require a one-time trust/click-through.
const tlsDir = '.data/tls'
const keyFile = `${tlsDir}/key.pem`
const certFile = `${tlsDir}/cert.pem`

if (!existsSync(keyFile) || !existsSync(certFile)) {
  mkdirSync(tlsDir, { recursive: true })
  execSync(
    `openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes -subj "/CN=health-mcp-dev" -keyout ${keyFile} -out ${certFile}`,
    { stdio: 'ignore' },
  )
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: true,
    https: { key: readFileSync(keyFile), cert: readFileSync(certFile) },
    proxy: { '/api': 'http://127.0.0.1:42815' },
  },
  build: { outDir: 'dist' },
})
