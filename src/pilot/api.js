import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PilotCoordinator } from './coordinator.js';
import { collectMarket } from './market.js';
import { atomicJson } from './chain.js';
const readOptional=path=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
export class PilotApi {
  constructor(directory,project) {this.directory=directory;this.project=project;this.coordinator=new PilotCoordinator(directory);}
  get(path,url) {
    if(path==='/api/pilot/status') {
      const local=readOptional(join(this.project,'docs/evidence/pilot-local.json'));
      const wallet=readOptional(join(this.directory,'wallet.json'));
      const deployment=readOptional(join(this.directory,'deployment.json'));
      return {...this.coordinator.publicState(),wallet:wallet?{address:wallet.address,chainId:10143}:null,
        deployment:deployment?{fund:deployment.fund.address,venue:deployment.venue.address,cash:deployment.cash.address,deposit:deployment.deposit}:null,
        market:readOptional(join(this.directory,'latest-market.json')),
        verification:readOptional(join(this.directory,'verification.json')),
        localEvidence:local?{environment:local.environment,generatedAt:local.generatedAt,epochs:local.epochs.map(e=>({id:e.id,sequence:e.sequence,evaluation:e.evaluation,chain:e.chain})),
          checks:local.checks,tokenConservation:local.tokenConservation,redemption:local.redemption}:null};
    }
    if(path==='/api/pilot/evidence')return readOptional(join(this.directory,'external-evidence.json'))||readOptional(join(this.project,'docs/evidence/pilot-local.json'))||{status:'NO_EVIDENCE'};
    if(path==='/api/pilot/receipt') {
      const s=this.coordinator.read(),e=s.epochs.find(e=>e.id===url.searchParams.get('epoch'));
      const key=url.searchParams.get('key'),submission=e?.submissions[key];if(!submission)throw new Error('Receipt not found');
      if(!e.root)return submission.receipt;
      this.coordinator.verify(e);const index=e.leaves.findIndex(l=>l.publicKey===key);
      return {...submission.receipt,leaf:e.leaves[index],proof:e.proofs[index],root:e.root,manifest:e.manifest,manifestHash:e.manifestHash,chain:e.chain};
    }
    throw new Error('Pilot endpoint not found');
  }
  async post(path,body) {
    if(path==='/api/pilot/enroll')return this.coordinator.enroll(body);
    if(path==='/api/pilot/submit')return this.coordinator.submit(body);
    if(path==='/api/pilot/market') {const result=await collectMarket();atomicJson(join(this.directory,'latest-market.json'),result);return result;}
    throw new Error('Pilot endpoint not found');
  }
}
