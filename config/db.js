// config/db.js
// Task: Connection to MongoDB. The password is retrieved from the .env file and is not hardcoded in the code.

const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('❌ `mango_url` not found. Create an `.env` file (refer to `.env.example`).');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('✓ Database connected');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
