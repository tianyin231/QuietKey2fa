import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccount,parseInput,serializeAccounts,prepareImport,totp,deriveKey,encryptVault,decryptVault} from '../dist/core.mjs';
function base32(text){let bits=0,value=0,result='';for(const b of new TextEncoder().encode(text)){value=(value<<8)|b;bits+=8;while(bits>=5){bits-=5;result+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value>>>bits)&31];}}if(bits)result+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value<<(5-bits))&31];return result;}
const vectors=[
 [59,'94287082','46119246','90693936'],
 [1111111109,'07081804','68084774','25091201'],
 [1111111111,'14050471','67062674','99943326'],
 [1234567890,'89005924','91819424','93441116'],
 [2000000000,'69279037','90698825','38618901'],
 [20000000000,'65353130','77737706','47863826'],
];
test('RFC 6238: all 18 reference vectors including SHA256/SHA512 and post-2038 time',async()=>{
 for(const [index,algorithm,length] of [[1,'SHA1',20],[2,'SHA256',32],[3,'SHA512',64]]){
   const a=normalizeAccount({secret:base32('1234567890'.repeat(7).slice(0,length)),algorithm,digits:8});
   for(const vector of vectors)assert.equal(await totp(a,vector[0]),vector[index]);
 }
});
test('URI, raw key, CSV quoted field and JSON imports preserve settings',()=>{
 const secret='JBSWY3DPEHPK3PXP';
 const a=parseInput(`otpauth://totp/GitHub:alex%40example.com?secret=${secret}&issuer=GitHub&algorithm=SHA256&digits=8&period=60`)[0];
 assert.equal(a.account,'alex@example.com');assert.equal(a.algorithm,'SHA256');assert.equal(a.digits,8);assert.equal(a.period,60);
 assert.equal(parseInput(`issuer,account,secret\n"Example, Inc",alex,${secret}`)[0].issuer,'Example, Inc');
 assert.equal(parseInput(JSON.stringify({accounts:[a]}))[0].period,60);
 assert.equal(parseInput('jbsw y3dp ehpk 3pxp')[0].secret,secret);
});
test('unsupported protocols and malformed inputs fail rather than silently change configuration',()=>{
 for(const input of ['otpauth://hotp/A?secret=JBSWY3DPEHPK3PXP','otpauth-migration://offline?data=test','INVALID1','[{"secret":"JBSWY3DPEHPK3PXP","digits":7}]','a,b,c,d'])assert.throws(()=>parseInput(input));
});
test('encrypted storage roundtrip, randomized ciphertext, wrong password and tampering rejection',async()=>{
 const a=normalizeAccount({issuer:'Test',secret:'JBSWY3DPEHPK3PXP'}),salt=crypto.getRandomValues(new Uint8Array(16)),password='disposable-test-password';
 const key=await deriveKey(password,salt);const one=await encryptVault([a],key,salt),two=await encryptVault([a],key,salt);
 assert.notEqual(one.data,two.data);assert.ok(!JSON.stringify(one).includes(a.secret));assert.ok(!JSON.stringify(one).includes('Test'));
 assert.equal((await decryptVault(one,password)).accounts[0].secret,a.secret);
 await assert.rejects(()=>decryptVault(one,'wrong'));
 const damaged={...one,data:(one.data[0]==='A'?'B':'A')+one.data.slice(1)};await assert.rejects(()=>decryptVault(damaged,password));
});

test('明文 JSON 往返保留原始密钥、账号设置、分组和常用标记',()=>{
 const account=normalizeAccount({issuer:'示例:服务 / A&B',account:'测试+2@example.com',secret:'jbsw y3dp ehpk 3pxp',algorithm:'SHA512',digits:8,period:60,group:'工作',favorite:true});
 const content=serializeAccounts([account]);
 assert.ok(!content.includes(account.id));
 const {id,...expected}=account;
 const {id:importedId,...actual}=parseInput(content)[0];
 assert.deepEqual(actual,expected);
 assert.notEqual(importedId,id);
});

