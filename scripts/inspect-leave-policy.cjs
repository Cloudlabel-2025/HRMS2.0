require('@next/env').loadEnvConfig(process.cwd());
const m = require('mongoose');
const {setServers}=require('node:dns');
if(process.env.MONGODB_DNS_SERVERS) setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s=>s.trim()));
(async()=>{try{await m.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
const policies=await m.connection.db.collection('leavepolicies').find({status:'active'},{projection:{name:1,effectiveFrom:1,leaveTypeConfigs:1}}).toArray();
console.log(JSON.stringify(policies.map(p=>({...p,leaveTypeConfigs:p.leaveTypeConfigs.map(t=>({code:t.code,name:t.name,enabled:t.enabled,genderRestriction:t.genderRestriction,isPaid:t.isPaid,annualAllocation:t.annualAllocation,creditSchedule:t.creditSchedule,usagePeriod:t.usagePeriod,maxUsagePerPeriod:t.maxUsagePerPeriod,carryForwardAllowed:t.carryForwardAllowed,unusedPeriodRollover:t.unusedPeriodRollover,balanceMode:t.balanceMode}))}))));
}catch(e){console.error(e.name);process.exitCode=1;}finally{await m.disconnect();}})();
