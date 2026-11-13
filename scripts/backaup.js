const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('Error: MONGO_URI is missing.');
    process.exit(1);
}

async function runBackup() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB for backup...');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const backupData = {
            timestamp: new Date().toISOString(),
            collections: {}
        };

        for (const col of collections) {
            const name = col.name;
            backupData.collections[name] = await db.collection(name).find({}).toArray();
        }

        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const today = new Date().toISOString().split('T')[0];
        const filePath = path.join(backupDir, `backup-${today}.json`);
        fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));

        console.log(`Backup saved successfully: ${filePath}`);
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('Backup failed:', err);
        process.exit(1);
    }
}

runBackup();