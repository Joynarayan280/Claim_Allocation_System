// scripts/create-admin.js
// Chalano: ADMIN_ID=ADMIN ADMIN_PASSWORD='KothinPass@2026' node scripts/create-admin.js
// (ba .env-e ADMIN_ID / ADMIN_PASSWORD likhe `npm run create-admin`). Admin-er password bhule gele eta abar chalalei notun password set hoy.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { ensureAdmin } = require('../utils/bootstrapAdmin');

(async () => {
  if (!process.env.ADMIN_PASSWORD) {
    console.error('❌ Provide an admin password. For example: ADMIN_PASSWORD="pass@12345" node scripts/create-admin.js');
    process.exit(1);
  }
  await connectDB();
  const doc = await ensureAdmin({ force: true });
  console.log(`✓ Admin ready. Login ID: ${doc.employeeId}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
