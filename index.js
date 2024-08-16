require("dotenv").config();
const express=require("express")
const {Connection,PublicKey,Keypair}=require("@solana/web3.js")
const {swapTokenRapid,swapTokenTest, pumpfunSwapTransaction}=require("./swap");
const { getSwapMarket, getSwapMarketRapid } = require("./utils");
const connection=new Connection(process.env.RPC_API);
const app=express();
const bodyParser=require("body-parser");
const cors=require("cors")

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
    const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0.001,true);
    return res.json({status:"success",data:result})
});



app.post("/sell",async (req,res)=>{
    const targetToken=req.body.token;
    const quoted=req.body.quoted;
    var swapMarket;
    if(quoted==undefined) swapMarket=await getSwapMarket(targetToken);
    else swapMarket=await getSwapMarketRapid(targetToken,quoted);
    if(!swapMarket) return res.json({status:"error",error:"NO_MARKET"})
    const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0.001,true);
    return res.json({status:"success",data:result})
})

app.get("/buy/:id",async (req,res)=>{
    const targetToken=req.params.id;
    const password=req.headers.passkey;
    if(!password||(password!="noierrdev")) return res.json({status:"error",error:"WRONG_PASSWORD"})
    const swapMarket=await getSwapMarket(targetToken);
    if(!swapMarket) return res.json({status:"error",error:"NO_MARKET"})
    const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0.0001,false);
    return res.json({status:"success",data:result})
});

app.post("/buy/",async (req,res)=>{
    const targetToken=req.body.token;
    const amount=req.body.amount;
    const swapMarket=await getSwapMarket(targetToken);
    if(!swapMarket) return res.json({status:"error",error:"NO_MARKET"})
    const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,Number(amount),false);
    return res.json({status:"success",data:result})
});

app.get("/pumpfun/sell/:id",async (req,res)=>{
    const targetToken=req.params.id;
    await pumpfunSwapTransaction(targetToken,0.001,false);
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