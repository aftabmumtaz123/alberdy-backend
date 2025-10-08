const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config(); // Load .env before using process.env

const app = express();
app.use(express.json());

const mongoURI = process.env.MONGODB_URL; // ✅ Correct variable name
console.log("Mongo URI from env:", mongoURI); // Debugging

mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) => console.error("❌ MongoDB Connection Failed:", err.message));

app.listen(3000, () => console.log("Server running on port 3000"));
