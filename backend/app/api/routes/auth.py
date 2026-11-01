from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import select
import jwt
from app.db import get_db
from app.models import User, UserSession
from app.schemas import RegisterRequest, LoginRequest, TokenResponse, UserResponse
from app.security import hash_password, verify_password, create_session, get_current_user, bearer
from app.core.config import settings
from app.limiter import limit

router=APIRouter(prefix="/auth", tags=["Authentication"])
def user_dto(user): return UserResponse(id=user.id,email=user.email,full_name=user.full_name)

@router.post("/register",response_model=TokenResponse,status_code=201)
def register(body:RegisterRequest,request:Request,db:Session=Depends(get_db)):
    limit(request,"register",5,3600)
    email=str(body.email).lower()
    if db.scalar(select(User).where(User.email==email)): raise HTTPException(409,"An account with this email already exists")
    user=User(id=str(uuid4()),email=email,full_name=body.full_name.strip(),password_hash=hash_password(body.password))
    db.add(user); db.commit(); db.refresh(user)
    token,seconds=create_session(db,user)
    return TokenResponse(access_token=token,expires_in=seconds,user=user_dto(user))

@router.post("/login",response_model=TokenResponse)
def login(body:LoginRequest,request:Request,db:Session=Depends(get_db)):
    limit(request,"login",10,300)
    user=db.scalar(select(User).where(User.email==str(body.email).lower()))
    if not user or not verify_password(body.password,user.password_hash): raise HTTPException(401,"Email or password is incorrect")
    token,seconds=create_session(db,user)
    return TokenResponse(access_token=token,expires_in=seconds,user=user_dto(user))

@router.get("/me",response_model=UserResponse)
def me(user:User=Depends(get_current_user)): return user_dto(user)

@router.post("/logout",status_code=204)
def logout(credentials:HTTPAuthorizationCredentials|None=Depends(bearer),user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    payload=jwt.decode(credentials.credentials,settings.secret_key,algorithms=["HS256"])
    session=db.get(UserSession,payload["sid"])
    if session: session.revoked_at=datetime.now(timezone.utc); db.commit()
    return None
