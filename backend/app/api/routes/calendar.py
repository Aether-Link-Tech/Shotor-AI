from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db import get_db
from app.models import User, GoogleConnection
from app.security import get_current_user
from app.services.google import calendar_events
from fastapi import HTTPException
router=APIRouter(prefix="/google/calendar",tags=["Google Calendar"])
@router.get("/events")
async def events(limit_count:int=Query(default=30,ge=1,le=100),user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    c=db.scalar(select(GoogleConnection).where(GoogleConnection.user_id==user.id))
    if not c: raise HTTPException(409,"Connect a Google account first")
    return {"events":await calendar_events(c,limit_count)}
@router.get("/reminders")
async def reminders(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    c=db.scalar(select(GoogleConnection).where(GoogleConnection.user_id==user.id))
    if not c: raise HTTPException(409,"Connect a Google account first")
    return {"events":await calendar_events(c,100),"minutes_before":30}
