require("dotenv").config();
const express=require("express")
const {Connection,PublicKey,Keypair}=require("@solana/web3.js")
const {swapTokenRapid,swapTokenTest}=require("./swap");
const { getSwapMarket, getSwapMarketRapid } = require("./utils");
const connection=new Connection(process.env.RPC_API);
const app=express();
const bodyParser=require("body-parser");
const cors=require("cors")

app.use(cors())
app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));

app.get("/sell/:id",async (req,res)=>{
    const targetToken=req.params.id;
    const swapMarket=await getSwapMarket(targetToken);
    const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0,true);
    return res.json({status:"success",data:result})
});

app.post("/sell",async (req,res)=>{
    const targetToken=req.body.token;
    const quoted=req.body.quoted;
    var swapMarket;
    if(quoted==undefined) swapMarket=await getSwapMarket(targetToken);
    else swapMarket=await getSwapMarketRapid(targetToken,quoted);
    const result=await swapTokenRapid(targetToken,swapMarket.poolKeys,0,true);
    return res.json({status:"success",data:result})
})


app.listen(process.env.PORT,()=>{

})