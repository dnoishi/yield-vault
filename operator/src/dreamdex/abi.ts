/**
 * Minimal DreamDEX ABI adapted from somnia-chain/dreamdex-bot-kit (MIT-style).
 */
import { parseAbi } from "viem";

export const SPOT_POOL_ABI = parseAbi([
  "function getPoolParams() view returns (address baseToken,address quoteToken,uint256 makerFee,uint256 takerFee,uint256 tickSize,uint256 minQuantity,uint256 lotSize)",
  "function getBookLevels(bool isBid,uint64 numLevels) view returns ((uint256 price,uint256 quantity)[])",
  "function getWithdrawableBalance(address owner,address token) view returns (uint256)",
  "function getOwnOpenOrders() view returns (uint128[])",
  "function getOrder(uint128 orderId) view returns ((uint128 orderId,bool isBid,address owner,uint64 userData,uint256 price,uint256 fullQuantity,uint256 quantityRemaining,uint64 expireTimestampNs))",
  "function placeOrderFor(address owner,bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) payable returns (bool success,uint128 orderId)",
  "function cancelOrderFor(address owner,uint128 orderId)",
  "function getManualVaultMode(address user) view returns (bool)",
]);

export const VAULT_ABI = parseAbi([
  "function paused() view returns (bool)",
  "function totalAssets() view returns (uint256)",
  "function operator() view returns (address)",
  "function enableManualVaultMode()",
  "function setOperator(address operator,bool approved)",
]);

export const TOPIC_ORDER_PLACED =
  "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";

export const ORDER_TYPE = {
  GTC: 0,
  FillOrKill: 1,
  ImmediateOrCancel: 2,
  PostOnly: 3,
} as const;

export const SELF_MATCH_CANCEL_TAKER = 0;
