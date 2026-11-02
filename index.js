import "dotenv/config";
import express from "express";
import { MongoClient } from 'mongodb';
import cors from 'cors';
import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);


const app = express();
app.use(cors());
app.use(express.json())
const PORT = process.env.PORT;

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
}

const mongoclient = await connectToMongoDB();
const db = mongoclient.db("studiospace");
const studioCollection = db.collection("studios")


app.get("/", (req, res) => {
    res.send("Hello, World!");
});

app.get("/studios", async (req, res) => {
    const result = await studioCollection.find().toArray()
    res.send(result)
});

app.post("/add-studio", async (req, res) => {
    const data = req.body
    const result = await studioCollection.insertOne(data)
    console.log(result)
    res.send(result)
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});