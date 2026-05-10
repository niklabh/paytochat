// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev ERC-20 that burns `feeBps` of every transfer to a sink address.
 *      Used to verify the escrow correctly records the actually-received
 *      amount instead of the requested amount.
 */
contract MockFeeOnTransfer is ERC20 {
    address public constant SINK = 0x000000000000000000000000000000000000dEaD;
    uint256 public immutable feeBps;

    constructor(uint256 _feeBps) ERC20("FeeOnTransfer", "FOT") {
        require(_feeBps < 10_000, "FOT: fee >= 100%");
        feeBps = _feeBps;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Skip fee on mint / burn
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        if (fee == 0) {
            super._update(from, to, value);
            return;
        }
        super._update(from, SINK, fee);
        super._update(from, to, value - fee);
    }
}
