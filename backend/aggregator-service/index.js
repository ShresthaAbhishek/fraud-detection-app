const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");
const { createLogger, format, transports } = require('winston');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const RULE_ENGINE_URL = process.env.RULE_ENGINE_URL || "http://rule-engine-service:3001";
const ML_MODEL_URL = process.env.ML_MODEL_URL || "http://ml-model-service:8000";

// --- Observability: Logging with Correlation IDs ---
const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), format.errors({ stack: true }), format.splat(), format.json()),
  transports: [new transports.Console({ format: format.combine(format.colorize(), format.simple()) })],
});

// Middleware for Correlation ID and Logging
const correlationIdMiddleware = (req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    req.correlationId = correlationId;
    res.set('X-Correlation-ID', correlationId);
    logger.info(`[${correlationId}] Incoming request: ${req.method} ${req.originalUrl}`);
    next();
};

// CORS configuration - Must be first
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'X-API-Key', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use(correlationIdMiddleware);

// --- Security: Simple API Key Authentication Mock ---
const authMiddleware = (req, res, next) => {
    // API_KEY must be loaded from the environment
    const API_KEY = process.env.API_KEY; 
    const providedKey = req.headers['x-api-key'];
    const correlationId = req.correlationId || 'N/A';

    // A check to see if the environment variable itself is missing (should not happen in Docker Compose)
    if (!API_KEY) {
        logger.error(`[${correlationId}] Configuration Error: API_KEY is missing in environment!`);
        return res.status(500).json({ error: "Server Configuration Error" });
    }

    // This is the line that's failing, meaning API_KEY is still the old value inside the container
    if (!providedKey || providedKey !== API_KEY) {
        // Log the actual key being used for debugging!
        logger.warn(`[${correlationId}] Auth Failure. Expected prefix: ${API_KEY.substring(0, 2)}, Provided key: ${providedKey}`);
        return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }
    
    next();
};


// --- Enhanced Hybrid Decision Logic with Nuanced Scoring ---
function computeHybridScore(isRuleFraud, mlProbability, ruleFraudScore = 0) {
  // Convert rule fraud score (0-100) to probability (0-1)
  const ruleProbability = Math.min(ruleFraudScore / 100, 1.0);
  
  // Weighted combination of ML and Rule probabilities
  const weightML = 0.7;  // ML gets more weight for nuanced scoring
  const weightRule = 0.3; // Rule engine provides additional context
  
  // Base hybrid score from weighted combination
  let hybridScore = weightML * mlProbability + weightRule * ruleProbability;
  
  // Simplified scoring - no boosts, just weighted combination
  
  // Ensure score stays within bounds
  hybridScore = Math.max(0.0, Math.min(1.0, hybridScore));
  
  // Add small random variation for nuanced scoring
  const randomVariation = (Math.random() - 0.5) * 0.02;
  hybridScore = Math.max(0.0, Math.min(1.0, hybridScore + randomVariation));
  
  return hybridScore;
}

// --- Main API Endpoint with Validation, Timeout, and Retry/Fallback ---
app.get("/health", (req, res) => res.status(200).json({ status: "UP", service: "Aggregator" }));

app.post("/api/v1/verdict", authMiddleware, (req, res, next) => {
    // Basic Input Validation Example
    const required = ["userId", "amount", "location", "type", "oldbalanceOrg", "newbalanceOrig"];
    for (const field of required) {
        if (!req.body[field]) return res.status(400).json({ error: `Missing required field: ${field}` });
    }
    next();
}, async (req, res) => {
  const transaction = req.body;
  const { userId, amount, location, type, oldbalanceOrg, newbalanceOrig, oldbalanceDest, newbalanceDest } = transaction;
  const correlationId = req.correlationId;

  const ruleData = { userId, amount, location, timestamp: new Date().toISOString() };
  const mlData = { type, amount, oldbalanceOrg, newbalanceOrig, oldbalanceDest, newbalanceDest };
  
  try {
    // Concurrently call both microservices with a 1000ms timeout
    const [ruleResponse, mlResponse] = await Promise.allSettled([
        axios.post(`${RULE_ENGINE_URL}/api/v1/rule/verdict`, ruleData, { timeout: 1000 }),
        axios.post(`${ML_MODEL_URL}/predict`, mlData, { timeout: 1000 })
    ]);

    // Process Rule Verdict (Fallback: Default to Not Fraud if service fails or times out)
    let ruleVerdict = false;
    let ruleReason = null;
    let fraudScore = 0;
    let riskLevel = "LOW";
    
    if (ruleResponse.status === 'fulfilled' && ruleResponse.value.data.is_fraud_rule !== undefined) {
      ruleVerdict = ruleResponse.value.data.is_fraud_rule;
      ruleReason = ruleResponse.value.data.reason;
      fraudScore = ruleResponse.value.data.fraud_score || 0;
      riskLevel = ruleResponse.value.data.risk_level || "LOW";
    } else {
        logger.error(`[${correlationId}] Rule Engine failed. Defaulting to Not Fraud.`);
    }

    // Process ML Verdict (Fallback: Default to 0 probability if service fails or times out)
    let mlProbability = 0;
    if (mlResponse.status === 'fulfilled' && mlResponse.value.data.fraud_probability !== undefined) {
      mlProbability = mlResponse.value.data.fraud_probability;
    } else {
        logger.error(`[${correlationId}] ML Model failed. Defaulting to 0 probability.`);
    }

    // Compute Hybrid Score with rule fraud score
    const hybridScore = computeHybridScore(ruleVerdict, mlProbability, fraudScore);
    const finalVerdict = hybridScore > 0.5 ? "Fraud" : "Not Fraud";
    
    res.status(200).json({
      verdict: finalVerdict,
      rule_verdict: ruleVerdict,
      ml_probability: mlProbability,
      hybrid_score: hybridScore,
      fraud_score: fraudScore,
      risk_level: riskLevel,
      reason: ruleVerdict ? ruleReason : (finalVerdict === 'Fraud' ? "High ML Probability" : null),
      confidence: Math.abs(hybridScore - 0.5) * 2 // Confidence level based on distance from threshold
    });

  } catch (error) {
    logger.error(`[${correlationId}] Unhandled internal error: ${error.message}`);
    res.status(500).json({ error: "Internal Server Error during fraud analysis." });
  }
});

app.listen(PORT, () => logger.info(`🚀 Aggregator service running on port ${PORT}`));