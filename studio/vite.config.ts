import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react()],server:{strictPort:true,host:'127.0.0.1',port:1420,warmup:{clientFiles:['./src/main.tsx','./src/App.tsx','./src/ChatCenter.tsx','./src/ControlCenter.tsx']},watch:/* KWT_STUDIO_COLDBOOT_RECOVERY_V1 */{ignored:['**/src-tauri/target/**','**/src-tauri/gen/**']}},clearScreen:false})
