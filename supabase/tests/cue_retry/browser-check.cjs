const {spawnSync}=require('node:child_process');const path=require('node:path');
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE to the existing test-only local installation');
const root=path.resolve(__dirname,'../../..');
const proof=spawnSync(process.execPath,['supabase/tests/cue_retry/pglite-check.mjs'],{cwd:root,env:process.env,encoding:'utf8'});process.stdout.write(proof.stdout||'');process.stderr.write(proof.stderr||'');if(proof.status!==0)process.exit(proof.status||1);
const directory=proof.stdout.match(/LOCAL_CUE_DB (\S+)/)?.[1];if(!directory)throw Error('No owned DB directory');
const browser=spawnSync(process.execPath,['frontend/node_modules/@playwright/test/cli.js','test','--config','supabase/tests/cue_retry/playwright.config.mjs'],{cwd:root,env:{...process.env,CUE_TEST_DB_DIR:directory},stdio:'inherit'});process.exit(browser.status===0?0:browser.status||1);
