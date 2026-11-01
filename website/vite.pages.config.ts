import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

// The events.vex token the site uses to read official data itself (see
// lib/direct-profile.ts). It comes from the shell or website/.env.local, both
// outside git; CI passes a repository secret. Without one the site reads
// everything through the Worker, as before.
const directToken=process.env.VEX_DIRECT_TOKEN||loadEnv('production',fileURLToPath(new URL('.',import.meta.url)),'VEX_').VEX_DIRECT_TOKEN||'';

export default defineConfig({
  root:fileURLToPath(new URL('./static-site',import.meta.url)),
  base:'/Vex-Rank/',
  publicDir:fileURLToPath(new URL('./public',import.meta.url)),
  resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
  plugins:[react()],
  server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{target:process.env.VEX_API_PROXY||'https://vexrank-api-test.qiansteven54.workers.dev',changeOrigin:true}}},
  css:{postcss:{plugins:[tailwindcss()]}},
  define:{
    __VEX_API_BASE__:JSON.stringify(process.env.VEX_API_BASE || 'https://vexrank-api-test.qiansteven54.workers.dev'),
    __VEX_ASSET_BASE__:JSON.stringify('/Vex-Rank/'),
    __VEX_DIRECT_TOKEN__:JSON.stringify(directToken),
  },
  build:{outDir:'../dist-pages',emptyOutDir:true},
});
