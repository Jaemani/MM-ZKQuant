import {readFileSync} from 'node:fs';
import solc from 'solc';

export function compileLedgerContracts() {
 const sources=Object.fromEntries(['contracts/platform/PlatformLedgerCheckpoint.sol','public/zk/platform-ledger-v1/LedgerVerifier.sol'].map(path=>[path,{content:readFileSync(path,'utf8')}]));
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 const errors=(output.errors||[]).filter(error=>error.severity==='error');if(errors.length)throw Error(errors.map(error=>error.formattedMessage).join('\n'));
 const contract=(path,name)=>{const c=output.contracts[path][name];return {abi:c.abi,bytecode:'0x'+c.evm.bytecode.object};};
 return {LedgerVerifier:contract('public/zk/platform-ledger-v1/LedgerVerifier.sol','Groth16Verifier'),PlatformLedgerCheckpoint:contract('contracts/platform/PlatformLedgerCheckpoint.sol','PlatformLedgerCheckpoint')};
}
