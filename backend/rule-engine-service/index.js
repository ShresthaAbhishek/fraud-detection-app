const express = require("express");
const redis = require("redis");

const app = express();
const PORT = process.env.PORT || 3001;

const REDIS_URL = process.env.REDIS_URL || "redis://:caremember@localhost:6379";

const redisClient = redis.createClient({ url: REDIS_URL });
redisClient.on("error", (err) => console.error("❌ Redis error in Rule Engine:", err));
redisClient.connect();

app.use(express.json());

// Health Check
app.get("/health", (req, res) => res.status(200).json({ status: "UP", service: "Rule Engine" }));

// Rule Engine Endpoint
app.post("/api/v1/rule/verdict", async (req, res) => {
  const { userId, amount, location } = req.body;
  const timestamp = new Date().toISOString();
  let isFraud = false;
  let reason = null;

  // Rule 1: Large transaction
  if (amount > 10000) {
    isFraud = true;
    reason = "Large Transaction Detected";
  }

  // Rule 2: High frequency (5 in < 60 seconds)
  const tsKey = `user:${userId}:transactionTimeStamps`;
  await redisClient.lPush(tsKey, timestamp);
  await redisClient.lTrim(tsKey, 0, 4);

  const lastTimestamps = (await redisClient.lRange(tsKey, 0, -1)).map(t => new Date(t).getTime());

  if (lastTimestamps.length >= 5) {
    const diff = lastTimestamps[0] - lastTimestamps[lastTimestamps.length - 1];
    if (diff < 60_000) {
      isFraud = true;
      reason = reason ? `${reason} and High Frequency Transactions Detected` : "High Frequency Transactions Detected";
    }
  }

  // Rule 3: Location change
  const locKey = `user:${userId}:location`;
  const lastLocation = await redisClient.get(locKey);
  
  if (lastLocation && lastLocation !== location) {
    isFraud = true;
    reason = reason ? `${reason} and Unusual Location Change Detected` : "Unusual Location Change Detected";
  }
  await redisClient.set(locKey, location);

  res.status(200).json({ is_fraud_rule: isFraud, reason });
});

app.listen(PORT, () => console.log(`🚀 Rule Engine service running on port ${PORT}`));