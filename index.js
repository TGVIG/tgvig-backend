const express = require('express');
const mongoose = require('mongoose'); // Import Mongoose
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config(); // To load the MONGODB_URI from the .env file

const app = express();
app.use(express.json());
app.use(cors());

// --- DATABASE CONNECTION (MongoDB) ---
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster.mongodb.net/TGVIG_DB";

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected to TGVIG_DB!'))
.catch(err => console.error('MongoDB Connection Error:', err));

// --- MONGODB SCHEMA DEFINITIONS ---
// Content Schema (for Blogs, Menus, etc.)
const contentSchema = new mongoose.Schema({
    type: String, // 'blogs', 'clubs', 'menus'
    data: Object
});
const Content = mongoose.model('Content', contentSchema);


// Member Schema (for all user data)
const memberSchema = new mongoose.Schema({
    membershipNo: { type: String, unique: true, required: true },
    name: String,
    surname: String,
    dob: Date,
    idNumber: { type: String, unique: true },
    phone: { type: String, unique: true },
    email: { type: String, unique: true },
    password: { type: String, required: true }, // NOTE: Should be hashed in production!
    pin: { type: String, required: true },
    address: String,
    nationality: String,
    referralCode: String,
    tier: { type: String, default: "Gold" },
    points: { type: Number, default: 100 },
    digital_wallet: { type: Number, default: 0 },
    status: { type: String, default: "Active" },
    joinDate: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    activeDaysThisMonth: { type: Number, default: 1 },
    coupons: Array
});
const Member = mongoose.model('Member', memberSchema);

// --- RULES & CONFIGURATION (Stored locally for simplicity) ---
const RULES = {
    TIERS: {
        "Gold": { disc: 0.10, upgrade: 10000, bday: 300, depMax: 20000, spendMax: 5000 },
        "Silver": { disc: 0.15, upgrade: 20000, bday: 500, depMax: 50000, spendMax: 20000 },
        "Black": { disc: 0.25, upgrade: 999999, bday: 1000, depMax: 100000, spendMax: 65000 }
    },
    REDEEM_VAL: 0.286, // 1 Point = R0.286
    FEES: { POS_CASH: 2.00, WEB_WALLET: 3.00, APP_WALLET: 1.50 }
};

// ==========================================
// 1. MEMBER WEB PORTAL APIS
// ==========================================

// SELF-REGISTRATION (Full Form)
app.post('/register', async (req, res) => {
    const { name, surname, dob, idNumber, phone, email, password, pin, address, nationality, referralCode } = req.body;

    try {
        const existingMember = await Member.findOne({ $or: [{ phone }, { idNumber }, { email }] });
        if (existingMember) {
            return res.status(400).json({ success: false, error: "Member already exists with this Phone/ID/Email" });
        }

        const newUser = new Member({
            membershipNo: "TGVIG" + Math.floor(100000 + Math.random() * 900000),
            name, surname, dob, idNumber, phone, email, password, pin, address, nationality, referralCode,
            points: 100, // New Member Gift (default in schema, but explicit is good)
        });

        await newUser.save();
        res.json({ success: true, message: "Welcome to THE GROOVE VIG!", member: newUser, membershipNo: newUser.membershipNo });

    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ success: false, error: "Server error during registration." });
    }
});

// MEMBER LOGIN
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await Member.findOne({ email, password }).lean(); // .lean() for plain JS object
        
        if (!user) {
            return res.status(401).json({ success: false, error: "Invalid Credentials" });
        }
        
        // Log user activity (no need to await this)
        Member.findByIdAndUpdate(user._id, { lastActive: new Date() }).exec();

        res.json({ success: true, user: user });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, error: "Server error during login." });
    }
});

// EFT TOP-UP (Wallet)
app.post('/api/wallet/topup', async (req, res) => {
    const { membershipNo, amount } = req.body;

    try {
        const user = await Member.findOneAndUpdate(
            { membershipNo: membershipNo },
            { $inc: { digital_wallet: Number(amount) } },
            { new: true } // Return the updated document
        ).lean();
    
        if (!user) return res.status(404).json({ success: false, error: "Member not found" });

        res.json({ success: true, message: "Top-up Approved via EFT", new_balance: user.digital_wallet });
        
    } catch (error) {
        console.error("Top-up Error:", error);
        res.status(500).json({ success: false, error: "Server error during top-up." });
    }
});

// ==========================================
// 2. POS TILL APIS
// ==========================================

// POS Terminal Login (for POS staff) - Stays as local check for simplicity
app.post('/pos/login', (req, res) => {
    const { username, password } = req.body;
    if (username === "admin@POS" && password === "TGVIG0000") {
        return res.json({ success: true, message: "POS Login Successful" });
    }
    res.status(401).json({ success: false, error: "Invalid POS Credentials" });
});


