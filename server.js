const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors());
app.use(express.json());

// In-Memory Database Fallback System
let isUsingFallback = false;
let fallbackDb = {
  users: [],
  reports: [
    // Chennai
    {
      id: "SR-9041",
      type: "Pothole",
      severity: "85%",
      coords: [13.0822, 80.2755],
      landmark: "Near Chennai Central Metro Station, Chennai",
      status: "pending",
      visual: "pothole1",
      timestamp: new Date()
    },
    {
      id: "SR-3304",
      type: "Waterlogging",
      severity: "60%",
      coords: [13.0425, 80.2560],
      landmark: "Opposite Express Avenue Mall, Mount Road, Chennai",
      status: "assigned",
      visual: "pothole1",
      timestamp: new Date()
    },
    {
      id: "SR-1102",
      type: "Broken Signal",
      severity: "95%",
      coords: [13.0067, 80.2206],
      landmark: "Kathipara Junction Roundabout, Guindy, Chennai",
      status: "resolved",
      visual: "pothole1",
      timestamp: new Date()
    },
    // Coimbatore
    {
      id: "SR-7730",
      type: "Pothole",
      severity: "78%",
      coords: [11.0242, 76.9944],
      landmark: "Avinashi Road near Hope College Flyover, Coimbatore",
      status: "pending",
      visual: "pothole1",
      timestamp: new Date()
    },
    {
      id: "SR-7731",
      type: "Road Crack",
      severity: "45%",
      coords: [11.0181, 76.9634],
      landmark: "Gandhipuram Signal Crossing, Coimbatore",
      status: "assigned",
      visual: "crack1",
      timestamp: new Date()
    },
    // Madurai
    {
      id: "SR-5520",
      type: "Pothole",
      severity: "92%",
      coords: [9.9205, 78.1132],
      landmark: "West Veli Street near Madurai Junction, Madurai",
      status: "pending",
      visual: "pothole1",
      timestamp: new Date()
    },
    {
      id: "SR-5521",
      type: "Waterlogging",
      severity: "70%",
      coords: [9.9320, 78.0955],
      landmark: "Kalavasal Junction, Theni Road, Madurai",
      status: "pending",
      visual: "pothole1",
      timestamp: new Date()
    },
    // Trichy
    {
      id: "SR-4410",
      type: "Pothole",
      severity: "88%",
      coords: [10.8062, 78.6872],
      landmark: "Thillai Nagar Main Road near 10th Cross, Trichy",
      status: "pending",
      visual: "pothole1",
      timestamp: new Date()
    },
    {
      id: "SR-4411",
      type: "Broken Signal",
      severity: "80%",
      coords: [10.7854, 78.6980],
      landmark: "Cantonment Road near Central Bus Stand, Trichy",
      status: "assigned",
      visual: "pothole1",
      timestamp: new Date()
    },
    // Salem
    {
      id: "SR-3310",
      type: "Pothole",
      severity: "64%",
      coords: [11.6738, 78.1275],
      landmark: "Five Roads Junction, Salem",
      status: "pending",
      visual: "pothole1",
      timestamp: new Date()
    },
    {
      id: "SR-3311",
      type: "Road Crack",
      severity: "52%",
      coords: [11.6610, 78.1522],
      landmark: "Salem Junction Road near New Bus Stand, Salem",
      status: "resolved",
      visual: "crack1",
      timestamp: new Date()
    },
    // Tirunelveli
    {
      id: "SR-2210",
      type: "Pothole",
      severity: "82%",
      coords: [8.7285, 77.7490],
      landmark: "Vannarpettai Bypass Road, Tirunelveli",
      status: "pending",
      visual: "pothole1",
      timestamp: new Date()
    }
  ]
};

// Define Mongoose Schemas & Models
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['citizen', 'admin'], default: 'citizen' },
  safetyScore: { type: Number, default: 85 },
  rewardPoints: { type: Number, default: 0 }
});

const ReportSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  severity: { type: String, required: true },
  coords: { type: [Number], required: true }, // [lat, lng]
  landmark: { type: String, required: true },
  status: { type: String, enum: ['pending', 'assigned', 'resolved'], default: 'pending' },
  visual: { type: String, default: 'pothole1' },
  timestamp: { type: Date, default: Date.now },
  reportedBy: { type: String }
});

let User, Report;

// Connect to MongoDB with timeout handling
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 4000 // 4 seconds timeout
})
.then(() => {
  console.log("🚀 Successful Connection to MongoDB!");
  User = mongoose.model('User', UserSchema);
  Report = mongoose.model('Report', ReportSchema);
  seedDatabase();
})
.catch((err) => {
  console.error("⚠️ MongoDB connection failed. Entering Resilient Offline Fallback Mode:", err.message);
  isUsingFallback = true;
  setupFallbackModels();
});

