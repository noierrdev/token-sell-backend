require("dotenv").config();
const express=require("express")
const {Connection,PublicKey,Keypair}=require("@solana/web3.js")
const {swapTokenRapid,swapTokenTest, pumpfunSwapTransaction, pumpfunSwapTransactionFasterWallet, swapTokenFastestWallet, pumpfunSwapTransactionFasterWalletStaked, swapTokenFastestWalletStaked}=require("./swap");
const { getSwapMarket, getSwapMarketRapid } = require("./utils");

const app=express();
const bodyParser=require("body-parser");
const cors=require("cors")

const connection=new Connection(process.env.RPC_API);
const stakedConnection=new Connection(process.env.STAKED_RPC)
const PRIVATE_KEY =new  Uint8Array(JSON.parse(process.env.PRIVATE_KEY));
const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

app.use(cors())
app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));

app.get("/",(req,res)=>{
    return res.json({
        status:"success"
    })
})

app.get("/sell/:id",async (req,res)=>{
    const targetToken=req.params.id;
    const swapMarket=await getSwapMarket(targetToken);
    if(!swapMarket) return res.json({status:"error",error:"NO_MARKET"})
    // const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0.001,true);
    swapTokenFastestWalletStaked(connection,stakedConnection,wallet,targetToken,swapMarket.poolKeys,0.001,true)
    const result=await swapTokenFastestWallet(connection,wallet,targetToken,swapMarket.poolKeys,0.001,true)
    return res.json({status:"success",data:result})
});



app.post("/sell",async (req,res)=>{
    const targetToken=req.body.token;
    const quoted=req.body.quoted;
    var swapMarket;
    if(quoted==undefined) swapMarket=await getSwapMarket(targetToken);
    else swapMarket=await getSwapMarketRapid(targetToken,quoted);
    if(!swapMarket) return res.json({status:"error",error:"NO_MARKET"})
    // const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0.001,true);
    swapTokenFastestWalletStaked(connection,stakedConnection,wallet,targetToken,swapMarket.poolKeys,0.001,true)
    const result=await swapTokenFastestWallet(connection,wallet,targetToken,swapMarket.poolKeys,0.001,true)
    return res.json({status:"success",data:result})
})

app.get("/buy/:id",async (req,res)=>{
    const targetToken=req.params.id;
    const password=req.headers.passkey;
    if(!password||(password!=process.env.PASSWORD)) return res.json({status:"error",error:"WRONG_PASSWORD"})
    const swapMarket=await getSwapMarket(targetToken);
    if(!swapMarket) return res.json({status:"error",error:"NO_MARKET"})
    // const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0.0001,false);
    const result=await swapTokenFastestWallet(connection,wallet,targetToken,swapMarket.poolKeys,0.1,false)
    return res.json({status:"success",data:result})
});

app.post("/buy/",async (req,res)=>{
    const targetToken=req.body.token;
    const amount=req.body.amount;
    const swapMarket=await getSwapMarket(targetToken);
    if(!swapMarket) return res.json({status:"error",error:"NO_MARKET"})
    // const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,Number(amount),false);
    const result=await swapTokenFastestWallet(connection,wallet,targetToken,swapMarket.poolKeys,Number(amount),false)
    return res.json({status:"success",data:result})
});

app.get("/pumpfun/sell/:id",async (req,res)=>{
    const targetToken=req.params.id;
    // await pumpfunSwapTransaction(targetToken,0.1,false);
    pumpfunSwapTransactionFasterWalletStaked(connection,stakedConnection,wallet,targetToken,0.1,false)
    await pumpfunSwapTransactionFasterWallet(connection,wallet,targetToken,0.1,false) 
    return res.json({status:"success"})
})

app.get("/pumpfun/buy/:id",async (req,res)=>{
    const targetToken=req.params.id;
    const password=req.headers.passkey;
    if(!password||(password!=process.env.PASSWORD)) return res.json({status:"error",error:"WRONG_PASSWORD"})
    await pumpfunSwapTransaction(targetToken,0.1,true);
    // await pumpfunSwapTransactionFasterWallet(connection,wallet,targetToken,0.3,true) 
    return res.json({status:"success"})
})

// app.get("/contract/:id",async (req,res)=>{
//     const targetToken=req.params.id;
//     const swapMarket=await getSwapMarket(targetToken);
//     const result=await swapTokenTest(targetToken,swapMarket.poolKeys,0);
//     return res.json({status:"success",data:result})
// })
// app.post("/contract",async (req,res)=>{
//     const targetToken=req.body.token;
//     const quoted=req.body.quoted;
//     var swapMarket;
//     if(quoted==undefined) swapMarket=await getSwapMarket(targetToken);
//     else swapMarket=await getSwapMarketRapid(targetToken,quoted);
//     const result=await swapTokenTest(targetToken,swapMarket.poolKeys,0,true);
//     return res.json({status:"success",data:result})
// })

app.listen(process.env.PORT,()=>{

})