// PURCHASE (Logic: Tiers, Fees, Points Override)
app.post('/api/pos/purchase', async (req, res) => {
    const { phone, amount, paymentMethod, pin, loyaltyPointsOverride, requiredPoints } = req.body;

    try {
        // Find user by phone number
        let user = await Member.findOne({ phone: phone });
        
        if (!user) return res.status(404).json({ success: false, error: "Member not found" });
        if (user.pin !== pin) return res.status(401).json({ success: false, error: "Invalid PIN" });

        let priceAfterDiscount = amount;
        let earned = 0;
        let fee = 0;
        let pointsUsed = 0;

        // --- PAYMENT LOGIC ---
        if (paymentMethod === "POINTS") {
            if (user.points < requiredPoints) return res.status(400).json({ success: false, error: "Insufficient Loyalty Points" });
            
            user.points -= requiredPoints;
            pointsUsed = requiredPoints;
            priceAfterDiscount = 0; // No money is exchanged
        } 
        else {
            // Cash / Wallet Transaction
            let discount = RULES.TIERS[user.tier].disc;
            priceAfterDiscount = amount - (amount * discount);
            
            // Apply Fee & Calculate Earned Points
            if (paymentMethod === "CASH") {
                fee = RULES.FEES.POS_CASH;
                earned = Math.floor(priceAfterDiscount / 3.50);
            } else if (paymentMethod === "WALLET") {
                // Assuming POS wallet transaction uses the highest fee (WEB) or a specific POS fee
                fee = RULES.FEES.WEB_WALLET; 
                earned = Math.floor(priceAfterDiscount / 2.00);
                
                if (user.digital_wallet < (priceAfterDiscount + fee)) return res.status(400).json({ success: false, error: "Insufficient Wallet Funds" });
                user.digital_wallet -= (priceAfterDiscount + fee);
            }
            
            // Loyalty Menu Override Logic
            if (loyaltyPointsOverride && loyaltyPointsOverride > earned) {
                earned = loyaltyPointsOverride;
            }
            user.points += earned;
        }

        // --- TIER UPGRADES ---
        if (user.points >= 20000 && user.tier !== "Black") user.tier = "Black";
        else if (user.points >= 10000 && user.tier === "Gold") user.tier = "Silver";
        
        user.lastActive = new Date();
        await user.save();

        res.json({
            success: true,
            receipt: {
                membershipNo: user.membershipNo,
                gross: amount,
                discount: (paymentMethod === 'POINTS' ? 0 : RULES.TIERS[user.tier].disc * 100) + "%",
                net: priceAfterDiscount,
                fee: fee,
                points_earned: earned,
                points_used: pointsUsed, // Key needed for POS receipt logic
                total_points: user.points,
                wallet_bal: user.digital_wallet,
                tier: user.tier,
                coupon_code: uuidv4().substring(0, 8).toUpperCase(),
                after_discount: `R${priceAfterDiscount.toFixed(2)}`
            }
        });
    } catch (error) {
        console.error("Purchase Error:", error);
        res.status(500).json({ success: false, error: "Server error during purchase." });
    }
});

// ==========================================
// 3. ADMIN CENTRAL MANAGER APIS
// ==========================================

// ADMIN LOGIN - Stays as local check for simplicity
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === "admin@TGVIG" && password === "TGVIG1234") {
        return res.json({ success: true, message: "Admin Login Successful" });
    }
    res.status(401).json({ success: false, error: "Access Denied" });
});

// ADMIN: Get all members (for dashboard stats)
app.get('/members', async (req, res) => {
    try {
        const members = await Member.find().select('digital_wallet points tier status').lean();
        res.json(members);
    } catch (error) {
        res.status(500).json({ error: 'Could not fetch member stats' });
    }
});


// UPDATE BLOGS/MENUS (Simplified)
app.post('/api/admin/content/update', async (req, res) => {
    const { type, content } = req.body; 

    try {
        // Find or create a content document for this type, then push new data
        await Content.updateOne(
            { type: type },
            { $push: { data: content } },
            { upsert: true } // Creates the document if it doesn't exist
        );
        res.json({ success: true, message: `System Content for ${type} Updated` });

    } catch (error) {
        console.error("Content Update Error:", error);
        res.status(500).json({ success: false, error: "Server error during content update." });
    }
});

// FRAUD DETECT (Simple Check)
app.get('/api/admin/fraud-check', async (req, res) => {
    try {
        const suspicious = await Member.find({ points: { $gt: 50000 }, digital_wallet: 0 }).lean();
        res.json({ 
            success: true, 
            total_members: await Member.countDocuments(),
            suspicious_count: suspicious.length, 
            details: suspicious 
        });
    } catch (error) {
        console.error("Fraud Check Error:", error);
        res.status(500).json({ success: false, error: "Server error during fraud check." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ===========================================
    THE GROOVE VIG - CORE ENGINE LIVE (MongoDB)
    ===========================================
    PORT: ${PORT}
    STATUS: ALL SYSTEMS OPERATIONAL
    COLOR THEME: BLACK, PURPLE, GOLD
    ===========================================
    `);
});