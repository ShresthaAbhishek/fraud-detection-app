🛡️ Hybrid Fraud Detection Engine
=================================

Project Overview
----------------

This project implements a scalable, real-time fraud detection system utilizing a modern microservice architecture. The core innovation is the **Hybrid Aggregator**, which combines deterministic **Rule-Based Logic** with probabilistic **Machine Learning (ML) Inference** to produce a unified, high-confidence fraud verdict. The application is entirely containerized using Docker and is split across multiple technologies (Node.js and Python) to maximize performance and flexibility.

The frontend features a modern, dark-themed Next.js UI with a custom mobile device mock to visualize the transaction outcome in real-time.

🚀 Architectural Highlights & Core Technologies
-----------------------------------------------

This project demonstrates proficiency across the full stack, from scalable microservice design to frontend state management.

### Backend (Microservices)

Service

Technology

Role & Expertise Demonstrated

**Aggregator Service**

Node.js (Express)

**API Gateway, Orchestration, Authentication, Hybrid Logic.** Implements **Rule Override Logic** to prioritize deterministic fraud rules over the ML score, ensuring critical security breaches are never missed.

**Rule Engine Service**

Node.js (Express)

**Stateful Service Design.** Implements velocity checks (high frequency) and geographic anomaly detection using **Redis** for maintaining user history and state.

**ML Model Service**

Python (FastAPI)

**MLOps & Real-Time Inference.** Loads a pre-trained fraud\_model.pkl (sklearn pipeline) at startup and exposes a dedicated /predict endpoint for low-latency inference.

**Containerization**

Docker, Docker Compose

**Reproducible Environment.** Manages environment variables, port mapping, service dependencies, and ensures consistent versioning (e.g., pinning scikit-learn==1.6.1 to resolve dependency conflicts).

### Frontend (User Interface)

Feature

Technology

Expertise Demonstrated

**Application**

Next.js (App Router)

**Modern Web Development, Full-Stack Integration.** Efficient component structure and client-side data handling.

**UI/UX**

Tailwind CSS, Shadcn/ui

**Sleek, Responsive Design.** Implements a Dark Theme with sky-blue accents and a custom iPhone 15 Pro device mock for visual output context.

**Networking**

Next.js Rewrites/Proxy

**CORS & Port Management.** Uses Next.js proxy feature to route client-side API requests seamlessly from the frontend port (e.g., 3002) to the Docker backend port (3000), resolving common cross-origin issues.

⚙️ How to Run the Application Locally
-------------------------------------

This project requires **Docker** and **Node.js/npm** to be installed on your system.

### 1\. Prerequisites

*   Docker / Docker Compose
    
*   Node.js (for the Next.js frontend)
    

### 2\. Setup and Execution

1.  git clone \[YOUR\_REPO\_URL\]cd fraud
    
2.  docker compose up --build -d_(This starts the Redis DB, ML Model, Rule Engine, and Aggregator on host ports 6379, 8000, 3001, and_ _**3000**_ _respectively)._
    
3.  cd frontendnpm installnpm run dev -- -p 3002
    

### 3\. Access

Open your web browser to: **http://localhost:3002**

### 4\. Testing & Authentication

The frontend automatically injects the required API Key in the X-API-KEY header.

*   **API Key:** 9898
    
*   **Low-Risk Test (Expected: APPROVED):** Use a low amount (e.g., 100).
    
*   **High-Risk Test (Expected: BLOCKED):** Use a high amount (e.g., 100001) to trigger the **Rule Override**.
