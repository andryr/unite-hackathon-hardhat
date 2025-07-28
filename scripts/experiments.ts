import { Address, AmountMode, LimitOrder, LimitOrderContract, MakerTraits, randBigInt, RfqOrder, TakerTraits } from "@1inch/limit-order-sdk";
import { ethers } from "hardhat";
import { Signature } from "ethers";
import fs from 'fs';

// Addresses
const WETH_HOLDER = '0x2E40DDCB231672285A5312ad230185ab2F14eD2B';
const USDC_HOLDER = '0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341';
const ONEINCH_V6_ADDRESS = '0x111111125421ca6dc452d289314280a0f8842a65';
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
// Method signature representation of ABI for ERC20 contracts - https://docs.ethers.org/v6/getting-started/#starting-contracts
const erc20Abi = [
    "function balanceOf(address) view returns (uint)",
    "function transfer(address to, uint256 value) returns (bool)",
    "function approve(address spender, uint256 value) returns (bool)"
]

async function getTokensFromWhale(
    destWalletAddress: string,
    tokenAddress: string,
    tokenName: string,
    tokenHolder: string,
    amountStr: string,
    decimals: number
) {
    // Impersonate the whale
    const impersonatedSigner = await ethers.getImpersonatedSigner(tokenHolder);

    // Check and print the balance of ETH for the whale
    const ethBalance = await ethers.provider.getBalance(impersonatedSigner.address);
    console.log(`ETH Balance of whale (${impersonatedSigner.address}): ${ethers.formatEther(ethBalance)} ETH`);

    // Get an instance of the token contract as the whale
    const tokenContract = await ethers.getContractAt(erc20Abi, tokenAddress, impersonatedSigner);

    // Check and print the balance of the token for the whale
    let tokenBalance = await tokenContract.balanceOf(impersonatedSigner.address);
    console.log(`${tokenName} Balance of whale (${impersonatedSigner.address}): ${ethers.formatUnits(tokenBalance, decimals)} ${tokenName}`);

    // Define the amount of token to send ("1" token, assumes 18 decimals)
    const amount = ethers.parseUnits(amountStr, decimals);
    console.log(`Transferring ${ethers.formatUnits(amount, decimals)} ${tokenName} to local wallet (${destWalletAddress})`);

    try {
        // Execute the transfer from the whale to local wallet
        const tx = await tokenContract.transfer(destWalletAddress, amount);
        console.log("Transaction sent, waiting for confirmation...");
        await tx.wait();
        console.log(`Successfully transferred ${ethers.formatUnits(amount, decimals)} ${tokenName} to ${destWalletAddress}`);

        // Check and print the balance of the whale after transfer
        tokenBalance = await tokenContract.balanceOf(impersonatedSigner.address);
        console.log(`Remaining ${tokenName} Balance of whale (${impersonatedSigner.address}): ${ethers.formatUnits(tokenBalance, decimals)} ${tokenName}`);
    } catch (error) {
        console.error(`Error during ${tokenName} transfer:`, error);
    }
}

async function main() {
    const maker = await ethers.provider.getSigner(0);

    const taker = await ethers.provider.getSigner(1);
    await getTokensFromWhale(maker.address, USDC_ADDRESS, "USDC", USDC_HOLDER, "100", 6);
    await getTokensFromWhale(maker.address, WETH_ADDRESS, "WETH", WETH_HOLDER, "1", 18);
    await getTokensFromWhale(taker.address, USDC_ADDRESS, "USDC", USDC_HOLDER, "100", 6);
    await getTokensFromWhale(taker.address, WETH_ADDRESS, "WETH", WETH_HOLDER, "1", 18);

    const expiresIn = 120n // 2m
    const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn

    const UINT_40_MAX = (1n << 48n) - 1n


    const makerTraits = MakerTraits.default()
        .withExpiration(expiration);

    const now = (): bigint => BigInt(Math.floor(Date.now() / 1000))

    const order = new RfqOrder({
        makerAsset: new Address(USDC_ADDRESS),
        takerAsset: new Address(WETH_ADDRESS),
        makingAmount: 100_000000n, // 100 USDT
        takingAmount: 1_000000000000000000n, // 1 WETH
        maker: new Address(maker.address),
        // salt? : bigint
        // receiver? : Address
    }, {
        nonce: randBigInt(10000),
        expiration: now() + 120n
    })

    const typedData = order.getTypedData(31337)
    const signature = await maker.signTypedData(
        typedData.domain,
        { Order: typedData.types.Order },
        typedData.message
    )
    console.log("Domain:", typedData.domain);
    console.log("Order for signature:", typedData.message);
    console.log("Order for calldata:", order.build());
    console.log("Maker address:", maker.address);
    console.log("Signature:", signature);

    const usdc = await ethers.getContractAt(erc20Abi, USDC_ADDRESS, maker);
    await usdc.approve(ONEINCH_V6_ADDRESS, ethers.MaxUint256);

    const weth = await ethers.getContractAt(erc20Abi, WETH_ADDRESS, taker);
    await weth.approve(ONEINCH_V6_ADDRESS, ethers.MaxUint256);

    const data = LimitOrderContract.getFillOrderCalldata(
        order.build(),
        signature,
        TakerTraits.default().setAmountMode(AmountMode.maker),
        order.makingAmount // 10 WETH
    )
    const tx = await taker.sendTransaction({
        to: ONEINCH_V6_ADDRESS,
        data: data,
    })
    console.log("Transaction sent, waiting for confirmation...");
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt?.hash);
}
main();