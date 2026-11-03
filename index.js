import "dotenv/config";
import express from "express";
import { MongoClient, ObjectId } from 'mongodb';
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
const bookingCollection = db.collection("bookings");



const verifyToken = (req, res, next) => {
    console.log("🔥 VERIFY MIDDLEWARE CALLED");
    const authToken = req.headers.authorization;

    console.log("========== TOKEN DEBUG ==========");
    console.log("Authorization Header:", authToken);
    console.log("Token Received:", !!authToken);

    if (!authToken) {
        return res.status(401).send({
            message: "Unauthorized! Token missing."
        });
    }

    next();
};

app.get("/", (req, res) => {
    res.send("Hello, World!");
});

app.get("/studios", async (req, res) => {
    const result = await studioCollection.find().toArray()
    res.send(result)
});
app.get("/studios/:id", async (req, res) => {
    const id = req.params.id;

    const result = await studioCollection.findOne({
        _id: new ObjectId(id)
    });

    res.send(result);
});


app.put("/update-studio/:id", async (req, res) => {
    const id = req.params.id;
    const data = req.body;

    const result = await studioCollection.updateOne(
        { _id: new ObjectId(id) },
        {
            $set: data
        }
    );

    res.send(result);
});

app.delete("/delete-studio/:id", verifyToken, async (req, res) => {
    const id = req.params.id;

    const result = await studioCollection.deleteOne({
        _id: new ObjectId(id)
    });

    res.send(result);
});

app.post("/add-studio", verifyToken, async (req, res) => {
    const data = req.body
    const result = await studioCollection.insertOne(data)
    console.log(result)
    res.send(result)
});

app.post("/add-booking", verifyToken, async (req, res) => {
    const data = req.body;

    const result = await bookingCollection.insertOne({
        ...data,
        status: "Pending",
        createdAt: new Date()
    });

    res.send(result);
});

app.get("/my-listings/:email", async (req, res) => {
    const email = req.params.email;

    const result = await studioCollection.find({
        ownerEmail: email
    }).toArray();

    res.send(result);
});


app.get("/my-bookings/:email", async (req, res) => {
    const email = req.params.email;

    const result = await bookingCollection.find({
        userEmail: email
    }).toArray();

    res.send(result);
});
app.patch("/cancel-booking/:id", async (req, res) => {
    const id = req.params.id;

    const result = await bookingCollection.updateOne(
        {
            _id: new ObjectId(id),
            status: "Pending"
        },
        {
            $set: {
                status: "Cancelled"
            }
        }
    );

    res.send(result);
});
app.patch("/booking-status/:id", async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;

    if (!["Pending", "Confirmed", "Completed", "Cancelled"].includes(status)) {
        return res.status(400).send({
            message: "Invalid booking status"
        });
    }

    const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: status } }
    );

    res.send(result);
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});