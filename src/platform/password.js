import {randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive);
export function normalizeUsername(value) {
  const username=String(value||'').trim().toLowerCase();
  if(!/^[a-z0-9._-]{3,32}$/.test(username))throw Error('INVALID_USERNAME');
  return username;
}
export async function hashPassword(password) {
  if(typeof password!=='string'||password.length<8||password.length>128)throw Error('INVALID_PASSWORD');
  const salt=randomBytes(16).toString('hex');
  const key=await scrypt(password,salt,64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password,encoded) {
  if(typeof password!=='string'||password.length>128)return false;
  const [scheme,salt,key]=String(encoded||'').split(':');
  if(scheme!=='scrypt'||!salt||!/^[a-f0-9]{128}$/.test(key||''))return false;
  return timingSafeEqual(await scrypt(password,salt,64),Buffer.from(key,'hex'));
}
