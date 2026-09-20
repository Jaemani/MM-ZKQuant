import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const dir=resolve('.data/tee-probe');mkdirSync(dir,{recursive:true,mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex');
const token=randomBytes(32).toString('hex');
const source=readFileSync('deploy/tee/probe/server.mjs'),sealed=readFileSync('src/integration/sealed.js');
const pkg=readFileSync('deploy/tee/probe/package.json'),lock=readFileSync('deploy/tee/probe/package-lock.json');
const build=JSON.parse(readFileSync('artifacts/zk/build.json'));
const manifest={sourceHash:sha(Buffer.concat([source,sealed])),lockSha256:sha(lock),circuitSha256:build.circuitSha256,wasmSha256:build.wasmSha256,zkeySha256:build.zkeySha256,accessHash:sha(token)};
const files={'server.mjs':source,'sealed.mjs':sealed,'package.json':pkg,'package-lock.json':lock,'manifest.json':Buffer.from(JSON.stringify(manifest))};
const entries=Object.entries(files).map(([p,b])=>[p,b.toString('base64')]);
const bootstrap=`const fs=require('fs');for(const [p,b] of ${JSON.stringify(entries)})fs.writeFileSync('/app/'+p,Buffer.from(b,'base64'));`;
const bootstrapCommand=`node -e 'eval(Buffer.from("${Buffer.from(bootstrap).toString('base64')}","base64").toString())'`;
// Pin image, source and npm integrity lock without a public image registry.
// This is an experiment bootstrap, not the production measured-image pipeline.
const compose={services:{probe:{image:'node:22.23.0-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2',working_dir:'/app',entrypoint:['sh','-c',`${bootstrapCommand} && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && exec node server.mjs`],ports:['8080:8080'],volumes:['/var/run/dstack.sock:/var/run/dstack.sock'],tmpfs:['/app:rw,size=768m','/work:rw,size=512m'],restart:'no',mem_limit:'1536m'}}};
const composeText=JSON.stringify(compose,null,2); // JSON is valid Compose YAML.
writeFileSync(dir+'/compose.yaml',composeText+'\n',{mode:0o600});
writeFileSync(dir+'/client.json',JSON.stringify({token,manifest,composeSha256:sha(composeText+'\n')},null,2),{mode:0o600});
console.log(JSON.stringify({compose:dir+'/compose.yaml',composeBytes:Buffer.byteLength(composeText),manifest,limit:'maximum $2; delete CVM after experiment'}));
