"""
AI Agents Module — crewAI integration for multi-agent orchestration.

Provides crew creation, execution, and built-in templates for
common software-engineering workflows.
"""

from __future__ import annotations

import sys
import uuid
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Graceful imports
# ---------------------------------------------------------------------------

_HAS_CREWAI = False

try:
    from crewai import Agent as _CrewAgent
    from crewai import Crew as _CrewCrew
    from crewai import Process as _CrewProcess
    from crewai import Task as _CrewTask

    _HAS_CREWAI = True
except ImportError:
    print("[ai_agents] ⚠️  crewai not installed — agent module will use stub responses", file=sys.stderr)

# ---------------------------------------------------------------------------
# In-memory crew registry
# ---------------------------------------------------------------------------

_crews: dict[str, dict[str, Any]] = {}

# ---------------------------------------------------------------------------
# Built-in crew templates
# ---------------------------------------------------------------------------

_BUILTIN_TEMPLATES: dict[str, dict[str, Any]] = {
    "code_review": {
        "name": "Code Review Crew",
        "description": "Reviews code for bugs, security issues, and performance problems.",
        "agents": [
            {
                "role": "Senior Code Reviewer",
                "goal": "Find bugs, security vulnerabilities, and performance issues in code.",
                "backstory": "A seasoned engineer with 15+ years of experience in code review and security auditing.",
            },
            {
                "role": "Style Checker",
                "goal": "Ensure code follows best practices and style guidelines.",
                "backstory": "A developer who has enforced consistent code style across large organizations.",
            },
        ],
        "tasks": [
            {
                "description": "Analyze the provided code for bugs, security issues, and performance problems. Return a structured report.",
                "expected_output": "A detailed review with severity levels for each finding.",
            },
            {
                "description": "Check the code for style consistency, naming conventions, and adherence to best practices.",
                "expected_output": "A style report with specific suggestions for improvement.",
            },
        ],
        "process": "sequential",
    },
    "research": {
        "name": "Research Crew",
        "description": "Researches a topic and writes a comprehensive report.",
        "agents": [
            {
                "role": "Researcher",
                "goal": "Gather comprehensive information about a given topic from multiple sources.",
                "backstory": "An expert researcher skilled at finding and synthesizing information.",
            },
            {
                "role": "Report Writer",
                "goal": "Write a well-structured, informative report from research findings.",
                "backstory": "A technical writer who excels at making complex topics accessible.",
            },
        ],
        "tasks": [
            {
                "description": "Research the given topic thoroughly. Gather key facts, different perspectives, and recent developments.",
                "expected_output": "Comprehensive research notes organized by subtopic.",
            },
            {
                "description": "Write a detailed report based on the research findings. Include an executive summary, key findings, and conclusions.",
                "expected_output": "A well-structured report in markdown format.",
            },
        ],
        "process": "sequential",
    },
    "test_writer": {
        "name": "Test Writer Crew",
        "description": "Writes comprehensive tests for given code.",
        "agents": [
            {
                "role": "Test Architect",
                "goal": "Design test strategies and write thorough unit and integration tests.",
                "backstory": "A QA engineer who believes in test-driven development and comprehensive coverage.",
            },
        ],
        "tasks": [
            {
                "description": "Analyze the provided code and write comprehensive tests covering edge cases, error paths, and happy paths.",
                "expected_output": "A complete test file with clear test names and assertions.",
            },
        ],
        "process": "sequential",
    },
    "doc_writer": {
        "name": "Documentation Crew",
        "description": "Generates comprehensive documentation for code.",
        "agents": [
            {
                "role": "Technical Writer",
                "goal": "Write clear, comprehensive documentation for software projects.",
                "backstory": "A documentation specialist who has written docs for major open-source projects.",
            },
        ],
        "tasks": [
            {
                "description": "Analyze the code and write comprehensive documentation including API references, usage examples, and architecture notes.",
                "expected_output": "Well-structured documentation in markdown format.",
            },
        ],
        "process": "sequential",
    },
    "bug_fixer": {
        "name": "Bug Fixer Crew",
        "description": "Analyzes and fixes bugs in code.",
        "agents": [
            {
                "role": "Bug Analyst",
                "goal": "Identify the root cause of bugs and propose fixes.",
                "backstory": "A debugging expert who can trace issues through complex systems.",
            },
            {
                "role": "Fix Implementer",
                "goal": "Implement clean, minimal fixes for identified bugs.",
                "backstory": "A developer who specializes in surgical bug fixes that don't introduce regressions.",
            },
        ],
        "tasks": [
            {
                "description": "Analyze the bug description and code. Identify the root cause and explain what's going wrong.",
                "expected_output": "Root cause analysis with specific line references.",
            },
            {
                "description": "Implement the fix for the identified bug. Ensure the fix is minimal, correct, and doesn't break existing functionality.",
                "expected_output": "The corrected code with explanation of the fix.",
            },
        ],
        "process": "sequential",
    },
    "refactoring": {
        "name": "Refactoring Crew",
        "description": "Suggests and applies code refactoring improvements.",
        "agents": [
            {
                "role": "Refactoring Analyst",
                "goal": "Identify refactoring opportunities that improve code quality.",
                "backstory": "An architect who has refactored countless codebases to improve maintainability.",
            },
        ],
        "tasks": [
            {
                "description": "Analyze the code for refactoring opportunities including code smells, duplication, and design pattern improvements. Apply the changes.",
                "expected_output": "Refactored code with explanations of each improvement.",
            },
        ],
        "process": "sequential",
    },
    "full_stack": {
        "name": "Full Stack Crew",
        "description": "Plans and implements features end-to-end.",
        "agents": [
            {
                "role": "Technical Planner",
                "goal": "Break down feature requirements into a technical implementation plan.",
                "backstory": "A tech lead who excels at translating requirements into actionable tasks.",
            },
            {
                "role": "Full Stack Developer",
                "goal": "Implement the feature across frontend and backend.",
                "backstory": "A versatile developer comfortable with React, Next.js, Python, and databases.",
            },
            {
                "role": "Code Reviewer",
                "goal": "Review the implementation for quality and correctness.",
                "backstory": "A senior engineer who ensures code meets production standards.",
            },
        ],
        "tasks": [
            {
                "description": "Create a detailed technical implementation plan based on the requirements. Include file changes, API contracts, and data models.",
                "expected_output": "A structured implementation plan.",
            },
            {
                "description": "Implement the feature according to the plan. Write clean, typed, well-structured code.",
                "expected_output": "Complete implementation of the feature.",
            },
            {
                "description": "Review the implementation for bugs, performance issues, and code quality. Suggest improvements.",
                "expected_output": "Code review with specific actionable feedback.",
            },
        ],
        "process": "sequential",
    },
}

