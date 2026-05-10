/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/paytochat_escrow.json`.
 */
export type PaytochatEscrow = {
  "address": "EFfsYcyU8L6K7rKGW5wbwrn5EiVqhL6yyr6xBqxc3rwB",
  "metadata": {
    "name": "paytochatEscrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Escrow program for paytochat.fun: holds an SPL tip until the recipient claims (with a small fee) or the sender refunds after a deadline."
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "newAdmin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "payment.mint",
                "account": "payment"
              }
            ]
          }
        },
        {
          "name": "payment",
          "docs": [
            "Closing back to the original sender returns the rent lamports.",
            "`address = payment.sender` ensures this is the right account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "paymentId"
              }
            ]
          }
        },
        {
          "name": "sender",
          "docs": [
            "Original sender, used solely as the rent-return target. Does not",
            "need to sign; just needs to match `payment.sender`."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "payment.mint",
                "account": "payment"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "recipientTokenAccount",
          "writable": true
        },
        {
          "name": "recipient",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "paymentId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "tokenConfig"
          ]
        },
        {
          "name": "tokenConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "payment",
          "docs": [
            "New per-payment PDA. `init` ensures the same payment_id cannot be",
            "used while a previous deposit with that id is still Pending."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "paymentId"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "docs": [
            "`claim` via `address = payment.recipient`."
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "senderTokenAccount",
          "writable": true
        },
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "paymentId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "refund",
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "payment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "paymentId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "payment.mint",
                "account": "payment"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "senderTokenAccount",
          "writable": true
        },
        {
          "name": "sender",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "paymentId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setFeeBps",
      "discriminator": [
        2,
        161,
        245,
        141,
        111,
        32,
        39,
        198
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "newFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setTokenAllowed",
      "docs": [
        "Allow or disallow a mint for new deposits. The Vault token account",
        "and the TokenConfig PDA are created on first allowlisting.",
        "Existing pending payments in a now-disallowed mint can still be",
        "claimed and refunded — the allowlist gate is only on `deposit`."
      ],
      "discriminator": [
        82,
        222,
        98,
        240,
        225,
        63,
        10,
        169
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Per-mint vault. Owned by `vault_authority` PDA, so only this",
            "program (with the right seeds) can move tokens out."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "allowed",
          "type": "bool"
        }
      ]
    },
    {
      "name": "transferAdmin",
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdrawFees",
      "discriminator": [
        198,
        212,
        171,
        109,
        144,
        215,
        174,
        89
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "tokenConfig"
          ]
        },
        {
          "name": "tokenConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "payment",
      "discriminator": [
        227,
        231,
        51,
        26,
        244,
        88,
        4,
        148
      ]
    },
    {
      "name": "tokenConfig",
      "discriminator": [
        92,
        73,
        255,
        43,
        107,
        51,
        117,
        101
      ]
    }
  ],
  "events": [
    {
      "name": "adminTransferStartedEvent",
      "discriminator": [
        183,
        116,
        174,
        138,
        224,
        48,
        95,
        13
      ]
    },
    {
      "name": "adminTransferredEvent",
      "discriminator": [
        158,
        233,
        64,
        41,
        184,
        122,
        98,
        76
      ]
    },
    {
      "name": "claimedEvent",
      "discriminator": [
        144,
        172,
        209,
        86,
        144,
        87,
        84,
        115
      ]
    },
    {
      "name": "depositedEvent",
      "discriminator": [
        199,
        86,
        202,
        20,
        77,
        150,
        160,
        164
      ]
    },
    {
      "name": "feeUpdatedEvent",
      "discriminator": [
        124,
        0,
        33,
        112,
        38,
        152,
        178,
        195
      ]
    },
    {
      "name": "feesWithdrawnEvent",
      "discriminator": [
        93,
        177,
        0,
        69,
        15,
        156,
        73,
        194
      ]
    },
    {
      "name": "initializedEvent",
      "discriminator": [
        136,
        202,
        63,
        120,
        152,
        146,
        41,
        79
      ]
    },
    {
      "name": "pausedEvent",
      "discriminator": [
        43,
        14,
        250,
        236,
        116,
        42,
        177,
        89
      ]
    },
    {
      "name": "refundedEvent",
      "discriminator": [
        220,
        3,
        153,
        244,
        133,
        189,
        73,
        119
      ]
    },
    {
      "name": "tokenAllowlistEvent",
      "discriminator": [
        254,
        90,
        116,
        252,
        254,
        204,
        250,
        105
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidPaymentId",
      "msg": "payment_id is all zeros"
    },
    {
      "code": 6001,
      "name": "invalidStatus",
      "msg": "payment is not in Pending status"
    },
    {
      "code": 6002,
      "name": "tokenNotAllowed",
      "msg": "token mint is not allowlisted"
    },
    {
      "code": 6003,
      "name": "invalidAmount",
      "msg": "amount must be greater than zero"
    },
    {
      "code": 6004,
      "name": "invalidRecipient",
      "msg": "recipient is invalid (zero or self)"
    },
    {
      "code": 6005,
      "name": "invalidDeadline",
      "msg": "deadline must be in the future"
    },
    {
      "code": 6006,
      "name": "notRecipient",
      "msg": "only the recipient can claim this payment"
    },
    {
      "code": 6007,
      "name": "notSender",
      "msg": "only the original sender can refund this payment"
    },
    {
      "code": 6008,
      "name": "deadlineNotPassed",
      "msg": "deadline has not passed yet"
    },
    {
      "code": 6009,
      "name": "feeTooHigh",
      "msg": "fee exceeds the hard cap (1000 bps = 10%)"
    },
    {
      "code": 6010,
      "name": "noFeesToWithdraw",
      "msg": "no fees accumulated for this mint"
    },
    {
      "code": 6011,
      "name": "zeroAddress",
      "msg": "admin pubkey cannot be the zero address"
    },
    {
      "code": 6012,
      "name": "notAdmin",
      "msg": "only the admin can perform this action"
    },
    {
      "code": 6013,
      "name": "noPendingAdmin",
      "msg": "no pending admin transfer is in progress"
    },
    {
      "code": 6014,
      "name": "notPendingAdmin",
      "msg": "only the pending_admin can accept the transfer"
    },
    {
      "code": 6015,
      "name": "tokenMismatch",
      "msg": "token mismatch between accounts"
    },
    {
      "code": 6016,
      "name": "senderMismatch",
      "msg": "rent-return target does not match payment.sender"
    },
    {
      "code": 6017,
      "name": "overflow",
      "msg": "u64 overflow in fee math"
    },
    {
      "code": 6018,
      "name": "paused",
      "msg": "program is paused; new deposits are blocked"
    }
  ],
  "types": [
    {
      "name": "adminTransferStartedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "currentAdmin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "adminTransferredEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "newAdmin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "claimedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paymentId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amountToRecipient",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultAuthorityBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "depositedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paymentId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldFeeBps",
            "type": "u16"
          },
          {
            "name": "newFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "feesWithdrawnEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initializedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "pausedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "payment",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paymentId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "refundedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paymentId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenAllowlistEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "allowed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "tokenConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "isAllowed",
            "type": "bool"
          },
          {
            "name": "accumulatedFees",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
