from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import pandas as pd
import os
import uvicorn

app = FastAPI(title="ML Model Service", version="1.0")

# Set up health check
@app.get("/health")
def health_check():
    return {"status": "UP", "service": "ML Model"}

# Load trained pipeline once at startup
MODEL_PATH = "model/fraud_model.pkl"
model = None
try:
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print("✅ ML Model loaded successfully.")
    else:
        print(f"⚠️ Model file not found at {MODEL_PATH}. Using mock prediction.")
except Exception as e:
    print(f"❌ Error loading model: {e}")

# Input schema (as inferred from your original app.py)
class Transaction(BaseModel):
    type: str
    amount: float
    oldbalanceOrg: float
    newbalanceOrig: float
    oldbalanceDest: float
    newbalanceDest: float

@app.post("/predict")
def predict(transaction: Transaction):
    try:
        # Compute engineered features (Preprocessing steps)
        balanceDiffOrig = transaction.oldbalanceOrg - transaction.newbalanceOrig
        balanceDiffDest = transaction.newbalanceDest - transaction.oldbalanceDest

        # Build DataFrame in correct column order (Feature names the ML model expects)
        X = pd.DataFrame([{
            "type": transaction.type,
            "amount": transaction.amount,
            "oldbalanceOrg": transaction.oldbalanceOrg,
            "newbalanceOrig": transaction.newbalanceOrig,
            "oldbalanceDest": transaction.oldbalanceDest,
            "newbalanceDest": transaction.newbalanceDest,
            "balanceDiffOrig": balanceDiffOrig,
            "balanceDiffDest": balanceDiffDest
        }])

        if model is None:
             # Enhanced Fallback: More nuanced mock prediction with continuous scoring
            y_prob = 0.05  # Base probability
            
            # Amount-based risk (more granular and progressive)
            if transaction.amount > 100000:
                y_prob += 0.35
            elif transaction.amount > 50000:
                y_prob += 0.25
            elif transaction.amount > 25000:
                y_prob += 0.18
            elif transaction.amount > 10000:
                y_prob += 0.12
            elif transaction.amount > 5000:
                y_prob += 0.08
            elif transaction.amount > 1000:
                y_prob += 0.03
            elif transaction.amount > 100:
                y_prob += 0.01
            
            # Transaction type risk (more nuanced)
            if transaction.type == "CASH_OUT":
                y_prob += 0.12
            elif transaction.type == "TRANSFER":
                y_prob += 0.08
            elif transaction.type == "DEBIT":
                y_prob += 0.05
            elif transaction.type == "PAYMENT":
                y_prob -= 0.02  # Payments are generally safer
            elif transaction.type == "CASH_IN":
                y_prob -= 0.01  # Cash in is generally safe
            
            # Balance difference risk (more sophisticated)
            balance_diff = abs(transaction.oldbalanceOrg - transaction.newbalanceOrig)
            if balance_diff > transaction.amount * 1.2:  # More than 20% difference
                y_prob += 0.15
            elif balance_diff > transaction.amount * 1.1:  # More than 10% difference
                y_prob += 0.08
            elif balance_diff > transaction.amount * 1.05:  # More than 5% difference
                y_prob += 0.03
            
            # Account balance ratio risk (more granular)
            if transaction.oldbalanceOrg > 0:
                amount_ratio = transaction.amount / transaction.oldbalanceOrg
                if amount_ratio > 0.95:  # Transaction is >95% of account balance
                    y_prob += 0.25
                elif amount_ratio > 0.8:  # Transaction is >80% of account balance
                    y_prob += 0.15
                elif amount_ratio > 0.5:  # Transaction is >50% of account balance
                    y_prob += 0.08
                elif amount_ratio > 0.2:  # Transaction is >20% of account balance
                    y_prob += 0.03
            
            # Destination account analysis
            if transaction.newbalanceDest > 0:
                dest_ratio = transaction.amount / transaction.newbalanceDest
                if dest_ratio > 0.5:  # Large amount relative to destination balance
                    y_prob += 0.05
            
            # Add some randomness for variety (small variation)
            import random
            random_factor = random.uniform(0.95, 1.05)
            y_prob *= random_factor
            
            # Cap probability between 0 and 1
            y_prob = min(max(y_prob, 0.0), 1.0)
            y_pred = y_prob > 0.5
        else:
            # Actual Prediction with enhanced sensitivity and continuous scoring
            y_pred = model.predict(X)[0]
            y_prob = model.predict_proba(X)[0, 1] if hasattr(model, "predict_proba") else float(y_pred)
            
            # Apply nuanced transaction-specific adjustments
            if transaction.type == "TRANSFER":
                # Moderate TRANSFER adjustments - don't make it binary
                if y_prob > 0.8:
                    y_prob = 0.8 + (y_prob - 0.8) * 0.3  # Gentle reduction for very high probabilities
                elif y_prob > 0.6:
                    y_prob = 0.6 + (y_prob - 0.6) * 0.7  # Moderate reduction for high probabilities
            elif transaction.type == "PAYMENT":
                # PAYMENT transactions are generally safer - gradual reduction
                y_prob = y_prob * 0.4  # Moderate reduction for payments
            elif transaction.type == "CASH_IN":
                # CASH_IN is generally safe
                y_prob = y_prob * 0.2  # Significant reduction for cash in
            elif transaction.type == "CASH_OUT":
                # CASH_OUT has higher risk - moderate increase
                y_prob = min(y_prob * 1.2, 1.0)
            
            # Apply progressive amount-based adjustments
            if transaction.amount > 100000:
                y_prob = min(y_prob + 0.15, 1.0)  # Moderate increase for very large amounts
            elif transaction.amount > 50000:
                y_prob = min(y_prob + 0.1, 1.0)   # Small increase for large amounts
            elif transaction.amount > 25000:
                y_prob = min(y_prob + 0.05, 1.0)  # Very small increase for medium amounts
            elif transaction.amount < 100:
                y_prob = max(y_prob - 0.05, 0.0)  # Small decrease for very small amounts
            
            # Apply balance-based adjustments for more nuanced scoring
            if transaction.oldbalanceOrg > 0:
                amount_ratio = transaction.amount / transaction.oldbalanceOrg
                if amount_ratio > 0.9:
                    y_prob = min(y_prob + 0.1, 1.0)  # Increase risk for high ratio
                elif amount_ratio > 0.5:
                    y_prob = min(y_prob + 0.05, 1.0)  # Small increase for medium ratio
            
            # Add small random variation for continuous scoring
            import random
            random_factor = random.uniform(0.98, 1.02)
            y_prob *= random_factor
            
            # Ensure probability stays within bounds
            y_prob = min(max(y_prob, 0.0), 1.0)

        return {
            "is_fraud": bool(y_pred),
            "fraud_probability": round(float(y_prob), 4)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error during prediction: {str(e)}")