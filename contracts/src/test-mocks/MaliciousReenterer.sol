// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IEscrowReentry {
    function claim(bytes32 paymentId) external;
    function refund(bytes32 paymentId) external;
    function deposit(
        bytes32 paymentId,
        address recipient,
        address token,
        uint256 amount,
        uint64 deadline
    ) external;
}

/**
 * @dev ERC-20 that, on every transfer, attempts to reenter the escrow's
 *      claim() (or refund()) function with a configurable paymentId.
 *      The escrow's nonReentrant guard MUST cause the reentrant call to
 *      revert. This mock surfaces that revert as a top-level "Reentered"
 *      flag check in the test.
 */
contract MaliciousReenterer is ERC20 {
    IEscrowReentry public escrow;
    bytes32 public targetPaymentId;
    uint8 public mode; // 0 = none, 1 = claim, 2 = refund
    bool public reentered;

    constructor() ERC20("Reenter", "REEN") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(IEscrowReentry _escrow, bytes32 _id, uint8 _mode) external {
        escrow = _escrow;
        targetPaymentId = _id;
        mode = _mode;
        reentered = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // Only attempt reentrancy on the outbound transfer from the escrow
        // (i.e. when escrow is paying out the recipient/sender).
        if (mode != 0 && from == address(escrow)) {
            uint8 m = mode;
            mode = 0; // disarm so we attempt only once per outer call
            if (m == 1) {
                try escrow.claim(targetPaymentId) {
                    reentered = true;
                } catch {
                    reentered = false;
                }
            } else if (m == 2) {
                try escrow.refund(targetPaymentId) {
                    reentered = true;
                } catch {
                    reentered = false;
                }
            }
        }
    }
}
