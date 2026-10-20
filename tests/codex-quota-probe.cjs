'use strict';
// Explicit read-only compatibility probe. No model/thread/reset/login methods.
const quota=require('../codex-quota.cjs'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
  const start=Date.now(),service=quota.createService();
  const state=await service.read();service.dispose();
  const report={status:state.status,elapsedMs:Date.now()-start,windows:state.windows.map(w=>({durationMins:w.windowDurationMins,hasRemaining:w.remainingPercent!==null,hasReset:w.resetsAt!==null})),hasResetCount:state.resetCredits.availableCount!==null,availableExpiryRows:state.resetCredits.expirations.length,scope:'Real installed Codex App Server read-only query. Capability flags only; no tokens, identity, raw replies, exact quota values or reset redemption.'};
  const output=path.resolve(__dirname,'../test-results/codex-quota');await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'native-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(()=>{console.error('Quota probe could not complete; no raw account details logged.');process.exitCode=1;});
