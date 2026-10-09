import {defineConfig} from '@playwright/test';
export default defineConfig({outputDir:'./test-results-visual',testDir:'./e2e',testMatch:'invite-visual.spec.mjs',workers:1,use:{baseURL:'http://127.0.0.1:4187'},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4187',url:'http://127.0.0.1:4187',reuseExistingServer:false}});
