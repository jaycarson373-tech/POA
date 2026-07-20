import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { WorkerConfig } from "./config";

function secretBytes(encoded: string) {
  const value = encoded.trim();
  if (!value) throw new Error("Wallet private key is not configured");
  let bytes: Uint8Array;
  if (value.startsWith("[")) {
    const parsed = JSON.parse(value) as number[];
    bytes = Uint8Array.from(parsed);
  } else {
    bytes = bs58.decode(value);
  }
  if (bytes.length !== 64) throw new Error("Solana private key must decode to exactly 64 bytes");
  return bytes;
}

export function verifyWalletSignature(walletAddress: string, message: string, signatureBase64: string) {
  const publicKey = bs58.decode(walletAddress);
  const signature = Buffer.from(signatureBase64, "base64");
  return publicKey.length === 32
    && signature.length === 64
    && nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey);
}

export class SolanaService {
  private readonly rpc;

  constructor(private readonly config: WorkerConfig) {
    this.rpc = createSolanaRpc(config.solanaRpcUrl);
  }

  async getTokenBalance(ownerValue: string, mintValue = this.config.poaMint) {
    const response = await this.rpc.getTokenAccountsByOwner(
      address(ownerValue),
      { mint: address(mintValue) },
      { commitment: "confirmed", encoding: "jsonParsed" },
    ).send();
    let total = BigInt(0);
    for (const account of response.value) {
      const parsed = account.account.data as unknown as {
        parsed?: { info?: { tokenAmount?: { amount?: string } } };
      };
      total += BigInt(parsed.parsed?.info?.tokenAmount?.amount || "0");
    }
    return total;
  }

  async getSolBalance(ownerValue: string) {
    const response = await this.rpc.getBalance(address(ownerValue), { commitment: "confirmed" }).send();
    return BigInt(response.value);
  }

  async getWalletHistory(walletAddress: string) {
    const wallet = address(walletAddress);
    const cutoffSeconds = Math.floor(Date.now() / 1000) - this.config.walletMinimumAgeDays * 86_400;
    let before: string | undefined;
    let earliestBlockTime: number | null = null;
    let oldEnough = false;

    for (let page = 0; page < 10; page += 1) {
      const response = await this.rpc.getSignaturesForAddress(wallet, {
        commitment: "confirmed",
        limit: 1000,
        ...(before ? { before: before as never } : {}),
      }).send();
      if (response.length === 0) break;
      for (const record of response) {
        if (record.blockTime !== null) {
          const blockTime = Number(record.blockTime);
          earliestBlockTime = earliestBlockTime === null ? blockTime : Math.min(earliestBlockTime, blockTime);
          if (blockTime <= cutoffSeconds) oldEnough = true;
        }
      }
      if (oldEnough || response.length < 1000) break;
      before = response.at(-1)?.signature as string | undefined;
    }

    return {
      oldEnough,
      firstObservedTransactionAt: earliestBlockTime === null
        ? null
        : new Date(earliestBlockTime * 1000).toISOString(),
    };
  }

  validateAddress(value: string) {
    return address(value).toString();
  }

