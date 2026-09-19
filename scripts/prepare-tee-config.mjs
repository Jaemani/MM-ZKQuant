import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Wallet, getCreateAddress, JsonRpcProvider } from 'ethers';
import { hash, compileApprovedVault } from '../src/integration/protocol.js';

// Generates isolated PoC identities; never uses the old local/testnet fixture
// keys and never funds a wallet, deploys a contract or sends a transaction.
const directory=resolve(process.env.MM_LIVE_DIR||'.data/integration-live');mkdirSync(directory,{recursive:true,mode:0o700});
const path=join(directory,'wallets.json');
if(!existsSync(path)){
  const keys=Object.fromEntries(['deployer','investorA','investorB','providerA','providerB'].map(role=>{const w=Wallet.createRandom();return [role,{address:w.address,privateKey:w.privateKey}];}));
  writeFileSync(path,JSON.stringify(keys,null,2),{mode:0o600,flag:'wx'});
}
const wallets=JSON.parse(readFileSync(path));
const rpcUrl=process.env.MM_MONAD_READ_RPC||'https://rpc2.monad.xyz',rpc=new JsonRpcProvider(rpcUrl,undefined,{batchMaxCount:1});
try {
  if((await rpc.getNetwork()).chainId!==143n)throw Error('Monad mainnet configuration required');
  const nonce=await rpc.getTransactionCount(wallets.deployer.address,'pending');
  const config={chainId:143,rpcUrl,vault:getCreateAddress({from:wallets.deployer.address,nonce}),policy:{cash:'0x754704Bc059F8C67012fEd69BC8A327a5aafb603',asset:'0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',router:'0xd6145b2d3f379919e8cdeda7b97e37c4b2ca9c40',quoter:'0x661e93cca42afacb172121ef892830ca3b70f08d',fee:500,slippageBps:50,performanceFeeBps:0,maxTargetBps:2500,strategies:[{id:'alpha-a',provider:wallets.providerA.address},{id:'alpha-b',provider:wallets.providerB.address}]}};
  const configPath=join(directory,'runtime.json');
  if(existsSync(configPath)&&hash(JSON.parse(readFileSync(configPath)))!==hash(config))throw Error('Existing config differs; do not silently rotate TEE keys or deployment address');
  writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});
  const admissionPath=join(directory,'expected-attestation.json');
  if(!existsSync(admissionPath))writeFileSync(admissionPath,JSON.stringify({identity:{configHash:hash(config),policyHash:hash(config.policy),vault:config.vault,chainId:143,contractSourceHash:compileApprovedVault().sourceHash},measurements:{mrtd:null,rtmr0:null,rtmr1:null,rtmr2:null,rtmr3:null}},null,2),{mode:0o600});
  console.log(JSON.stringify({status:'CONFIG_PREPARED_NOT_DEPLOYED',config:configPath,expectedAttestation:admissionPath,deployer:wallets.deployer.address,expectedVault:config.vault,chainBroadcast:false,measurements:'Must independently approve OS/compose/KMS before verification; null pins fail closed'},null,2));
}finally{rpc.destroy();}
