/**
 * TGVIG - THE GROOVE VIG
 * Backend Production Server
 * Node.js + Express + MongoDB
 * Full Loyalty, POS, Wallet, Tier, Rewards Logic
 * Color Theme: Black (#1B1B1B), Purple (#6A0DAD), Gold (#FFD700)
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  origin: '*'
  }));
  
// ----------------------
// DATABASE CONNECTION
// ----------------------
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://TheGrooveVig_db_user:2026TGVIGPTYLTD@loyaltycluster.pe06khq.mongodb.net/tgvig?retryWrites=true&w=majority";
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB Connected to TGVIG_DB!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// ----------------------
// SCHEMA DEFINITIONS
// ----------------------

// Content Schema (blogs, menus, clubs)
const contentSchema = new mongoose.Schema({
    type: String,
    data: Object
});
const Content = mongoose.model('Content', contentSchema);

// Member Schema
const memberSchema = new mongoose.Schema({
    membershipNo: { type: String, unique: true, required: true },
    name: String,
    surname: String,
    dob: Date,
    idNumber: { type: String, unique: true },
    phone: { type: String, unique: true },
    email: { type: String, unique: true },
    password: { type: String, required: true },
    pin: { type: String, required: true },
    address: String,
    nationality: String,
    referralCode: String,
    tier: { type: String, default: "Gold" },
    membershipType: String, // "FREE", "PAID"
    walletBalance: { type: Number, default: 0 },
    pointsBalance: { type: Number, default: 100 },
    rolling90DaySpend: { type: Number, default: 0 },
    digital_wallet: { type: Number, default: 0 },
    status: { type: String, default: "Active" },
    qrCode: String,
    clubHome: String, // "717 Hangout", etc.
    joinDate: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    activeDaysThisMonth: { type: Number, default: 1 },
    coupons: Array
});
const Member = mongoose.model('Member', memberSchema);

// Transaction Schema
const transactionSchema = new mongoose.Schema({
    transactionId: { type: String, default: () => uuidv4() },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Member" },
    clubId: String,
    amount: Number,
    paymentType: String, // "Cash", "Wallet", "Points"
    date: { type: Date, default: Date.now },
    rewardEligible: Boolean,
    pointsEarned: Number,
    pointsUsed: Number,
    brandApplied: String
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// Brand Campaign Schema
const brandCampaignSchema = new mongoose.Schema({
    brandName: String,
    startDate: Date,
    endDate: Date,
    multiplier: Number,
    targetProduct: String,
    sponsoredBudget: Number
});
const BrandCampaign = mongoose.model('BrandCampaign', brandCampaignSchema);

// Reward Schema
const rewardSchema = new mongoose.Schema({
    name: String,
    pointsRequired: Number,
    tierRequired: String,
    maxRedemptionsPerMonth: Number,
    blackoutDates: [Date],
    vipTableRequired: Boolean
});
const Reward = mongoose.model('Reward', rewardSchema);

// ----------------------
// RULES & CONFIG
// ----------------------
const RULES = {
    TIERS: {
        Gold: { disc: 0.10, upgrade: 10000, bday: 300, depMax: 20000, spendMax: 5000 },
        Silver: { disc: 0.15, upgrade: 20000, bday: 500, depMax: 50000, spendMax: 20000 },
        Black: { disc: 0.25, upgrade: 999999, bday: 1000, depMax: 100000, spendMax: 65000 }
    },
    POINT_VAL: 0.286, // 1 Point = R0.286
    FEES: { POS_CASH: 2.00, WEB_WALLET: 3.00, APP_WALLET: 1.50 },
    POINTS_RATE: 15 // R15 = 1 point
};

// ----------------------
// UTILITY FUNCTIONS
// ----------------------
function calculatePoints(amount, tierMultiplier = 1) {
    return Math.floor(amount / RULES.POINTS_RATE) * tierMultiplier;
}

function assignTier(user) {
    const spend = user.rolling90DaySpend;
    if (spend < 7500) return "Gold";
    if (spend >= 7500 && spend < 20000) return "Silver";
    return "Black";
}

function checkRewardEligibility(user, reward) {
    if (user.pointsBalance < reward.pointsRequired) return false;
    if (reward.tierRequired !== "ANY" && user.tier !== reward.tierRequired) return false;
    if (user.rolling90DaySpend < 750) return false;
    if (reward.vipTableRequired && !user.vipBooking) return false;
    return true;
}

// ----------------------
// MEMBER APIs
// ----------------------

// Self-registration
app.post('/register', async (req, res) => {
    const { name, surname, dob, idNumber, phone, email, password, pin, address, nationality, referralCode, clubHome } = req.body;
    try {
        const existing = await Member.findOne({ $or: [{ phone }, { idNumber }, { email }] });
        if (existing) return res.status(400).json({ success: false, error: "Member already exists" });

        const newUser = new Member({
            membershipNo: "TGVIG" + Math.floor(100000 + Math.random() * 900000),
            name, surname, dob, idNumber, phone, email, password, pin, address, nationality, referralCode, clubHome
        });

        await newUser.save();
        res.json({ success: true, message: "Welcome to THE GROOVE VIG!", membershipNo: newUser.membershipNo });
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await Member.findOne({ email, password }).lean();
        if (!user) return res.status(401).json({ success: false, error: "Invalid credentials" });
        Member.findByIdAndUpdate(user._id, { lastActive: new Date() }).exec();
        res.json({ success: true, user });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// Wallet top-up
app.post('/api/wallet/topup', async (req, res) => {
    const { membershipNo, amount } = req.body;
    try {
        const user = await Member.findOneAndUpdate(
            { membershipNo },
            { $inc: { digital_wallet: Number(amount) } },
            { new: true }
        ).lean();
        if (!user) return res.status(404).json({ success: false, error: "Member not found" });
        res.json({ success: true, message: "Top-up successful", new_balance: user.digital_wallet });
    } catch (err) {
        console.error("Top-up Error:", err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// ----------------------
// POS APIs
// ----------------------
app.post('/pos/login', (req, res) => {
    const { username, password } = req.body;
    if (username === "admin@POS" && password === "TGVIG0000") return res.json({ success: true, message: "POS login successful" });
    res.status(401).json({ success: false, error: "Invalid POS credentials" });
});

app.post('/api/pos/purchase', async (req, res) => {
    const { phone, amount, paymentMethod, pin, loyaltyPointsOverride, requiredPoints } = req.body;
    try {
        const user = await Member.findOne({ phone });
        if (!user) return res.status(404).json({ success: false, error: "Member not found" });
        if (user.pin !== pin) return res.status(401).json({ success: false, error: "Invalid PIN" });

        let netPrice = amount;
        let earnedPoints = 0;
        let pointsUsed = 0;
        let fee = 0;

        // Payment logic
        if (paymentMethod === "POINTS") {
            if (user.pointsBalance < requiredPoints) return res.status(400).json({ success: false, error: "Insufficient points" });
            user.pointsBalance -= requiredPoints;
            pointsUsed = requiredPoints;
            netPrice = 0;
        } else {
            // Cash / Wallet
            const discount = RULES.TIERS[user.tier].disc;
            netPrice = amount - (amount * discount);

            if (paymentMethod === "CASH") fee = RULES.FEES.POS_CASH;
            if (paymentMethod === "WALLET") {
                fee = RULES.FEES.WEB_WALLET;
                if (user.digital_wallet < (netPrice + fee)) return res.status(400).json({ success: false, error: "Insufficient wallet" });
                user.digital_wallet -= (netPrice + fee);
            }

            earnedPoints = loyaltyPointsOverride && loyaltyPointsOverride > calculatePoints(netPrice) ? loyaltyPointsOverride : calculatePoints(netPrice);
            user.pointsBalance += earnedPoints;
        }

        // Tier assignment
        user.tier = assignTier(user);
        user.lastActive = new Date();
        user.rolling90DaySpend += amount;
        await user.save();

        // Log transaction
        const trx = new Transaction({
            userId: user._id,
            clubId: user.clubHome,
            amount,
            paymentType: paymentMethod,
            pointsEarned: earnedPoints,
            pointsUsed
        });
        await trx.save();

        res.json({
            success: true,
            receipt: {
                membershipNo: user.membershipNo,
                gross: amount,
                net: netPrice,
                fee,
                points_earned: earnedPoints,
                points_used: pointsUsed,
                total_points: user.pointsBalance,
                wallet_bal: user.digital_wallet,
                tier: user.tier,
                coupon_code: uuidv4().substring(0,8).toUpperCase()
            }
        });
    } catch (err) {
        console.error("Purchase Error:", err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// ----------------------
// ADMIN APIs
// ----------------------
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === "admin@TGVIG" && password === "TGVIG1234") return res.json({ success: true, message: "Admin login successful" });
    res.status(401).json({ success: false, error: "Access Denied" });
});

app.get('/members', async (req, res) => {
    try {
        const members = await Member.find().select('digital_wallet pointsBalance tier status clubHome').lean();
        res.json(members);
    } catch (err) {
        res.status(500).json({ error: "Unable to fetch members" });
    }
});

app.post('/api/admin/content/update', async (req, res) => {
    const { type, content } = req.body;
    try {
        await Content.updateOne({ type }, { $push: { data: content } }, { upsert: true });
        res.json({ success: true, message: `Content ${type} updated` });
    } catch (err) {
        res.status(500).json({ success: false, error: "Update failed" });
    }
});

app.get('/api/admin/fraud-check', async (req, res) => {
    try {
        const suspicious = await Member.find({ pointsBalance: { $gt: 50000 }, digital_wallet: 0 }).lean();
        res.json({ success: true, total_members: await Member.countDocuments(), suspicious_count: suspicious.length, details: suspicious });
    } catch (err) {
        res.status(500).json({ success: false, error: "Fraud check failed" });
    }
});

// ----------------------
// SERVER START
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
===========================================
THE GROOVE VIG - PRODUCTION BACKEND LIVE
===========================================
PORT: ${PORT}
STATUS: ALL SYSTEMS OPERATIONAL
COLOR THEME: BLACK, PURPLE, GOLD
===========================================
`);
});