test('密钥 TXT 每行一个原始密钥，验证链接保留特殊字符及验证码参数',async()=>{
 const accounts=[
   normalizeAccount({issuer:'示例:服务 / A&B',account:'测试:用户+2@example.com',secret:'JBSWY3DPEHPK3PXP',algorithm:'SHA256',digits:8,period:60}),
   normalizeAccount({issuer:'GitHub',account:'',secret:base32('another-test-secret'),algorithm:'SHA512',digits:6,period:45}),
 ];
 assert.equal(serializeAccounts(accounts,'text'),accounts.map(a=>a.secret).join('\n')+'\n');
 assert.deepEqual(parseInput(serializeAccounts(accounts,'text')).map(a=>a.secret),accounts.map(a=>a.secret));
 const imported=parseInput(serializeAccounts(accounts,'uri'));
 for(let i=0;i<accounts.length;i++){
   for(const key of ['issuer','account','secret','algorithm','digits','period'])assert.equal(imported[i][key],accounts[i][key]);
   assert.equal(await totp(imported[i],1234567890),await totp(accounts[i],1234567890));
 }
});

test('追加导入跳过现有及文件内重复项，同名不同密钥或不同参数仍追加',()=>{
 const original=normalizeAccount({issuer:'GitHub',account:'alex',secret:'JBSWY3DPEHPK3PXP',group:'工作',favorite:true});
 const changedMetadata={...original,issuer:'旧名称',group:'个人',favorite:false};
 const anotherSecret=normalizeAccount({...original,secret:base32('another-test-secret')});
 const anotherPeriod=normalizeAccount({...original,period:60});
 const anotherAlgorithm=normalizeAccount({...original,algorithm:'SHA256'});
 const anotherDigits=normalizeAccount({...original,digits:8});
 const existing=[original],before=structuredClone(existing);
 const result=prepareImport(existing,[changedMetadata,anotherSecret,{...anotherSecret,id:'other-id'},anotherPeriod,anotherAlgorithm,anotherDigits]);
 assert.deepEqual(result.unique,[anotherSecret,anotherPeriod,anotherAlgorithm,anotherDigits]);
 assert.equal(result.skipped,2);
 assert.deepEqual(existing,before);
 assert.deepEqual(prepareImport(existing,[changedMetadata]),{unique:[],skipped:1});
});

test('旧加密备份追加到不同密码的保险库，仍只用当前主密码解锁',async()=>{
 const existing=normalizeAccount({issuer:'本机账号',secret:'JBSWY3DPEHPK3PXP',group:'工作',favorite:true});
 const added=normalizeAccount({issuer:'旧设备账号',secret:base32('another-test-secret')});
 const sourceSalt=crypto.getRandomValues(new Uint8Array(16)),targetSalt=crypto.getRandomValues(new Uint8Array(16));
 const sourceKey=await deriveKey('source-test-password',sourceSalt),targetKey=await deriveKey('target-test-password',targetSalt);
 const backup=await encryptVault([{...existing,group:'个人',favorite:false},added,added],sourceKey,sourceSalt);
 const decoded=await decryptVault(backup,'source-test-password');
 const {unique,skipped}=prepareImport([existing],decoded.accounts);
 assert.equal(unique.length,1);assert.equal(skipped,2);
 const merged=await encryptVault([existing,...unique],targetKey,targetSalt);
 assert.notEqual(merged.salt,backup.salt);
 const restored=(await decryptVault(merged,'target-test-password')).accounts;
 assert.equal(restored.length,2);assert.equal(restored[0].group,'工作');assert.equal(restored[0].favorite,true);
 assert.equal(restored[1].secret,added.secret);
 await assert.rejects(()=>decryptVault(merged,'source-test-password'));
 assert.ok(!JSON.stringify(merged).includes(added.secret));
});

test('完整导出的账号可批量读回，超过保险库上限时拒绝',()=>{
 const account=normalizeAccount({secret:'JBSWY3DPEHPK3PXP',issuer:'a'.repeat(80),account:'b'.repeat(150),group:'c'.repeat(40)});
 const exported=serializeAccounts(Array(5000).fill(account));
 assert.ok(exported.length>2_000_000);
 assert.equal(parseInput(exported).length,5000);
 assert.throws(()=>parseInput(serializeAccounts(Array(5001).fill(account))),/5000/);
 assert.throws(()=>parseInput(Array(5001).fill(account.secret).join('\n')),/5000/);
});
