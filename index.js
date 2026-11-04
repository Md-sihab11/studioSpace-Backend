import "dotenv/config";
import express from "express";
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import dns from "node:dns";
import { createRemoteJWKSet, jwtVerify } from "jose";
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



/**
 * BetterAuth signs the JWT with its own JWKS key. `BETTER_AUTH_URL` must point
 * at the frontend that hosts /api/auth (locally http://localhost:3000).
 */
const AUTH_BASE_URL = new URL(
    process.env.BETTER_AUTH_URL || "http://localhost:3000"
).origin;

const jwks = createRemoteJWKSet(
    new URL(`${AUTH_BASE_URL}/api/auth/jwks`)
);

const verifyToken = async (req, res, next) => {
    const authToken = req.headers.authorization;

    // Normalize "Bearer <token>" into the raw token.
    const token = authToken && authToken.startsWith("Bearer ")
        ? authToken.slice(7).trim()
        : authToken;

    if (!token) {
        return res.status(401).send({
            message: "Unauthorized! Token missing."
        });
    }

    try {
        const { payload } = await jwtVerify(token, jwks, {
            issuer: AUTH_BASE_URL,
            audience: AUTH_BASE_URL,
        });

        req.user = payload;
        next();
    } catch (error) {
        console.error(
            "Token verification failed:",
            error?.code || error?.message || error
        );

        return res.status(401).send({
            message: "Unauthorized! Invalid or expired token."
        });
    }
};

/** Convert "HH:mm" into minutes since midnight, rejecting impossible times. */
const timeToMinutes = (value) => {
    if (typeof value !== "string") return null;

    const [hours, minutes] = value.split(":").map(Number);

    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        return null;
    }

    return hours * 60 + minutes;
};

/**
 * Older seed documents use `imageUrl` while newer listings use `image`.
 * Normalize both so every client can rely on `image`.
 */
const toStudioResponse = (studio) => {
    if (!studio) return studio;

    return {
        ...studio,
        image: studio.image ?? studio.imageUrl ?? "",
        images: Array.isArray(studio.images) ? studio.images : [],
        rating: Number(studio.rating) || 0,
        reviews: Number(studio.reviews) || 0,
    };
};

app.get("/", (req, res) => {
    res.send("Hello, World!");
});

app.get("/studios", async (req, res) => {
    const { limit, sort } = req.query;

    let cursor = studioCollection.find();

    // The home page asks for ?limit=6&sort=rating; /studios fetches everything.
    if (sort === "rating") {
        cursor = cursor.sort({ rating: -1, createdAt: -1 });
    }

    const parsedLimit = Number(limit);
    if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
        cursor = cursor.limit(parsedLimit);
    }

    const result = await cursor.toArray();

    // Ignore incomplete seed/probe documents that would render blank cards.
    res.send(
        result
            .filter((studio) => {
                const image = studio.image ?? studio.imageUrl;
                return Boolean(studio.title && image);
            })
            .map(toStudioResponse)
    );
});
app.get("/studios/:id", async (req, res) => {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            success: false,
            message: "Invalid studio id.",
        });
    }

    const result = await studioCollection.findOne({
        _id: new ObjectId(id)
    });

    if (!result) {
        return res.status(404).send({
            success: false,
            message: "Studio not found.",
        });
    }

    res.send(toStudioResponse(result));
});


app.put("/update-studio/:id", verifyToken, async (req, res) => {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            success: false,
            message: "Invalid studio id.",
        });
    }

    const {
        _id: ignoredId,
        ownerEmail: ignoredOwnerEmail,
        ownerName: ignoredOwnerName,
        ...data
    } = req.body;

    const result = await studioCollection.updateOne(
        {
            _id: new ObjectId(id),
            ownerEmail: req.user.email,
        },
        {
            $set: {
                ...data,
                updatedAt: new Date(),
            }
        }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({
            success: false,
            message: "Listing not found, or you do not own it.",
        });
    }

    res.send({ success: true, ...result });
});

app.delete("/delete-studio/:id", verifyToken, async (req, res) => {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            success: false,
            message: "Invalid studio id.",
        });
    }

    const result = await studioCollection.deleteOne({
        _id: new ObjectId(id),
        ownerEmail: req.user.email,
    });

    if (result.deletedCount === 0) {
        return res.status(404).send({
            success: false,
            message: "Listing not found, or you do not own it.",
        });
    }

    res.send({ success: true, ...result });
});

