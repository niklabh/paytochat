// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @dev Minimal token whose `transfer` / `transferFrom` / `approve` return
 *      NOTHING — like real USDT on Ethereum mainnet. Used to verify that
 *      SafeERC20 in the escrow handles non-bool-returning ERC-20s.
 *
 *      Intentionally NOT inheriting from OZ's ERC20 because we need the
 *      function selectors to match those of USDT (no return value).
 */
contract MockUSDTLike {
    string public name = "MockUSDT";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "USDT: insufficient");
        unchecked {
            balanceOf[msg.sender] -= amount;
        }
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "USDT: allowance");
        if (a != type(uint256).max) {
            unchecked {
                allowance[from][msg.sender] = a - amount;
            }
        }
        require(balanceOf[from] >= amount, "USDT: insufficient");
        unchecked {
            balanceOf[from] -= amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
