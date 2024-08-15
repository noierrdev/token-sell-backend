require('dotenv').config()
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction, TransactionInstruction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID,SYSTEM_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID, createAccount, createThawAccountInstruction} = require('@solana/spl-token');
const {  LIQUIDITY_STATE_LAYOUT_V4, Liquidity,MARKET_STATE_LAYOUT_V3,Market} = require('@raydium-io/raydium-sdk');
const { bs58 } = require('@coral-xyz/anchor/dist/cjs/utils/bytes');
const { getBirdeyePrice, getJupiterQuote, getSwapMarket } = require('./utils');
const { struct, u8, u64 } = require('buffer-layout');
const {BN}=require("@coral-xyz/anchor")
const buffer=require("buffer");
function sleep(ms) {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}

async function swapToken(tokenAddress,buySol=false) {
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(process.env.BETTING_SOL_AMOUNT)
  // var amountIn=BigInt(100)
  
  
  const raydium_program_id=new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM)
  const raydium_auth=new PublicKey(process.env.RAYDIUM_AUTHORITY);
  var accounts=await connection.getProgramAccounts(
      raydium_program_id,
      {
        commitment: 'confirmed',
        filters: [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
              bytes: SOL_MINT_ADDRESS,
            },
          },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
              bytes: MYTOKEN_MINT_ADDRESS,
            },
          },
        ],
      },
  );

  if(accounts.length==0){
    accounts=await connection.getProgramAccounts(
      raydium_program_id,
      {
        commitment: 'confirmed',
        filters: [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
              bytes: MYTOKEN_MINT_ADDRESS,
            },
          },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
              bytes: SOL_MINT_ADDRESS,
            },
          },
        ],
      },
    );
  }

  const poolInfo=LIQUIDITY_STATE_LAYOUT_V4.decode(accounts[0].account.data);
  const marketAccountInfo = await connection.getAccountInfo(poolInfo.marketId);
  if (!marketAccountInfo) {
    return;
  }
  const marketInfo= MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);
  
  const poolKeys = {
    poolId: accounts[0].pubkey,
    baseMint: poolInfo.baseMint,
    quoteMint: poolInfo.quoteMint,
    lpMint: poolInfo.lpMint,
    baseDecimals: poolInfo.baseDecimal.toNumber(),
    quoteDecimals: poolInfo.quoteDecimal.toNumber(),
    lpDecimals: 9,
    version: 4,
    programId: raydium_program_id,
    openOrders: poolInfo.openOrders,
    targetOrders: poolInfo.targetOrders,
    baseVault: poolInfo.baseVault,
    quoteVault: poolInfo.quoteVault,
    withdrawQueue: poolInfo.withdrawQueue,
    lpVault: poolInfo.lpVault,
    marketVersion: 3,
    authority: raydium_auth,
    marketId: poolInfo.marketId,
    marketProgramId: poolInfo.marketProgramId,
    marketAuthority: Market.getAssociatedAuthority({ programId: poolInfo.marketProgramId, marketId: poolInfo.marketId }).publicKey,
    marketBaseVault: marketInfo.baseVault,
    marketQuoteVault: marketInfo.quoteVault,
    marketBids: marketInfo.bids,
    marketAsks: marketInfo.asks,
    marketEventQueue: marketInfo.eventQueue,
    // baseReserve: poolInfo.baseReserve,
    // quoteReserve: poolInfo.quoteReserve,
    // lpReserve: poolInfo.lpReserve,
    // openTime: poolInfo.openTime,
  };

  const id = poolKeys.poolId;
  delete poolKeys.poolId;
  poolKeys.id = id;
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2000000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );

  const { blockhash,lastValidBlockHeight } = await connection.getLatestBlockhash({commitment:"finalized"});

  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenRapid(tokenAddress,poolKeys_,amount=0.0001,buySol=false) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  
  if(buySol)
    txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(10000)}));
  else txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(10000)}));
  const accountInfo = await connection.getAccountInfo(solATA);
  // if (accountInfo) {
  //   txObject.add(
  //     createCloseAccountInstruction(
  //       solATA,
  //       wallet.publicKey,
  //       wallet.publicKey,
  //       [wallet],
  //     ),
  //   );
  // }
  if(!accountInfo)
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(1000000))
  const jito_tip_index=(Math.round(Math.random()*10))%8;
  const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  txObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );
  
  txObject.feePayer = wallet.publicKey;
  const latestBlock=await connection.getLatestBlockhash("confirmed");
  txObject.recentBlockhash=latestBlock.blockhash;
  txObject.partialSign(wallet);
  const serialized=bs58.encode(txObject.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[serialized]]
  };
  // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var result=false;
  for(var endpoint of jito_endpoints){
    
    try {
      let res = await fetch(`${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });
      const responseData=await res.json();
      if(!responseData.error) {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`${buySol?"Selling":"Buying"} Tokens is successful!!!`)
        console.log(`-----------------------------------`)
        result=true;
        // if(!buySol)
          break;
      }else {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`${buySol?"Selling":"Buying"} Tokens is failed!!!`)
        console.log(`-----------------------------------`)
      }
    } catch (error) {
      console.log(`----------${endpoint}-------------`)
      console.log(error)
      console.log(`${buySol?"Selling":"Buying"} Tokens is successful!!!`)
      console.log(`-----------------------------------`)
    }
  }
  if(!result) return false;
  return true;
}

async function swapTokenLegacy(tokenAddress,poolKeys_,amount=0.0001,buySol=false,latestBlock) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.O7NODE_RPC);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  
  if(buySol)
    txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.SELL_FEE_LAMPORTS)}));
  else txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000}));
  
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );
  // const latestBlock=await connection.getLatestBlockhash("confirmed")
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    console.log(txnSignature)
    const x=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
    console.log(x)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenBundling(tokenAddress,poolKeys_,amount=0.0001) {
  var poolKeys=poolKeys_;
  var sellPoolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') {
      poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
      sellPoolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
    }
  }
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();
  const buyTxObject = new Transaction();
  const sellTxObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);

  sellTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.SELL_FEE_LAMPORTS)}));
  buyTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.BUY_FEE_LAMPORTS)}));

  const createCloseAccountInst=createCloseAccountInstruction(
    solATA,
    wallet.publicKey,
    wallet.publicKey,
    [wallet],
  );
  if (accountInfo) {
    
    buyTxObject.add(
      createCloseAccountInst
    );
    sellTxObject.add(
      createCloseAccountInst
    );
  }

  const createSolATAInst=createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(createSolATAInst);
  sellTxObject.add(createSolATAInst);

  
  buyTxObject.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: solATA,
    lamports: amountIn,
  }));


  const syncNativeInst=createSyncNativeInstruction(
    solATA,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(
    syncNativeInst
  );
  sellTxObject.add(
    syncNativeInst
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if (!tokenAccountInfo) {
    const createTokenATAInst=createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenAta,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    );

    buyTxObject.add(
      createTokenATAInst
    );
    sellTxObject.add(
      createTokenATAInst
    );
  }

  var amountToSell=BigInt(0);
  var tokenBalance;
  try {
    tokenBalance=await connection.getTokenAccountBalance(tokenAta);
  } catch (error) {
  }
  

  const buyTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn:solATA,
      tokenAccountOut:tokenAta,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);


  const jupiterPriceData=await getJupiterQuote(tokenAddress,amount);
  if(jupiterPriceData.error){
    console.log(jupiterPriceData)
    console.log("Error while fetching price!!!");
    return false;
  }
  console.log(jupiterPriceData)
  amountToSell=BigInt(Number(jupiterPriceData.otherAmountThreshold))
  if(tokenBalance&&Number(tokenBalance.value.amount)>0) amountToSell=BigInt(Number(tokenBalance.value.amount))

  const sellTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: sellPoolKeys,
    userKeys: {
      tokenAccountIn:tokenAta,
      tokenAccountOut:solATA,
      owner: wallet.publicKey,
    },
    amountIn: amountToSell,
    minAmountOut: '0',
  }, 4);

  for (let i = 0; i < buyTxn.innerTransaction.instructions.length; i++) {
    buyTxObject.add(buyTxn.innerTransaction.instructions[i]);
  }
  for (let i = 0; i < sellTxn.innerTransaction.instructions.length; i++) {
    sellTxObject.add(sellTxn.innerTransaction.instructions[i]);
  }

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_receiver=new PublicKey(process.env.JITO_TIP_ACCOUNT);
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  const jito_tip_index=(Math.round(Math.random()*10))%8;
  const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  buyTxObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )
  // sellTxObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // )
  buyTxObject.add(
    createCloseAccountInst
  );
  sellTxObject.add(
    createCloseAccountInst
  );
  
  buyTxObject.feePayer = wallet.publicKey;
  sellTxObject.feePayer = wallet.publicKey;

  var latestBlock=await connection.getLatestBlockhash("finalized")
  buyTxObject.recentBlockhash=latestBlock.blockhash;
  sellTxObject.recentBlockhash=latestBlock.blockhash;

  buyTxObject.partialSign(wallet);
  sellTxObject.partialSign(wallet);
  const buySerialized=bs58.encode(buyTxObject.serialize());
  const sellSerialized=bs58.encode(sellTxObject.serialize());
  let sellPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendTransaction",
    params: [sellSerialized]
  };
  let buyPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[buySerialized]]
  };

  const jito_endpoints = [
    'https://mainnet.block-engine.jito.wtf/api/v1',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1',
    'https://ny.mainnet.block-engine.jito.wtf/api/v1',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1',
  ];
  var result=false;
  for(var i=0;i<(jito_endpoints.length);i++){
    const sellRes=await fetch(`${jito_endpoints[i]}/transactions`,{
      method:"POST",
      body:JSON.stringify(sellPayload),
      headers: { 'Content-Type': 'application/json' }
    })
    const sellData=await sellRes.json();
    if(sellData.error) {
      console.log("SELL ERROR!!!")
    }else{
      console.log("SELL OK!!!")
    }
    const buyRes=await fetch(`${jito_endpoints[jito_endpoints.length-i-1]}/bundles`,{
      method:"POST",
      body:JSON.stringify(buyPayload),
      headers: { 'Content-Type': 'application/json' }
    })
    const buyData=await buyRes.json();
    if(buyData.error) {
      console.log("BUY ERROR!!!");
    }else{
      console.log("BUY OK!!!")
    }
    
  }
  return true;
}


async function swapTokenTrick(tokenAddress,poolKeys_,amount=0.0001) {
  var poolKeys=poolKeys_;
  var sellPoolKeys=poolKeys_
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') {
      poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
      sellPoolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
    }
  }
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();
  const buyTxObject = new Transaction();
  const sellTxObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);

  sellTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.SELL_FEE_LAMPORTS)}));
  buyTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.BUY_FEE_LAMPORTS)}));

  const createCloseAccountInst=createCloseAccountInstruction(
    solATA,
    wallet.publicKey,
    wallet.publicKey,
    [wallet],
  );
  if (accountInfo) {
    
    buyTxObject.add(
      createCloseAccountInst
    );
    sellTxObject.add(
      createCloseAccountInst
    );
  }

  const createSolATAInst=createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(createSolATAInst);
  sellTxObject.add(createSolATAInst);

  
  buyTxObject.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: solATA,
    lamports: amountIn,
  }));


  const syncNativeInst=createSyncNativeInstruction(
    solATA,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(
    syncNativeInst
  );
  sellTxObject.add(
    syncNativeInst
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if (!tokenAccountInfo) {
    const createTokenATAInst=createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenAta,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    );

    buyTxObject.add(
      createTokenATAInst
    );
    sellTxObject.add(
      createTokenATAInst
    );
  }

  const buyTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn:solATA,
      tokenAccountOut:tokenAta,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < buyTxn.innerTransaction.instructions.length; i++) {
    buyTxObject.add(buyTxn.innerTransaction.instructions[i]);
  }
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  var jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_index=(Math.round(Math.random()*10))%8;
  var jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  buyTxObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )
  buyTxObject.add(
    createCloseAccountInst
  );
  buyTxObject.feePayer = wallet.publicKey;

  var latestBlock=await connection.getLatestBlockhash("confirmed")
  buyTxObject.recentBlockhash=latestBlock.blockhash;

  buyTxObject.partialSign(wallet);
  const buySerialized=bs58.encode(buyTxObject.serialize());
  let buyPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[buySerialized]]
  };
  const jito_endpoints = [
    'https://mainnet.block-engine.jito.wtf/api/v1',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1',
    'https://ny.mainnet.block-engine.jito.wtf/api/v1',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1',
  ];

  var tokenBalance={
    value:null
  };
  try {
    tokenBalance=await connection.getTokenAccountBalance(tokenAta,"confirmed");
    console.log(tokenBalance.value)
  } catch (error) {
    console.log(error)
  }
  if(!tokenBalance.value)
  fetch(`${jito_endpoints[Math.round(Math.random()*100)%5]}/bundles`,{
    method:"POST",
    body:JSON.stringify(buyPayload),
    headers: { 'Content-Type': 'application/json' }
  })
  
  while(!tokenBalance.value){
    await sleep(200);
    try {
      tokenBalance=await connection.getTokenAccountBalance(tokenAta,"confirmed");
      console.log(tokenBalance.value)
    } catch (error) {
      console.log(error)
    }
  }
  var amountToSell=BigInt(Number(tokenBalance.value.amount))

  const newSwapMarket=await getSwapMarket(tokenAddress);
  
  const sellTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: newSwapMarket.poolKeys,
    userKeys: {
      tokenAccountIn:tokenAta,
      tokenAccountOut:solATA,
      owner: wallet.publicKey,
    },
    amountIn: amountToSell,
    minAmountOut: '0',
  }, 4);

  
  for (let i = 0; i < sellTxn.innerTransaction.instructions.length; i++) {
    sellTxObject.add(sellTxn.innerTransaction.instructions[i]);
  }

  jito_tip_index=(Math.round(Math.random()*10))%8;
  jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  sellTxObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )
  
  sellTxObject.add(
    createCloseAccountInst
  );
  sellTxObject.feePayer = wallet.publicKey;
  latestBlock=await connection.getLatestBlockhash("confirmed")
  console.log(latestBlock)

  sellTxObject.recentBlockhash=latestBlock.blockhash;

  
  sellTxObject.partialSign(wallet);
  
  const sellSerialized=bs58.encode(sellTxObject.serialize());
  let sellPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[sellSerialized]]
  };
  for(var i=0;i<10;i++){
    const sellRes=await fetch(`${jito_endpoints[i%jito_endpoints.length]}/bundles`,{
      method:"POST",
      body:JSON.stringify(sellPayload),
      headers: { 'Content-Type': 'application/json' }
    })
    const sellData=await sellRes.json();
    if(sellData.error) {
      console.log("SELL ERROR!!!")
    }else{
      console.log("SELL OK!!!")
    }
    
    
  }
  // if(!result) return false;
  return true;
}


async function swapTokenContractSell(tokenAddress,poolKeys_,latestBlock) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  console.log({solATA})
  console.log({tokenATA})
  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitLimit({units:75000}))
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2000000}));
  
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      solATA,
      wallet.publicKey,
      SOL_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  // txObject.add(
  //   createAssociatedTokenAccountInstruction(
  //     wallet.publicKey,
  //     tokenATA,
  //     wallet.publicKey,
  //     MYTOKEN_MINT_PUBKEY,
  //     TOKEN_PROGRAM_ID
  //   ),
  // );

  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );
  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(2222),0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      },
      //2
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //3
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //5
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      //6
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      //7
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      //9
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      //10
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      //11
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      //12
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      //13
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      //14
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      //15
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //16
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:false
      },
      //17
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
    ],
    programId:new PublicKey(process.env.CONTRACT_ADDRESS),
    data:Buffer.from(`02000000${amountbuffer.toString("hex")}${amountbuffer.toString("hex")}0000000000000000eb5e104ac496d15979da2f185f38bbcf`,'hex')
  });
  txObject.add(contractInstruction);
  // const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  // var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}


async function swapTokenContractBuy(tokenAddress,poolKeys_,latestBlock) {
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  console.log(tokenATA)
  // txObject.add(
  //   createAssociatedTokenAccountInstruction(
  //     wallet.publicKey,
  //     tokenATA,
  //     wallet.publicKey,
  //     MYTOKEN_MINT_PUBKEY,
  //     TOKEN_PROGRAM_ID
  //   ),
  // );
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const contractInstruction=new TransactionInstruction({
    keys:[
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      {
        pubkey:new PublicKey(process.env.UNKNOWN_ACCOUNT),isSigner:false,isWritable:true
      },
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      },
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
    ],
    programId:new PublicKey(process.env.CONTRACT_ADDRESS),
    data:Buffer.from("5bb527f9eccb5e9063e2037d0700000001466a2be322020000",'hex')
  });
  // console.log(contractInstruction.keys)
  txObject.add(contractInstruction);
  // const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  // var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenMy(tokenAddress,poolKeys_,latestBlock) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  console.log({solATA})
  console.log({tokenATA})
  

  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );

  // const txn = Liquidity.makeSwapFixedInInstruction({
  //   connection: connection,
  //   poolKeys: poolKeys,
  //   userKeys: {
  //     tokenAccountIn:solATA,
  //     tokenAccountOut:tokenATA,
  //     owner: wallet.publicKey,
  //   },
  //   amountIn: BigInt(10000),
  //   minAmountOut: '0',
  // }, 4);
  // for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
  //   txObject.add(txn.innerTransaction.instructions[i]);
  // }

  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(2222),0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      //2
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      
      //3
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      },
      
      //5
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      
      //6
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      
      //7
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //9
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      
      //10
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      
      //11
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      
      //12
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      
      //13
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      
      //14
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      
      //15
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
     
      //16
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      
      //17
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:new PublicKey("FUgmngErUdmCvAtEBaQ4CKbXYdRRrSttRD8HXiZ4mWtT"),isSigner:false,isWritable:true
      },
      //20
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //21
      {
        pubkey:MYTOKEN_MINT_PUBKEY,isSigner:false,isWritable:false
      },
      //22
      {
        pubkey:SOL_MINT_PUBKEY,isSigner:false,isWritable:false
      },
      //23
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      //24
      {
        pubkey:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
    ],
    programId:new PublicKey("9uW2TqLyfYyrcNVrgCy4jPpqDKQoBZhXWypzzFxbixQE"),
    data:Buffer.from(`c967bcda2057689e${amountbuffer.toString("hex")}0000000000000000ff000000000000000000000000`,'hex')
  });
  
  txObject.add(contractInstruction);
  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
    ),
  );

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );

  // txObject.feePayer = wallet.publicKey;
  // txObject.recentBlockhash=latestBlock.blockhash;
  // txObject.partialSign(wallet);
  // const serialized=bs58.encode(txObject.serialize());
  // let payload = {
  //   jsonrpc: "2.0",
  //   id: 1,
  //   method: "sendBundle",
  //   params: [[serialized]]
  // };
  // // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  // const jito_endpoints = [
  //   'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  // ];
  // var result=false;
  // for(var endpoint of jito_endpoints){
    
  //   try {
  //     let res = await fetch(`${endpoint}`, {
  //       method: 'POST',
  //       body: JSON.stringify(payload),
  //       headers: { 'Content-Type': 'application/json' }
  //     });
  //     const responseData=await res.json();
  //     if(!responseData.error) {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //       result=true;
  //       break;
  //     }else {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //     }
  //   } catch (error) {
  //     console.log(`----------${endpoint}-------------`)
  //     console.log(error)
  //     console.log(`-----------------------------------`)
  //   }
  // }
  // if(!result) return false;
  // return true;


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenTest(tokenAddress,poolKeys_,amount) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.O7NODE_RPC);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  

  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );

  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(amount),0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      //2
      {
        pubkey:new PublicKey("So11111111111111111111111111111111111111112"),isSigner:false,isWritable:false
      },
      //3
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      }, 
      //5
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //6
      {
        pubkey:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
      //7
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //9
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      //10
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      //11
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      
      //12
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      
      
      //13
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      
      
      //14
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      //15
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      //16
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      //17
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //20
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      //21
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      //22
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },

    ],
    programId:new PublicKey("E7vFBbExms2r7NVdcbBXkohdmwD7BoS7yaL8i1tCjpxV"),
    data:Buffer.from(`0009${amountbuffer.toString("hex")}000000000000000000`,'hex')
  });
  txObject.add(contractInstruction);

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  txObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  );

  txObject.feePayer = wallet.publicKey;
  var latestBlock=await connection.getLatestBlockhash("confirmed");
  txObject.recentBlockhash=latestBlock.blockhash;
  txObject.partialSign(wallet);
  const serialized=bs58.encode(txObject.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[serialized]]
  };
  // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var result=false;
  for(var endpoint of jito_endpoints){
    
    try {
      let res = await fetch(`${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });
      const responseData=await res.json();
      if(!responseData.error) {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
        result=true;
        break;
      }else {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
      }
    } catch (error) {
      console.log(`----------${endpoint}-------------`)
      console.log(error)
      console.log(`-----------------------------------`)
    }
  }
  if(!result) return false;
  return true;


  // const messageV0 = new TransactionMessage({
  //   payerKey: wallet.publicKey,
  //   recentBlockhash: latestBlock.blockhash,
  //   instructions:txObject.instructions,
  // }).compileToV0Message();

  // const tx = new VersionedTransaction(messageV0);
  // tx.sign([wallet]);
  
  // try {
  //   const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
  //   console.log(txnSignature)
  //   const txResult=await connection.confirmTransaction({
  //     signature: txnSignature,
  //     blockhash: latestBlock.blockhash,
  //     lastValidBlockHeight: latestBlock.lastValidBlockHeight,
  //   });
  //   console.log(txResult)
  //   return true;
  // } catch (error) {
  //   console.log(error)
  //   return false;
  // }
}

