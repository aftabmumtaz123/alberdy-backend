// config/db.js
const mongoose = require('mongoose');
require('dotenv').config();

const connection = async () => {
  try {
    const mongoURI = process.env.MONGODB_URL;
    console.log("🔗 Connecting to MongoDB...");
    console.log("Mongo URI from env:", mongoURI);

    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ MongoDB Connected Successfully");
  } catch (error) {
    console.error("❌ MongoDB Connection Failed:", error.message);
    process.exit(1);
  }
};

module.exports = connection;