app.post("/add-studio", verifyToken, async (req, res) => {
    const {
        _id: ignoredId,
        ownerEmail: ignoredOwnerEmail,
        ownerName: ignoredOwnerName,
        ...data
    } = req.body;

    const result = await studioCollection.insertOne({
        ...data,
        // Never trust these values from the browser.
        ownerEmail: req.user.email,
        ownerName: req.user.name ?? "",
        createdAt: new Date(),
    });

    res.send(result);
});

app.post("/add-booking", verifyToken, async (req, res) => {
    const data = req.body;

    const start = timeToMinutes(data.startTime);
    const hours = Number(data.hours);

    if (!data.studioId || !data.date || start === null || !Number.isFinite(hours) || hours <= 0) {
        return res.status(400).send({
            success: false,
            message: "A studio, date, start time and positive duration are required.",
        });
    }

    const end = start + hours * 60;

    // Challenge 2: reject overlapping live reservations for the same studio/day.
    const sameDayBookings = await bookingCollection.find({
        studioId: data.studioId,
        date: data.date,
        status: { $in: ["Pending", "Confirmed"] },
    }).toArray();

    const conflict = sameDayBookings.find((booking) => {
        const otherStart = timeToMinutes(booking.startTime);
        const otherHours = Number(booking.hours);

        if (otherStart === null || !Number.isFinite(otherHours)) return false;

        const otherEnd = otherStart + otherHours * 60;

        return start < otherEnd && otherStart < end;
    });

    if (conflict) {
        return res.status(409).send({
            success: false,
            message: `That time overlaps an existing ${conflict.status.toLowerCase()} booking (${conflict.startTime}, ${conflict.hours}h). Please pick another slot.`,
        });
    }

    const result = await bookingCollection.insertOne({
        ...data,
        // Override the client-supplied identity with the verified token.
        userEmail: req.user.email,
        userName: req.user.name ?? data.userName ?? "",
        status: "Pending",
        createdAt: new Date()
    });

    res.send(result);
});

app.get("/my-listings/:email", verifyToken, async (req, res) => {
    const email = req.params.email;

    if (email.toLowerCase() !== String(req.user.email).toLowerCase()) {
        return res.status(403).send({
            success: false,
            message: "You can only view your own listings.",
        });
    }

    const result = await studioCollection.find({
        ownerEmail: email
    }).toArray();

    res.send(result);
});


app.get("/my-bookings/:email", verifyToken, async (req, res) => {
    const email = req.params.email;

    if (email.toLowerCase() !== String(req.user.email).toLowerCase()) {
        return res.status(403).send({
            success: false,
            message: "You can only view your own bookings.",
        });
    }

    const result = await bookingCollection.find({
        userEmail: email
    }).toArray();

    res.send(result);
});
app.patch("/cancel-booking/:id", verifyToken, async (req, res) => {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            success: false,
            message: "Invalid booking id.",
        });
    }

    const result = await bookingCollection.updateOne(
        {
            _id: new ObjectId(id),
            userEmail: req.user.email,
            status: "Pending"
        },
        {
            $set: {
                status: "Cancelled"
            }
        }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({
            success: false,
            message: "Booking not found, already cancelled, or not yours.",
        });
    }

    res.send({ success: true, ...result });
});
app.patch("/booking-status/:id", verifyToken, async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            message: "Invalid booking id"
        });
    }

    if (!["Pending", "Confirmed", "Completed", "Cancelled"].includes(status)) {
        return res.status(400).send({
            message: "Invalid booking status"
        });
    }

    const booking = await bookingCollection.findOne({
        _id: new ObjectId(id)
    });

    if (!booking) {
        return res.status(404).send({
            message: "Booking not found"
        });
    }

    // Only the guest who booked or the host who owns the studio may update it.
    let isStudioOwner = false;

    if (booking.studioId && ObjectId.isValid(booking.studioId)) {
        const studio = await studioCollection.findOne(
            { _id: new ObjectId(booking.studioId) },
            { projection: { ownerEmail: 1 } }
        );

        isStudioOwner =
            studio?.ownerEmail?.toLowerCase() ===
            String(req.user.email).toLowerCase();
    }

    const isGuest =
        booking.userEmail?.toLowerCase() ===
        String(req.user.email).toLowerCase();

    if (!isGuest && !isStudioOwner) {
        return res.status(403).send({
            message: "You cannot update this booking."
        });
    }

    const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: status } }
    );

    res.send(result);
});

const isServerless = Boolean(process.env.VERCEL);

if (!isServerless) {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}

export { app };
export default app;