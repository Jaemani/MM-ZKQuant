import { readFileSync } from 'node:fs';
import solc from 'solc';
import { AbiCoder, keccak256, TypedDataEncoder, toUtf8Bytes } from 'ethers';
import { canonicalJson } from '../shared/protocol.js';

export const hash = value => keccak256(toUtf8Bytes(canonicalJson(value)));
export const TYPES = { Approval: [
  ['sequence','uint256'],['previous','bytes32'],['requestId','bytes32'],['intent','bytes32'],
  ['kind','uint8'],['tokenIn','address'],['amount','uint256'],['minOut','uint256'],['recipient','address'],['deadline','uint256'],
].map(([name,type])=>({name,type})) };
export const domain = (chainId,vault,policyHash) => ({name:'MM_APPROVED_VAULT',version:'1',chainId,verifyingContract:vault,salt:policyHash});
export const approvalDigest = (context,a) => TypedDataEncoder.hash(domain(context.chainId,context.vault,context.policyHash),TYPES,a);
export const nextCheckpoint = (previous,digest,out) => keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32','uint256'],[previous,digest,out]));
let compiled;
export function compileApprovedVault() {
  if(compiled)return compiled;
  const content=readFileSync(new URL('../../contracts/integration/ApprovedVault.sol',import.meta.url),'utf8');
  const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'ApprovedVault.sol':{content}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
  const errors=(result.errors||[]).filter(e=>e.severity==='error');
  if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
  const a=result.contracts['ApprovedVault.sol'].ApprovedVault;
  return compiled={abi:a.abi,bytecode:'0x'+a.evm.bytecode.object,sourceHash:hash(content),compiler:solc.version()};
}
export const ERC20=['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)','function approve(address,uint256) returns(bool)','function transfer(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)'];