async function swapTokenTestBuy(tokenAddress,poolKeys_,amount) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  

  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 600000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  const amountIn=BigInt(amount);

  txObject.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: solATA,
    lamports: amountIn,
  }));
  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );

  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(amountIn,0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      //2
      {
        pubkey:new PublicKey("So11111111111111111111111111111111111111112"),isSigner:false,isWritable:false
      },
      //3
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      }, 
      //5
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //6
      {
        pubkey:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
      //7
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //9
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      //10
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      //11
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      
      //12
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      
      
      //13
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      
      
      //14
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      //15
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      //16
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      //17
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //20
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      //21
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      //22
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },

    ],
    programId:new PublicKey("E7vFBbExms2r7NVdcbBXkohdmwD7BoS7yaL8i1tCjpxV"),
    data:Buffer.from(`0009${amountbuffer.toString("hex")}000000000000000000`,'hex')
  });
  txObject.add(contractInstruction);

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );

  txObject.feePayer = wallet.publicKey;
  var latestBlock=await connection.getLatestBlockhash();
  txObject.recentBlockhash=latestBlock.blockhash;
  
  // txObject.partialSign(wallet);
  // const serialized=bs58.encode(txObject.serialize());
  // let payload = {
  //   jsonrpc: "2.0",
  //   id: 1,
  //   method: "sendBundle",
  //   params: [[serialized]]
  // };

  // // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  // const jito_endpoints = [
  //   'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  // ];
  // var result=false;
  // for(var endpoint of jito_endpoints){
    
  //   try {
  //     let res = await fetch(`${endpoint}`, {
  //       method: 'POST',
  //       body: JSON.stringify(payload),
  //       headers: { 'Content-Type': 'application/json' }
  //     });
  //     const responseData=await res.json();
  //     if(!responseData.error) {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //       result=true;
  //       break;
  //     }else {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //     }
  //   } catch (error) {
  //     console.log(`----------${endpoint}-------------`)
  //     console.log(error)
  //     console.log(`-----------------------------------`)
  //   }
  // }
  // if(!result) return false;
  // return true;


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.message.recentBlockhash=latestBlock.blockhash
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx);
    console.log(txnSignature)
    // const x=await connection.confirmTransaction({
    //   signature: txnSignature,
    //   blockhash: latestBlock.blockhash,
    //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    // });
    // console.log(x)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenThor(tokenAddress,poolKeys_,amount=0.0001,buySol=false) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.THORNODE_RPC);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  
  if(buySol)
    txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.SELL_FEE_LAMPORTS)}));
  else txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000}));
  
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );
  const latestBlock=await connection.getLatestBlockhash("confirmed")
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    // const x=await connection.confirmTransaction({
    //   signature: txnSignature,
    //   blockhash: latestBlock.blockhash,
    //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    // });
    console.log(txnSignature)
    // console.log(x)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

module.exports={
  swapToken,
  swapTokenRapid,
  swapTokenLegacy,
  swapTokenBundling,
  swapTokenTrick,
  swapTokenContractSell,
  swapTokenContractBuy,
  swapTokenMy,
  swapTokenTest,
  swapTokenThor,
  swapTokenTestBuy
}