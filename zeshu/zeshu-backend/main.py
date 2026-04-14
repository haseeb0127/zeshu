from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import os
from dotenv import load_dotenv

# Load secrets from the .env file
load_dotenv()

app = FastAPI(title="Zeshu API")

# Allow mobile app and website to talk to this server securely
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

A1_USERNAME = os.getenv("A1_USERNAME")
A1_PASSWORD = os.getenv("A1_PASSWORD")

# Define the exact data we expect to receive from the React Native app
class RechargeRequest(BaseModel):
    operator_code: str
    number: str
    amount: int
    order_id: str
    dob: str = None # Optional, for insurance

@app.get("/")
def read_root():
    return {"status": "online", "message": "Zeshu Backend is running securely!"}

@app.post("/api/recharge")
def process_recharge(req: RechargeRequest):
    """
    Securely calls A1Topup without ever exposing the password to the mobile app.
    """
    # 13 is the circle code for AP/Telangana
    url = f"https://business.a1topup.com/recharge/api?username={A1_USERNAME}&pwd={A1_PASSWORD}&circlecode=13&operatorcode={req.operator_code}&number={req.number}&amount={req.amount}&orderid={req.order_id}&format=json"
    
    if req.dob:
        url += f"&value1={req.dob}"
        
    try:
        response = requests.get(url)
        data = response.json()
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))