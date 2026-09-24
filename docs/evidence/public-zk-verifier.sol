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
    uint256 constant deltax1 = 8595011350405709454800646945773973019179517885239718663754388522832145210771;
    uint256 constant deltax2 = 9060749026406420333641099657492561986150351456163547599054536853970431263364;
    uint256 constant deltay1 = 14127677070044438464823792979432979049469331619283703462025393078083581064175;
    uint256 constant deltay2 = 21325987303496837838337951523332272336989303160682736130067941468119745121037;

    
    uint256 constant IC0x = 20192747922079586128471242463074544646524123659190963939858430598184023375577;
    uint256 constant IC0y = 5431433760417644027383119045898276754028511730903485814870705525807109454301;
    
    uint256 constant IC1x = 7227142253690467050667925586888031076791751003635197900873998764260753543583;
    uint256 constant IC1y = 21169734435819400800756053113035761685249566278063701971509080669014446213062;
    
    uint256 constant IC2x = 13187674320962897097290346580544879169527169240851856285165592228789427927058;
    uint256 constant IC2y = 8755571709017763663549941875148319704673631227022570514450557741474320061744;
    
    uint256 constant IC3x = 3487768043582988182596634365177892444444543491438899405728150113156269550097;
    uint256 constant IC3y = 8083144962374846969516848591713775369110239458800246792004046135461320638991;
    
    uint256 constant IC4x = 14822170016393904551323976023683921225819860914763168553690803422359228164571;
    uint256 constant IC4y = 17948703284270680952268165445749272510848865149440510607522028762109831088636;
    
    uint256 constant IC5x = 12600410428372692644909202841376073626316359720895897104216845249557785356996;
    uint256 constant IC5y = 20652695166290894577698436643399500081412215803764434270084127010706142026394;
    
    uint256 constant IC6x = 16639745548008049046290184274340565873036667507747122829657271418914839386412;
    uint256 constant IC6y = 1211332170127609222732314317203307871444460484305157166546614480236011544036;
    
    uint256 constant IC7x = 21165917491989031421049636585395141297259805135453711749025045379051155861622;
    uint256 constant IC7y = 12619972133724245776347951673204690570135134222642680322911548066181680725394;
    
    uint256 constant IC8x = 18196128420876000423642369265472732895414197986376184356356390137718599160068;
    uint256 constant IC8y = 11623344091663775095546221028476687962275911476483738911364758360891081240594;
    
    uint256 constant IC9x = 14279703661374075891974649816505745379516802166210122957534676385428846384447;
    uint256 constant IC9y = 10684118651591759713123880866296206962599926486553629583848708976633004452158;
    
    uint256 constant IC10x = 10172819090278802214924629434673879920120123401848447313159464787089100469183;
    uint256 constant IC10y = 1420006265241942403415096569246609370060799947139534951062780565297810263546;
    
    uint256 constant IC11x = 14964039397835922037943650095567930116477451097870278119990494679222454392641;
    uint256 constant IC11y = 20223325628463669098283552250729959260143992259334574731714692312677197213986;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[11] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
