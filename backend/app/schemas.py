from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Literal
import re

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    full_name: str = Field(default="", max_length=120)
    @field_validator("password")
    @classmethod
    def not_blank(cls, value):
        if not value.strip(): raise ValueError("Password cannot be blank")
        return value

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class UserResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

class DocumentResponse(BaseModel):
    id: str
    original_filename: str
    content_type: str
    summary: str | None
    created_at: str

class SummaryResponse(BaseModel):
    document_id: str
    summary: str
    model: str

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)

class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=6000)
    # Earlier turns of the conversation, oldest first. The server keeps only the most recent part (see assistant route).
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)

class AssistantResponse(BaseModel):
    answer: str
    model: str

class ReplyDraftRequest(BaseModel):
    message_id: str = Field(min_length=1, max_length=200)
    instructions: str = Field(default="Write a polite, concise reply.", max_length=2000)
    @field_validator("message_id")
    @classmethod
    def safe_message_id(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value): raise ValueError("Invalid Gmail message ID")
        return value

class EmailDraftResponse(BaseModel):
    draft_id: str
    recipient: str
    subject: str
    body: str
    expires_at: str

class SendEmailRequest(BaseModel):
    draft_id: str
    recipient: EmailStr
    subject: str = Field(max_length=998)
    body: str = Field(min_length=1, max_length=10000)
    confirm_send: bool
    @field_validator("subject")
    @classmethod
    def safe_subject(cls, value):
        if "\r" in value or "\n" in value: raise ValueError("Subject must not contain line breaks")
        return value

class CalendarEventResponse(BaseModel):
    id: str
    summary: str
    start: str
    end: str
    location: str | None = None
    html_link: str | None = None

class AccountDeleteRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
