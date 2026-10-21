
from uuid import uuid4
import logging
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from langgraph.types import Command
from pydantic import BaseModel, Field, model_validator

from app.graph import report_graph, close_database


app = FastAPI(
    title="Multi-Agent Researcher API",
    description="Generate research reports using AI agents",
    version="0.1.0",
)

default_origins = os.getenv("DEFAULT_ORIGIN")
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        default_origins,
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
def shutdown_event():
    close_database()


# -----------------------------
# Request models
# -----------------------------

class ResearchRequest(BaseModel):
    topic: str = Field(
        min_length=3,
        max_length=200,
        description="Topic to research",
    )


class ReviewRequest(BaseModel):
    thread_id: str = Field(min_length=1)
    approved: bool
    feedback: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def require_feedback_on_rejection(self):
        if not self.approved and not self.feedback.strip():
            raise ValueError(
                "Feedback is required when rejecting a report"
            )
        return self


# -----------------------------
# Helpers
# -----------------------------

def get_thread_config(thread_id: str) -> dict:
    return {
        "configurable": {
            "thread_id": thread_id,
        }
    }


def get_snapshot(thread_id: str):
    snapshot = report_graph.get_state(
        get_thread_config(thread_id)
    )

    if not snapshot.values:
        raise HTTPException(
            status_code=404,
            detail="Research workflow not found",
        )

    return snapshot


def get_status(snapshot) -> str:
    state = snapshot.values

    if state.get("approved", False):
        return "approved"

    if not snapshot.next:
        return "completed"

    if "review" in snapshot.next:
        return "awaiting_review"

    return "in_progress"


# -----------------------------
# Health
# -----------------------------

@app.get("/health")
def health_check():
    return {"status": "ok"}


# -----------------------------
# Start research
# -----------------------------

@app.post("/research")
def start_research(request: ResearchRequest):
    thread_id = str(uuid4())

    result = report_graph.invoke(
        {
            "topic": request.topic,
            "revision_count": 0,
            "max_revisions": 3,
        },
        config=get_thread_config(thread_id),
    )

    if result.get("__interrupt__"):
        interrupt_data = result["__interrupt__"][0].value

        return {
            "thread_id": thread_id,
            "topic": request.topic,
            "status": "awaiting_review",
            "report": interrupt_data.get("report", ""),
            "message": interrupt_data.get(
                "message",
                "Report is waiting for human review.",
            ),
        }

    return {
        "thread_id": thread_id,
        "topic": request.topic,
        "status": get_status(
            report_graph.get_state(
                get_thread_config(thread_id)
            )
        ),
        "report": result.get("report", ""),
        "approved": result.get("approved", False),
    }


# -----------------------------
# Review / resume research
# -----------------------------

@app.post("/research/review")
def review_research(request: ReviewRequest):
    result = report_graph.invoke(
        Command(
            resume={
                "approved": request.approved,
                "feedback": request.feedback,
            }
        ),
        config=get_thread_config(request.thread_id),
    )

    if result.get("__interrupt__"):
        interrupt_data = result["__interrupt__"][0].value

        return {
            "thread_id": request.thread_id,
            "topic": result.get("topic", ""),
            "status": "awaiting_review",
            "report": interrupt_data.get("report", ""),
            "message": interrupt_data.get(
                "message",
                "The revised report is waiting for review.",
            ),
        }

    return {
        "thread_id": request.thread_id,
        "topic": result.get("topic", ""),
        "status": get_status(
            report_graph.get_state(
                get_thread_config(request.thread_id)
            )
        ),
        "report": result.get("report", ""),
        "approved": result.get("approved", False),
    }


# -----------------------------
# Research status
# -----------------------------

@app.get("/research/{thread_id}")
def get_research_status(thread_id: str):
    snapshot = get_snapshot(thread_id)
    state = snapshot.values

    return {
        "thread_id": thread_id,
        "topic": state.get("topic", ""),
        "status": get_status(snapshot),
        "report": state.get("report", ""),
        "approved": state.get("approved", False),
        "revision_count": state.get("revision_count", 0),
    }


# -----------------------------
# Retrieve report
# -----------------------------

@app.get("/research/{thread_id}/report")
def get_research_report(thread_id: str):
    snapshot = get_snapshot(thread_id)
    state = snapshot.values
    report = state.get("report")

    if not report:
        raise HTTPException(
            status_code=404,
            detail="Report has not been generated yet",
        )

    return {
        "thread_id": thread_id,
        "topic": state.get("topic", ""),
        "report": report,
        "approved": state.get("approved", False),
    }



logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.exception_handler(Exception)
async def unexpected_error_handler(
    request: Request,
    exc: Exception,
):
    logger.exception(
        "Unhandled error on %s %s",
        request.method,
        request.url.path,
    )

    return JSONResponse(
        status_code=500,
        content={
            "detail": "An unexpected server error occurred."
        },
    )