# ---------------------------------------------------------------------------
# Agent roles
# ---------------------------------------------------------------------------

AGENT_ROLES = ["Researcher", "Coder", "Reviewer", "Tester", "Writer"]

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_templates() -> dict[str, dict[str, Any]]:
    """Return all built-in crew templates."""
    return {k: {"name": v["name"], "description": v["description"]} for k, v in _BUILTIN_TEMPLATES.items()}


def create_crew(
    agents_config: list[dict[str, Any]],
    tasks_config: list[dict[str, Any]],
    crew_id: Optional[str] = None,
    template_name: Optional[str] = None,
    process: str = "sequential",
) -> dict[str, Any]:
    """Create a new crew from config or template.

    If *template_name* is provided, the built-in template overrides
    *agents_config* and *tasks_config*.
    """
    cid = crew_id or str(uuid.uuid4())

    if template_name and template_name in _BUILTIN_TEMPLATES:
        tpl = _BUILTIN_TEMPLATES[template_name]
        agents_config = tpl["agents"]
        tasks_config = tpl["tasks"]
        process = tpl.get("process", process)

    crew_record: dict[str, Any] = {
        "id": cid,
        "agents": agents_config,
        "tasks": tasks_config,
        "process": process,
        "template": template_name,
        "status": "created",
        "result": None,
    }

    if _HAS_CREWAI:
        crew_obj = _build_crew(agents_config, tasks_config, process)
        crew_record["_crew_obj"] = crew_obj

    _crews[cid] = crew_record
    return {k: v for k, v in crew_record.items() if not k.startswith("_")}


def run_crew(crew_id: str, inputs: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Execute the crew identified by *crew_id*."""
    if crew_id not in _crews:
        raise KeyError(f"Crew {crew_id} not found")

    record = _crews[crew_id]
    record["status"] = "running"

    if not _HAS_CREWAI:
        record["status"] = "completed"
        record["result"] = {
            "message": "crewai is not installed — returning stub result",
            "agents": [a.get("role") for a in record["agents"]],
            "tasks": [t.get("description", "")[:100] for t in record["tasks"]],
        }
        return {k: v for k, v in record.items() if not k.startswith("_")}

    crew_obj = record.get("_crew_obj")
    if crew_obj is None:
        crew_obj = _build_crew(record["agents"], record["tasks"], record["process"])
        record["_crew_obj"] = crew_obj

    try:
        result = crew_obj.kickoff(inputs=inputs or {})
        record["status"] = "completed"
        record["result"] = str(result)
    except Exception as exc:
        record["status"] = "failed"
        record["result"] = str(exc)

    return {k: v for k, v in record.items() if not k.startswith("_")}


def get_crew_status(crew_id: str) -> dict[str, Any]:
    """Return the current status of a crew."""
    if crew_id not in _crews:
        raise KeyError(f"Crew {crew_id} not found")
    record = _crews[crew_id]
    return {k: v for k, v in record.items() if not k.startswith("_")}


def list_crews() -> list[dict[str, Any]]:
    """Return summaries of all registered crews."""
    return [
        {k: v for k, v in rec.items() if not k.startswith("_")}
        for rec in _crews.values()
    ]


def cancel_crew(crew_id: str) -> dict[str, Any]:
    """Mark a crew as cancelled (best-effort)."""
    if crew_id not in _crews:
        raise KeyError(f"Crew {crew_id} not found")
    _crews[crew_id]["status"] = "cancelled"
    return {"crew_id": crew_id, "status": "cancelled"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_crew(agents_config: list[dict[str, Any]], tasks_config: list[dict[str, Any]], process: str = "sequential") -> Any:
    """Construct a crewAI Crew object from config dicts."""
    agents = []
    for ac in agents_config:
        agent = _CrewAgent(
            role=ac.get("role", "Agent"),
            goal=ac.get("goal", "Complete the task."),
            backstory=ac.get("backstory", "A helpful AI agent."),
            verbose=ac.get("verbose", True),
            allow_delegation=ac.get("allow_delegation", False),
        )
        agents.append(agent)

    tasks = []
    for i, tc in enumerate(tasks_config):
        agent_idx = min(i, len(agents) - 1)
        task = _CrewTask(
            description=tc.get("description", ""),
            expected_output=tc.get("expected_output", ""),
            agent=agents[agent_idx],
        )
        tasks.append(task)

    proc = _CrewProcess.sequential if process == "sequential" else _CrewProcess.hierarchical

    return _CrewCrew(
        agents=agents,
        tasks=tasks,
        process=proc,
        verbose=True,
    )
