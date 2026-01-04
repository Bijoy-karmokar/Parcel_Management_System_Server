const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4imj4lo.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const parcelCollection = client.db("parcelDB").collection("parcels");
    const usersCollection = client.db("parcelDB").collection("users");
    const paymentsCollection = client.db("parcelDB").collection("payments");
    const trackingCollection = client.db("parcelDB").collection("tracking");

    app.post("/users",async(req,res)=>{
       const email= req.body.email;
       const userExist = await usersCollection.findOne({email});
       if(userExist){
        return res.status(200).send({message:"User already exists",inserted:false});
       }
       const user = req.body;
       const result = await usersCollection.insertOne(user);
       res.send(result);
    })

    app.get("/parcels", async (req, res) => {
      const parcels = await parcelCollection.find().toArray();

      res.send(parcels);
    });
    // get myParcels
    app.get("/parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { created_by: userEmail } : {};
        const options = {
          sort: { createdAt: -1 },
        };
        const parcels = await parcelCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        res.status(500).send({ message: "Failed to get parcels" });
      }
    });

    // get a specific parcelID
    app.get("/parcels/:id", async (req, res) => {
      const { id } = req.params;
      console.log(id);

      try {
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!parcel)
          return res.status(404).send({ message: "Parcel not found" });
        res.send(parcel);
      } catch (err) {
        res.status(500).send({ message: "Invalid parcel ID" });
      }
    });

    // post the parcels
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const result = await parcelCollection.insertOne(parcel);
      res.send({
        success: true,
        insertedId: result.insertedId,
      });
    });

    // delete the parcels

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const result = await parcelCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // payment-intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount, parcelId, userEmail } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: "bdt",
          payment_method_types: ["card"],
          metadata: { parcelId, userEmail },
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to create payment intent" });
      }
    });

    // Mark parcel as paid and save transaction
    app.patch("/parcels/pay/:id", async (req, res) => {
      const { id } = req.params;
      const { transactionId } = req.body;

      try {
        const result = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { payment_status: "paid", transactionId } }
        );

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ error: "Failed to update payment" });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, userEmail, amount, transactionId } = req.body;
        const payment = {
          parcelId,
          userEmail,
          amount,
          transactionId,
          createdAt: new Date(),
        };

        await paymentsCollection.insertOne(payment);

        // Mark parcel as paid
        await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: "paid", transactionId } }
        );

        res.send({ success: true, payment });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Payment recording failed" });
      }
    });

    // Get parcels (all or by user email)
    app.get("/parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { created_by: userEmail } : {};
        const options = { sort: { createdAt: -1 } };
        const parcels = await parcelCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        res.status(500).send({ message: "Failed to get parcels" });
      }
    });

    // ----------- GET payments for a specific user -----------
    app.get("/payments/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const payments = await paymentsCollection
          .find({ userEmail: email })
          .toArray();
        res.send(payments);
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to fetch payments" });
      }
    });

    // tracking info
    // Add tracking update
    app.post("/tracking/:parcelId", async (req, res) => {
      const { parcelId } = req.params;
      const { status, location } = req.body;
      const update = {
        status,
        location,
        date: new Date(),
      };

      try {
        const result = await trackingCollection.updateOne(
          { parcelId },
          { $push: { updates: update } },
          { upsert: true } // create if doesn't exist
        );
        res.send({ success: true, update });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .send({ success: false, message: "Failed to add tracking update" });
      }
    });

    // Get tracking updates for a parcel
    app.get("/tracking/:parcelId", async (req, res) => {
      const { parcelId } = req.params;
      try {
        const tracking = await trackingCollection.findOne({ parcelId });
        if (!tracking)
          return res.status(404).send({ message: "No tracking info found" });
        res.send(tracking);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch tracking info" });
      }
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
