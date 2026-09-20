import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

function atomicJson(path,value){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.pending';
  writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flush:true});renameSync(temporary,path);
  const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
}

const keyFor=(secret,context)=>Buffer.from(hkdfSync('sha256',secret,Buffer.alloc(32),Buffer.from(context),32));
export function seal(key,value,context) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(context));
  const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
  return {version:1,iv:iv.toString('hex'),data:data.toString('hex'),tag:cipher.getAuthTag().toString('hex')};
}
export function unseal(key,box,context,maxHexLength=2_000_000) {
  if(box?.version!==1||typeof box.data!=='string'||box.data.length>maxHexLength||box.data.length%2!==0||!/^[0-9a-f]+$/.test(box.data)||!/^[0-9a-f]{24}$/.test(box.iv||'')||!/^[0-9a-f]{32}$/.test(box.tag||''))throw Error('Invalid encrypted payload');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(box.iv,'hex'));
  decipher.setAAD(Buffer.from(context));decipher.setAuthTag(Buffer.from(box.tag,'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'hex')),decipher.final()]).toString());
}
export class SealedStore {
  constructor(path,secret,context){this.path=path;this.context=context;this.key=keyFor(secret,'MM_STORE:'+context);}
  read(){return existsSync(this.path)?unseal(this.key,JSON.parse(readFileSync(this.path)),this.context):null;}
  write(value){atomicJson(this.path,seal(this.key,value,this.context));}
}
export function encryptionIdentity(secret,{maxHexLength=2_000_000}={}) {
  const ecdh=createECDH('secp256k1');ecdh.setPrivateKey(secret);
  return {publicKey:ecdh.getPublicKey('hex','compressed'),open(packet){
    const key=keyFor(ecdh.computeSecret(Buffer.from(packet.ephemeral,'hex')),'MM_CHANNEL_V1');
    return {message:unseal(key,packet.box,'request',maxHexLength),reply:value=>seal(key,value,'response')};
  }};
}
export function encryptRequest(publicKey,message) {
  const ephemeral=createECDH('secp256k1');ephemeral.generateKeys();
  const key=keyFor(ephemeral.computeSecret(Buffer.from(publicKey,'hex')),'MM_CHANNEL_V1');
  return {packet:{ephemeral:ephemeral.getPublicKey('hex','compressed'),box:seal(key,message,'request')},openReply:box=>unseal(key,box,'response')};
}