// Setup mock DB functions if Atlas/Local Mongo is offline
function setupFallbackModels() {
  console.log("ℹ️ Server running with Local In-Memory Fallback Data storage.");
  // Add a default admin credentials in fallback database
  bcrypt.hash("admin", 10).then(hashedPassword => {
    fallbackDb.users.push({
      username: "admin",
      password: hashedPassword,
      role: "admin",
      safetyScore: 100,
      rewardPoints: 1000
    });
  });
  // Add a default citizen
  bcrypt.hash("123", 10).then(hashedPassword => {
    fallbackDb.users.push({
      username: "dharun",
      password: hashedPassword,
      role: "citizen",
      safetyScore: 85,
      rewardPoints: 720
    });
  });
}

// Seed MongoDB with initial Tamil Nadu/Chennai hazards if empty
async function seedDatabase() {
  try {
    // Drop existing seed reports to populate multi-city records
    await Report.deleteMany({});
    await Report.insertMany(fallbackDb.reports);
    console.log("📦 Seeded initial Tamil Nadu reports to MongoDB Atlas.");

    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount === 0) {
      const adminPass = await bcrypt.hash("admin", 10);
      await User.create({
        username: "admin",
        password: adminPass,
        role: "admin",
        safetyScore: 100,
        rewardPoints: 1000
      });
      // Also seed citizen dharun
      const userPass = await bcrypt.hash("123", 10);
      await User.create({
        username: "dharun",
        password: userPass,
        role: "citizen",
        safetyScore: 85,
        rewardPoints: 720
      });
      console.log("👥 Seeded default credentials (admin/admin, dharun/123) to MongoDB.");
    }
  } catch (error) {
    console.error("Error seeding MongoDB:", error);
  }
}


/* ==========================================
   API ENDPOINTS
   ========================================== */

// 1. Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    if (isUsingFallback) {
      const exists = fallbackDb.users.some(u => u.username === username);
      if (exists) return res.status(400).json({ error: "Username already exists" });

      const newUser = {
        username,
        password: passwordHash,
        role: role || 'citizen',
        safetyScore: 85,
        rewardPoints: 0
      };
      fallbackDb.users.push(newUser);
      return res.status(201).json({ message: "Registration successful", user: { username, role: newUser.role, safetyScore: 85, rewardPoints: 0 } });
    } else {
      const exists = await User.findOne({ username });
      if (exists) return res.status(400).json({ error: "Username already exists" });

      const newUser = await User.create({
        username,
        password: passwordHash,
        role: role || 'citizen'
      });
      return res.status(201).json({ message: "Registration successful", user: { username, role: newUser.role, safetyScore: newUser.safetyScore, rewardPoints: newUser.rewardPoints } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (isUsingFallback) {
      const user = fallbackDb.users.find(u => u.username === username);
      if (!user) return res.status(400).json({ error: "Invalid username or password" });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(400).json({ error: "Invalid username or password" });

      return res.json({
        message: "Login successful",
        user: {
          username: user.username,
          role: user.role,
          safetyScore: user.safetyScore,
          rewardPoints: user.rewardPoints
        }
      });
    } else {
      const user = await User.findOne({ username });
      if (!user) return res.status(400).json({ error: "Invalid username or password" });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(400).json({ error: "Invalid username or password" });

      return res.json({
        message: "Login successful",
        user: {
          username: user.username,
          role: user.role,
          safetyScore: user.safetyScore,
          rewardPoints: user.rewardPoints
        }
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Fetch All Reports
app.get('/api/reports', async (req, res) => {
  try {
    if (isUsingFallback) {
      return res.json(fallbackDb.reports);
    } else {
      const reports = await Report.find().sort({ timestamp: -1 });
      return res.json(reports);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Create New Report
app.post('/api/reports', async (req, res) => {
  try {
    const reportData = req.body;
    
    // Auto-generate ID if missing
    if (!reportData.id) {
      reportData.id = "SR-" + Math.floor(1000 + Math.random() * 9000);
    }

    if (isUsingFallback) {
      const newReport = {
        id: reportData.id,
        type: reportData.type,
        severity: reportData.severity || "50%",
        coords: reportData.coords,
        landmark: reportData.landmark,
        status: reportData.status || "pending",
        visual: reportData.visual || "pothole1",
        timestamp: new Date(),
        reportedBy: reportData.reportedBy
      };
      fallbackDb.reports.unshift(newReport);
      return res.status(201).json(newReport);
    } else {
      const newReport = await Report.create(reportData);
      return res.status(201).json(newReport);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Update Report Status
app.patch('/api/reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (isUsingFallback) {
      const idx = fallbackDb.reports.findIndex(r => r.id === id);
      if (idx === -1) return res.status(404).json({ error: "Report not found" });

      fallbackDb.reports[idx].status = status;
      return res.json(fallbackDb.reports[idx]);
    } else {
      const updated = await Report.findOneAndUpdate({ id }, { status }, { new: true });
      if (!updated) return res.status(404).json({ error: "Report not found" });
      return res.json(updated);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server Initialization
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🌐 Express API Server running on port ${PORT}`);
  });
}

module.exports = app;
