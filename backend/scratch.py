from supabase import create_client
import os
import requests
from dotenv import load_dotenv

load_dotenv()

# We can directly invoke the python endpoint logic since we are in the backend folder
from main import get_explanation

try:
    res = get_explanation("5f84bb00-bd69-4520-9c56-67df2a60c82f", _current_user={"uid": "test", "premium": True})
    print(f"Result: {res}")
except Exception as e:
    print(f"Error: {e}")

