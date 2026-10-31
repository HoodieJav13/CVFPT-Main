import base from '../../../frontend/vite.config.js';
export default env=>{const c=base(env);return {...c,root:new URL('../../../frontend',import.meta.url).pathname,cacheDir:'/tmp/cvf-cue-server-proof-cache',server:{...c.server,host:'127.0.0.1',port:58423,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:58420',changeOrigin:true}}}};};
