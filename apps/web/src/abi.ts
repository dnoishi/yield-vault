import { parseAbi } from "viem";

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxRedeem(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256 assets)",
  "function previewDeposit(uint256 assets) view returns (uint256 shares)",
  "function previewMint(uint256) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256 assets)",
  "function paused() view returns (bool)",
  "function maxTotalAssets() view returns (uint256)",
  "function queuedLiabilities() view returns (uint256)",
  "function availableIdle() view returns (uint256)",
  "function nextRequestToProcess() view returns (uint256)",
  "function nextRequestId() view returns (uint256)",
  "function withdrawalRequests(uint256) view returns (address receiver, uint256 assets, uint64 requestedAt, bool processed)",
  "function lastHaltReason() view returns (bytes32)",
  "function deposit(uint256 assets,address receiver) returns (uint256 shares)",
  "function mint(uint256 shares,address receiver) returns (uint256 assets)",
  "function redeem(uint256 shares,address receiver,address owner) returns (uint256 assets)",
  "function requestRedeem(uint256 shares,address receiver) returns (uint256 requestId,uint256 assets)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
]);

export const usdsoMintAbi = parseAbi([
  "function mint(address to,uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);

export const riskHandlerAbi = parseAbi([
  "function subscriptionId() view returns (uint256)",
  "function maxSpreadBps() view returns (uint16)",
  "function maxMoveBps() view returns (uint16)",
  "function lastMid() view returns (uint256)",
]);
