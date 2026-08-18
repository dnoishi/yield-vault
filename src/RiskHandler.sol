// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {
    ISomniaReactivityPrecompile
} from "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";
import {ISpotPool, IYieldVaultRiskTarget} from "./interfaces/IDreamDex.sol";

/// @notice Same-block circuit breaker driven by Somnia EpochTick system events.
contract RiskHandler is SomniaEventHandler, Ownable {
    bytes32 public constant REASON_CROSSED_BOOK = keccak256("CROSSED_BOOK");
    bytes32 public constant REASON_SPREAD = keccak256("MAX_SPREAD");
    bytes32 public constant REASON_PRICE_MOVE = keccak256("MAX_PRICE_MOVE");

    ISpotPool public immutable pool;
    IYieldVaultRiskTarget public vault;
    uint16 public maxSpreadBps;
    uint16 public maxMoveBps;
    uint256 public lastMid;
    uint256 public subscriptionId;

    event VaultBound(address indexed vault);
    event RiskChecked(uint256 mid, uint256 spreadBps, uint256 moveBps);
    event SubscriptionStarted(uint256 indexed subscriptionId);
    event SubscriptionStopped(uint256 indexed subscriptionId);

    error AlreadyBound();
    error InvalidBps();
    error InvalidEvent();
    error NotBound();
    error SubscriptionActive();
    error NoSubscription();

    constructor(ISpotPool pool_, address owner_, uint16 maxSpreadBps_, uint16 maxMoveBps_) Ownable(owner_) {
        pool = pool_;
        _setThresholds(maxSpreadBps_, maxMoveBps_);
    }

    receive() external payable {}

    function bindVault(IYieldVaultRiskTarget vault_) external onlyOwner {
        if (address(vault) != address(0)) revert AlreadyBound();
        if (address(vault_) == address(0)) revert NotBound();
        vault = vault_;
        emit VaultBound(address(vault_));
    }

    function setThresholds(uint16 spreadBps, uint16 moveBps) external onlyOwner {
        _setThresholds(spreadBps, moveBps);
    }

    function startSubscription(SomniaExtensions.SubscriptionOptions calldata options)
        external
        onlyOwner
        returns (uint256 id)
    {
        if (subscriptionId != 0) revert SubscriptionActive();
        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: [ISomniaReactivityPrecompile.EpochTick.selector, bytes32(0), bytes32(0), bytes32(0)],
            origin: address(0),
            emitter: SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS
        });
        id = SomniaExtensions.subscribe(address(this), filter, options);
        subscriptionId = id;
        emit SubscriptionStarted(id);
    }

    function stopSubscription() external onlyOwner {
        uint256 id = subscriptionId;
        if (id == 0) revert NoSubscription();
        subscriptionId = 0;
        SomniaExtensions.unsubscribe(id);
        emit SubscriptionStopped(id);
    }

    function checkNow() external onlyOwner {
        _checkRisk();
    }

    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata) internal override {
        if (
            emitter != SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS || eventTopics.length == 0
                || eventTopics[0] != ISomniaReactivityPrecompile.EpochTick.selector
        ) revert InvalidEvent();
        _checkRisk();
    }

    function _checkRisk() internal {
        if (address(vault) == address(0)) revert NotBound();
        ISpotPool.BookLevel[] memory bids = pool.getBookLevels(true, 1);
        ISpotPool.BookLevel[] memory asks = pool.getBookLevels(false, 1);
        if (bids.length == 0 || asks.length == 0) return;

        uint256 bid = bids[0].price;
        uint256 ask = asks[0].price;
        if (ask <= bid) {
            vault.emergencyHalt(REASON_CROSSED_BOOK);
            return;
        }

        uint256 mid = (bid + ask) / 2;
        uint256 spreadBps = Math.mulDiv(ask - bid, 10_000, mid);
        uint256 moveBps;
        if (lastMid != 0) {
            uint256 delta = mid > lastMid ? mid - lastMid : lastMid - mid;
            moveBps = Math.mulDiv(delta, 10_000, lastMid);
        }
        lastMid = mid;
        emit RiskChecked(mid, spreadBps, moveBps);

        if (spreadBps > maxSpreadBps) {
            vault.emergencyHalt(REASON_SPREAD);
        } else if (moveBps > maxMoveBps) {
            vault.emergencyHalt(REASON_PRICE_MOVE);
        }
    }

    function _setThresholds(uint16 spreadBps, uint16 moveBps) internal {
        if (spreadBps == 0 || moveBps == 0 || spreadBps > 10_000 || moveBps > 10_000) {
            revert InvalidBps();
        }
        maxSpreadBps = spreadBps;
        maxMoveBps = moveBps;
    }
}
