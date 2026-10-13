const {timingSafeEqual}=require('node:crypto');
const {processOutbox}=require('./notifications');

function authorizedJobRequest(header,secret=process.env.CUTLY_JOB_TOKEN){
 if(typeof secret!=='string'||secret.length<32||typeof header!=='string')return false;
 const actual=Buffer.from(header),expected=Buffer.from(`Bearer ${secret}`);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
async function dispatchScheduledNotifications(db,header){
 if(!authorizedJobRequest(header))return {status:401,body:{error:'authentication_required'}};
 return {status:200,body:await processOutbox(db,{limit:20})};
}
module.exports={authorizedJobRequest,dispatchScheduledNotifications};
