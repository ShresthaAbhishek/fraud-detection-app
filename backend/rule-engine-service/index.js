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
  let fraudScore = 0;

  // Rule 1: Progressive transaction amount thresholds with nuanced scoring
  if (amount > 100000) {
    fraudScore += 85;
    reason = "Very Large Transaction Detected (>$100K)";
  } else if (amount > 50000) {
    fraudScore += 70;
    reason = "Large Transaction Detected (>$50K)";
  } else if (amount > 25000) {
    fraudScore += 50;
    reason = reason ? `${reason} and Moderate Large Transaction (>$25K)` : "Moderate Large Transaction (>$25K)";
  } else if (amount > 10000) {
    fraudScore += 35;
    reason = reason ? `${reason} and Medium Transaction (>$10K)` : "Medium Transaction (>$10K)";
  } else if (amount > 5000) {
    fraudScore += 20;
    reason = reason ? `${reason} and Elevated Transaction (>$5K)` : "Elevated Transaction (>$5K)";
  } else if (amount > 1000) {
    fraudScore += 10;
  } else if (amount > 100) {
    fraudScore += 5;
  }
  
  // Only flag as fraud if score reaches threshold
  if (fraudScore >= 60) {
    isFraud = true;
  }

  // Rule 2: High frequency transactions (enhanced)
  const tsKey = `user:${userId}:transactionTimeStamps`;
  const amountKey = `user:${userId}:transactionAmounts`;
  
  await redisClient.lPush(tsKey, timestamp);
  await redisClient.lPush(amountKey, amount.toString());
  await redisClient.lTrim(tsKey, 0, 9); // Keep last 10 transactions
  await redisClient.lTrim(amountKey, 0, 9);

  const lastTimestamps = (await redisClient.lRange(tsKey, 0, -1)).map(t => new Date(t).getTime());
  const lastAmounts = (await redisClient.lRange(amountKey, 0, -1)).map(a => parseFloat(a));

  // Check for rapid transactions with nuanced scoring
  if (lastTimestamps.length >= 5) {
    const diff = lastTimestamps[0] - lastTimestamps[lastTimestamps.length - 1];
    if (diff < 30_000) { // Within 30 seconds - very suspicious
      fraudScore += 60;
      reason = reason ? `${reason} and Very High Frequency Transactions` : "Very High Frequency Transactions";
    } else if (diff < 60_000) { // Within 1 minute - suspicious
      fraudScore += 40;
      reason = reason ? `${reason} and High Frequency Transactions` : "High Frequency Transactions";
    } else if (diff < 300_000) { // Within 5 minutes - elevated risk
      fraudScore += 20;
      reason = reason ? `${reason} and Elevated Transaction Frequency` : "Elevated Transaction Frequency";
    }
  }

  // Check for rapid high-value transactions with progressive scoring
  if (lastTimestamps.length >= 3) {
    const recentAmounts = lastAmounts.slice(0, 3);
    const totalRecent = recentAmounts.reduce((sum, amt) => sum + amt, 0);
    const timeDiff = lastTimestamps[0] - lastTimestamps[2];
    
    if (totalRecent > 50000 && timeDiff < 300_000) { // Very high value in 5 minutes
      fraudScore += 50;
      reason = reason ? `${reason} and Very Rapid High-Value Transactions` : "Very Rapid High-Value Transactions";
    } else if (totalRecent > 20000 && timeDiff < 300_000) { // High value in 5 minutes
      fraudScore += 35;
      reason = reason ? `${reason} and Rapid High-Value Transactions` : "Rapid High-Value Transactions";
    } else if (totalRecent > 10000 && timeDiff < 600_000) { // Medium value in 10 minutes
      fraudScore += 20;
      reason = reason ? `${reason} and Elevated Transaction Pattern` : "Elevated Transaction Pattern";
    }
  }

  // Rule 3: Location change (enhanced)
  const locKey = `user:${userId}:location`;
  const lastLocation = await redisClient.get(locKey);
  
  if (lastLocation && lastLocation !== location) {
    // Check if location change is suspicious (same user, different location quickly)
    const locTimeKey = `user:${userId}:locationTime`;
    const lastLocationTime = await redisClient.get(locTimeKey);
    
    if (lastLocationTime) {
      const timeDiff = new Date().getTime() - parseInt(lastLocationTime);
      if (timeDiff < 300000) { // Within 5 minutes - very suspicious
        fraudScore += 45;
        reason = reason ? `${reason} and Very Suspicious Location Change` : "Very Suspicious Location Change";
      } else if (timeDiff < 1800000) { // Within 30 minutes - suspicious
        fraudScore += 30;
        reason = reason ? `${reason} and Suspicious Location Change` : "Suspicious Location Change";
      } else if (timeDiff < 3600000) { // Within 1 hour - elevated risk
        fraudScore += 15;
        reason = reason ? `${reason} and Elevated Location Change Risk` : "Elevated Location Change Risk";
      } else if (timeDiff < 7200000) { // Within 2 hours - minor risk
        fraudScore += 5;
      }
    }
    
    await redisClient.set(locTimeKey, new Date().getTime().toString());
  }
  await redisClient.set(locKey, location);

  // Rule 4: Transaction pattern analysis
  const patternKey = `user:${userId}:pattern`;
  const userPattern = await redisClient.get(patternKey);
  
  if (userPattern) {
    const pattern = JSON.parse(userPattern);
    const avgAmount = pattern.totalAmount / pattern.count;
    
    // Progressive scoring based on deviation from user's average
    if (amount > avgAmount * 5 && amount > 1000) {
      fraudScore += 40;
      reason = reason ? `${reason} and Extremely Unusual Transaction Pattern` : "Extremely Unusual Transaction Pattern";
    } else if (amount > avgAmount * 3 && amount > 1000) {
      fraudScore += 25;
      reason = reason ? `${reason} and Very Unusual Transaction Pattern` : "Very Unusual Transaction Pattern";
    } else if (amount > avgAmount * 2 && amount > 500) {
      fraudScore += 15;
      reason = reason ? `${reason} and Unusual Transaction Pattern` : "Unusual Transaction Pattern";
    } else if (amount > avgAmount * 1.5 && amount > 200) {
      fraudScore += 8;
      reason = reason ? `${reason} and Elevated Transaction Pattern` : "Elevated Transaction Pattern";
    }
  }

  // Update user pattern
  if (userPattern) {
    const pattern = JSON.parse(userPattern);
    pattern.totalAmount += amount;
    pattern.count += 1;
    await redisClient.set(patternKey, JSON.stringify(pattern));
  } else {
    await redisClient.set(patternKey, JSON.stringify({ totalAmount: amount, count: 1 }));
  }

  // Final fraud determination with nuanced thresholds
  if (fraudScore >= 80) {
    isFraud = true;
  } else if (fraudScore >= 60) {
    isFraud = true;
  }
  
  res.status(200).json({ 
    is_fraud_rule: isFraud, 
    reason,
    fraud_score: fraudScore,
    risk_level: fraudScore >= 80 ? "HIGH" : fraudScore >= 50 ? "MEDIUM" : fraudScore >= 20 ? "ELEVATED" : "LOW"
  });
});

app.listen(PORT, () => console.log(`🚀 Rule Engine service running on port ${PORT}`));