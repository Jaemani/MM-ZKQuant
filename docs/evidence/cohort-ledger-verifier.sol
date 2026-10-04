// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 13128612240385792322819899053258816689154997862124344590051183856082582251368;
    uint256 constant alphay  = 14067376264558461533269607514503538022739821738927922776361098364409580970778;
    uint256 constant betax1  = 18571866214674374734033461093303133394614021210372866840221378920500271316900;
    uint256 constant betax2  = 8018081456733796524749680051202277246738732095874622519479710068057169511686;
    uint256 constant betay1  = 11235436333502857241453392190060713772636814070158523235246448957843639618994;
    uint256 constant betay2  = 8106753887369100946318047361822132178388233785978508520033402235178403568309;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 14996366805896847254086762588459031601552439285441005390742596235349450702369;
    uint256 constant deltax2 = 10935415354114331631035182512330575596548285570717262521477341609014169100074;
    uint256 constant deltay1 = 8560145438344246369719996337634007315130632306529283661645642888526255809801;
    uint256 constant deltay2 = 13869810966796812120775693189524113371728625046013090949595741213674226158072;

    
    uint256 constant IC0x = 4368096512668277248435192326062805759931776985423423157493325961725847029868;
    uint256 constant IC0y = 10056469927813689562189652932133908013223157886862235471174960285596145987853;
    
    uint256 constant IC1x = 20767506646891130158468747771837352265923106354072471862440505254686336442745;
    uint256 constant IC1y = 3749472603844588995081535575842802733985224231057242542494393219659057455893;
    
    uint256 constant IC2x = 21166935709476723803036537038217785118811594062633541427308354775000594410024;
    uint256 constant IC2y = 12456375447307713123653487879400138983407192205747094804900150992868683764321;
    
    uint256 constant IC3x = 16695412208346252423948835403448381746521970997135133430829741036856524207185;
    uint256 constant IC3y = 11996950839678779089257079381696839382953784571935662016794856145329717796145;
    
    uint256 constant IC4x = 5156859075619422858069063576479220866899929209466091853864416045946354981376;
    uint256 constant IC4y = 14273441718076673685840293649292624343361170266182334481238957725333581097721;
    
    uint256 constant IC5x = 9970625440762151253725556568614638345403988067200633414726222484178202619650;
    uint256 constant IC5y = 16018506303248697408080269786788960923450892607290165699997413781616742963888;
    
    uint256 constant IC6x = 783379775369236637750233436730809832200090549316671229153706367393292096855;
    uint256 constant IC6y = 10473846168265681795841182285903229875208961154318599079088650474450588819333;
    
    uint256 constant IC7x = 496026234826483941341272823707835773029560902529177694182313541235155717253;
    uint256 constant IC7y = 7868136502419257888692013016845784337400376369277828509310826826620654530680;
    
    uint256 constant IC8x = 2134690161461958152754825212238565711914379781214507211342824502995048864828;
    uint256 constant IC8y = 10251348961665861201103548189902772161582234752774300490654755309760818967609;
    
    uint256 constant IC9x = 18748537298029550172397175835847073784802092471733246279659232085016566623301;
    uint256 constant IC9y = 2154440341451227875272681518984126828017688402321919317121129354622803356631;
    
    uint256 constant IC10x = 510200870791158274619630799116544648143415053098210358875037445495251472145;
    uint256 constant IC10y = 16025552743282571283162856889576492089155419281162995525111961227400163902401;
    
    uint256 constant IC11x = 2538894173268555558846680735573449555185456950372751059169064643373761968974;
    uint256 constant IC11y = 15879340933649066368070040388618379771451390935293812230531006321137524571130;
    
    uint256 constant IC12x = 15920583942561528993241080936818796156505312974639068894267159673486357406103;
    uint256 constant IC12y = 16063362317510850957211972740818161220623764684475757136443919703152035012023;
    
    uint256 constant IC13x = 13713875161773361777556779416836571959848876573006161374757640191706326906185;
    uint256 constant IC13y = 11483108052688963146132302699210141921863000317007140372680675482101682101128;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[13] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
