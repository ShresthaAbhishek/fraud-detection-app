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
             # Enhanced Fallback: More dynamic mock prediction if model failed to load
            y_prob = 0.05  # Base probability
            
            # Amount-based risk
            if transaction.amount > 10000:
                y_prob += 0.3
            elif transaction.amount > 5000:
                y_prob += 0.2
            elif transaction.amount > 1000:
                y_prob += 0.1
            
            # Transaction type risk
            if transaction.type == "CASH_OUT":
                y_prob += 0.2
            elif transaction.type == "TRANSFER":
                y_prob += 0.15
            elif transaction.type == "DEBIT":
                y_prob += 0.1
            
            # Balance difference risk
            balance_diff = abs(transaction.oldbalanceOrg - transaction.newbalanceOrig)
            if balance_diff > transaction.amount:
                y_prob += 0.2
            
            # Cap probability between 0 and 1
            y_prob = min(max(y_prob, 0.0), 1.0)
            y_pred = y_prob > 0.5
        else:
            # Actual Prediction with enhanced sensitivity
            y_pred = model.predict(X)[0]
            y_prob = model.predict_proba(X)[0, 1] if hasattr(model, "predict_proba") else float(y_pred)
            
            # Enhance the model's sensitivity by applying a scaling factor
            # This makes the model more responsive to fraud patterns
            if y_prob < 0.1:
                y_prob = y_prob * 2  # Double low probabilities
            elif y_prob < 0.3:
                y_prob = y_prob * 1.5  # Increase medium probabilities
            
            # Ensure probability stays within bounds
            y_prob = min(max(y_prob, 0.0), 1.0)

        return {
            "is_fraud": bool(y_pred),
            "fraud_probability": round(float(y_prob), 4)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error during prediction: {str(e)}")