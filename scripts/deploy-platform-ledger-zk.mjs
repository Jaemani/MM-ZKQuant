import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Contract,getAddress} from 'ethers';
import {compileLedgerContracts} from '../protocol/platform/ledger-contracts.mjs';
import {createRpcPilotChain} from '../src/pilot/chain.js';

const env={...process.env};
if(existsSync('.env'))for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(m&&!env[m[1]])env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}
const manifest=JSON.parse(readFileSync('public/zk/platform-ledger-v1/manifest.json'));
for(const spec of Object.values(manifest.artifacts)){const data=readFileSync('public'+spec.path);if(data.length!==spec.bytes||createHash('sha256').update(data).digest('hex')!==spec.sha256)throw Error('Ledger artifacts differ from pinned manifest');}
const vault=getAddress(JSON.parse(readFileSync('.data/platform-live/deployment.json')).vaultAddress);
const operator=getAddress(env.PLATFORM_OPERATOR_ADDRESS||'0x711bb18cD7A82BA684cc0F7C5Bd334f9Aee795D7');
if(!process.argv.includes('--broadcast')){console.log(JSON.stringify({status:'DRY_RUN',chainId:10143,vault,operator,keyHash:manifest.artifacts.verificationKey.sha256}));process.exit(0);}
const directory='.data/platform-ledger-deployment';mkdirSync(directory,{recursive:true,mode:0o700});
const rpcUrl=(env.MONAD_TESTNET_RPC_URL||'https://testnet-rpc.monad.xyz').replace(/^(?!https?:\/\/)/,'https://');
const chain=await createRpcPilotChain(compileLedgerContracts(),{rpcUrl,privateKey:env.MONAD_TESTNET_PRIVATE_KEY},directory);
try {
 if((await new Contract(vault,['function operator() view returns(address)'],chain.rpc).operator()).toLowerCase()!==operator.toLowerCase())throw Error('Existing Vault operator mismatch');
 const verifier=await chain.deploy('ledger-verifier-v1','LedgerVerifier',[]);
 const checkpoint=await chain.deploy('ledger-checkpoint-v1','PlatformLedgerCheckpoint',[operator,vault,verifier.address,'0x'+manifest.artifacts.verificationKey.sha256]);
 const deployment={version:1,chainId:10143,vault,operator,verifier:verifier.address,checkpoint:checkpoint.address,verificationKeyHash:manifest.artifacts.verificationKey.sha256,verifierCodeHash:await chain.codeHash(verifier),checkpointCodeHash:await chain.codeHash(checkpoint),transactions:chain.transactions};
 writeFileSync('public/zk/platform-ledger-v1/deployment.json',JSON.stringify(deployment,null,2)+'\n');
 console.log(JSON.stringify({deployed:true,chainId:10143,vault,verifier:deployment.verifier,checkpoint:deployment.checkpoint,transactions:chain.transactions.map(tx=>tx.transactionHash)}));
}finally{chain.close();}
