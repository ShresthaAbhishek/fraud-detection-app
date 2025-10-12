# Use an official Python runtime as the base image
FROM python:3.10-slim

# Set the working directory
WORKDIR /app

# Copy requirements.txt and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create the model directory and copy the model file
RUN mkdir -p model
# NOTE: Ensure you place your fraud_model.pkl in the ml-model-service/model/ directory
COPY /model/fraud_model.pkl model/

# Copy the application code
COPY app.py .

# Expose the port the app runs on
EXPOSE 8000

# Command to run the application using uvicorn
# The command starts the app defined in app.py:app on port 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]