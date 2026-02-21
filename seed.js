/**
 * TGVIG - SEED SCRIPT
 * Populates Admin, POS, Members, Rewards, and Brand Campaigns
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Import your models
const Member = require('./models/member');        // Your Member schema
const Reward = require('./models/reward');        // Your Reward schema
const BrandCampaign = require('./models/brandCampaign'); // Your Brand Campaign schema

// ----------------------
// DATABASE CONNECTION
// ----------------------
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/TGVIG_DB";

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        console.log("MongoDB connected, starting seeding...");

        // --- CLEAR EXISTING DATA ---
        await Member.deleteMany({});
        await Reward.deleteMany({});
        await BrandCampaign.deleteMany({});
        console.log("Existing collections cleared.");

        // --- ADMIN & POS USERS ---
        const adminUser = {
            membershipNo: "ADMIN001",
            name: "Admin",
            surname: "Master",
            email: "admin@TGVIG",
            password: "TGVIG1234",
            pin: "9999",
            phone: "0800000000",
            tier: "Black",
            membershipType: "PAID",
            walletBalance: 100000,
            pointsBalance: 100000,
            clubHome: "CONTROL TOWER"
        };

        const posUser = {
            membershipNo: "POS001",
            name: "POS",
            surname: "Operator",
            email: "admin@POS",
            password: "TGVIG0000",
            pin: "0000",
            phone: "0800000001",
            tier: "Black",
            membershipType: "PAID",
            walletBalance: 50000,
            pointsBalance: 50000,
            clubHome: "POS TERMINAL"
        };

        await Member.insertMany([adminUser, posUser]);
        console.log("Admin & POS users seeded.");

        // --- 10 TEST MEMBERS ---
        const clubs = ["717 Hangout", "Bizza Lifestyle", "Day Vibe Lifestyle"];
        const members = [];
        for(let i=1;i<=10;i++){
            members.push({
                membershipNo: "TGVIG" + (100000+i),
                name: `Test${i}`,
                surname: "Member",
                email: `test${i}@tgvig.com`,
                password: "123456",
                pin: (1000+i).toString(),
                phone: "081000000"+i,
                tier: i<5?"Gold":"Silver",
                membershipType: i%2===0?"PAID":"FREE",
                walletBalance: 500 + i*50,
                pointsBalance: 1000 + i*100,
                rolling90DaySpend: 1000*i,
                clubHome: clubs[i%3],
                lastActive: new Date()
            });
        }
        await Member.insertMany(members);
        console.log("10 Test members seeded.");

        // --- 5 SAMPLE REWARDS ---
        const rewards = [
            { name: "6-pack Beer Bonus", pointsRequired: 200, tierRequired: "Gold", maxRedemptionsPerMonth: 10, vipTableRequired: false },
            { name: "VIP Bottle Service", pointsRequired: 500, tierRequired: "Silver", maxRedemptionsPerMonth: 5, vipTableRequired: true },
            { name: "Free Cocktail", pointsRequired: 100, tierRequired: "Gold", maxRedemptionsPerMonth: 20, vipTableRequired: false },
            { name: "Weekend VIP Lounge", pointsRequired: 800, tierRequired: "Black", maxRedemptionsPerMonth: 3, vipTableRequired: true },
            { name: "Discounted Menu Access", pointsRequired: 150, tierRequired: "ANY", maxRedemptionsPerMonth: 15, vipTableRequired: false },
        ];
        await Reward.insertMany(rewards);
        console.log("5 Sample rewards seeded.");

        // --- 2 SAMPLE BRAND CAMPAIGNS ---
        const brandCampaigns = [
            { brandName: "Vodka Royale", startDate: new Date(), endDate: new Date(Date.now()+30*24*3600*1000), multiplier: 2, targetProduct: "Vodka", sponsoredBudget: 50000 },
            { brandName: "Chill Wine Co", startDate: new Date(), endDate: new Date(Date.now()+30*24*3600*1000), multiplier: 1.5, targetProduct: "Wine", sponsoredBudget: 50000 },
        ];
        await BrandCampaign.insertMany(brandCampaigns);
        console.log("2 Brand campaigns seeded.");

        console.log("✅ Seeding completed successfully!");
        process.exit(0);
    })
    .catch(err => {
        console.error("MongoDB connection failed:", err);
        process.exit(1);
    });