  async verifyFundingTransaction(args: {
    signature: string;
    collectionAddress: string;
    rewardKind: "SOL" | "SPL";
    rewardMint?: string | null;
    amountRaw: bigint;
  }) {
    const result = await this.rawRpc<{
      meta: {
        err: unknown;
        preBalances: number[];
        postBalances: number[];
        preTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }>;
        postTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }>;
      };
      transaction: { message: { accountKeys: Array<string | { pubkey: string }> } };
    } | null>("getTransaction", [args.signature, {
      commitment: "confirmed",
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
    }]);
    if (!result || result.meta.err) throw new Error("Funding transaction is missing, unconfirmed, or failed");
    const keys = result.transaction.message.accountKeys.map((key) => typeof key === "string" ? key : key.pubkey);

    if (args.rewardKind === "SOL") {
      const collectionIndex = keys.indexOf(args.collectionAddress);
      if (collectionIndex < 0) throw new Error("Funding transaction does not include the collection wallet");
      const received = BigInt(result.meta.postBalances[collectionIndex] || 0)
        - BigInt(result.meta.preBalances[collectionIndex] || 0);
      if (received < args.amountRaw) throw new Error("Funding transaction amount is below the requested SOL reward pool");
      return { receivedRaw: received };
    }

    if (!args.rewardMint) throw new Error("SPL funding requires a reward mint");
    const balances = new Map<number, bigint>();
    for (const item of result.meta.preTokenBalances || []) {
      if (item.owner === args.collectionAddress && item.mint === args.rewardMint) {
        balances.set(item.accountIndex, -BigInt(item.uiTokenAmount.amount));
      }
    }
    for (const item of result.meta.postTokenBalances || []) {
      if (item.owner === args.collectionAddress && item.mint === args.rewardMint) {
        balances.set(item.accountIndex, (balances.get(item.accountIndex) || BigInt(0)) + BigInt(item.uiTokenAmount.amount));
      }
    }
    const received = [...balances.values()].reduce((sum, value) => sum + value, BigInt(0));
    if (received < args.amountRaw) throw new Error("Funding transaction amount is below the requested token reward pool");
    return { receivedRaw: received };
  }

  async sendSplToken(args: {
    secret: string;
    expectedAddress?: string;
    recipient: string;
    amountRaw: bigint;
    mint?: string;
    decimals?: number;
    onSigned?: (signature: string) => Promise<void>;
  }) {
    const signer = await createKeyPairSignerFromBytes(secretBytes(args.secret));
    if (args.expectedAddress && signer.address !== args.expectedAddress) {
      throw new Error("Configured private key does not match its expected public wallet address");
    }

    const mint = address(args.mint || this.config.poaMint);
    const recipient = address(args.recipient);
    const [source] = await findAssociatedTokenPda({
      owner: signer.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [destination] = await findAssociatedTokenPda({
      owner: recipient,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const instructions = [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        ata: destination,
        owner: recipient,
        mint,
      }),
      getTransferCheckedInstruction({
        source,
        mint,
        destination,
        authority: signer,
        amount: args.amountRaw,
        decimals: args.decimals ?? this.config.tokenDecimals,
      }),
    ];
    return this.signSendAndConfirm(signer, instructions, args.onSigned);
  }

  async sendSol(args: {
    secret: string;
    expectedAddress?: string;
    recipient: string;
    lamports: bigint;
    onSigned?: (signature: string) => Promise<void>;
  }) {
    const signer = await createKeyPairSignerFromBytes(secretBytes(args.secret));
    if (args.expectedAddress && signer.address !== args.expectedAddress) {
      throw new Error("Configured collection private key does not match CAMPAIGN_COLLECTION_WALLET");
    }
    return this.signSendAndConfirm(signer, [getTransferSolInstruction({
      source: signer,
      destination: address(args.recipient),
      amount: args.lamports,
    })], args.onSigned);
  }

  async executeJupiterSwap(args: {
    secret: string;
    expectedAddress: string;
    inputLamports: bigint;
    outputMint: string;
    apiKey: string;
    onOrder?: (order: { requestId: string; outAmount: string; router: string; feeBps: number }) => Promise<void>;
  }) {
    const signer = await createKeyPairSignerFromBytes(secretBytes(args.secret));
    if (signer.address !== args.expectedAddress) throw new Error("Buyback private key does not match BUYBACK_WALLET_PUBLIC_KEY");
    const params = new URLSearchParams({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: args.outputMint,
      amount: args.inputLamports.toString(),
      taker: signer.address,
    });
    const orderResponse = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, {
      headers: { "x-api-key": args.apiKey },
    });
    if (!orderResponse.ok) throw new Error(`Jupiter order ${orderResponse.status}: ${(await orderResponse.text()).slice(0, 400)}`);
    const order = await orderResponse.json() as {
      transaction: string | null;
      requestId: string;
      outAmount: string;
      router: string;
      feeBps: number;
      errorCode?: number;
      errorMessage?: string;
    };
    if (!order.transaction) throw new Error(`Jupiter could not build the buyback: ${order.errorCode || "unknown"} ${order.errorMessage || ""}`.trim());
    await args.onOrder?.(order);
    const transaction = getTransactionDecoder().decode(Buffer.from(order.transaction, "base64"));
    const signed = await partiallySignTransaction([signer.keyPair], transaction);
    const signedBase64 = Buffer.from(getTransactionEncoder().encode(signed)).toString("base64");
    const executeResponse = await fetch("https://api.jup.ag/swap/v2/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": args.apiKey },
      body: JSON.stringify({ signedTransaction: signedBase64, requestId: order.requestId }),
    });
    if (!executeResponse.ok) throw new Error(`Jupiter execute ${executeResponse.status}: ${(await executeResponse.text()).slice(0, 400)}`);
    const result = await executeResponse.json() as {
      status: "Success" | "Failed";
      signature: string;
      code: number;
      totalInputAmount: string;
      totalOutputAmount: string;
      error?: string;
    };
    if (result.status !== "Success" || result.code !== 0) {
      throw new Error(`Jupiter swap failed (${result.code}): ${result.error || "unknown error"}`);
    }
    return { ...result, requestId: order.requestId, quotedOutAmount: order.outAmount, router: order.router, feeBps: order.feeBps };
  }

  private async signSendAndConfirm(
    signer: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>,
    instructions: Parameters<typeof appendTransactionMessageInstructions>[0],
    onSigned?: (signature: string) => Promise<void>,
  ) {
    const latestBlockhash = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (transaction) => setTransactionMessageFeePayerSigner(signer, transaction),
      (transaction) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, transaction),
      (transaction) => appendTransactionMessageInstructions(instructions, transaction),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signed);
    await onSigned?.(signature);
    const wireTransaction = getBase64EncodedWireTransaction(signed);
    await this.rpc.sendTransaction(wireTransaction, {
      encoding: "base64",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    }).send();
    await this.confirmSignature(signature);
    return signature;
  }

  private async rawRpc<T>(method: string, params: unknown[]) {
    const response = await fetch(this.config.solanaRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`Solana RPC ${response.status}`);
    const body = await response.json() as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(`Solana RPC: ${body.error.message || "unknown error"}`);
    return body.result as T;
  }

  private async confirmSignature(signature: string) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const response = await this.rpc.getSignatureStatuses(
        [signature as never],
        { searchTransactionHistory: true },
      ).send();
      const status = response.value[0];
      if (status?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Solana transaction confirmation timed out");
  }

  publicAddressForSecret(secret: string) {
    return createKeyPairSignerFromBytes(secretBytes(secret)).then((signer) => signer.address as Address);
  }
}
