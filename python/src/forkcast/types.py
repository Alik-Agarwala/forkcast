"""Data model shared with the JavaScript SDK and the Forkcast server.

Experiments arrive from the server (or a config file) as plain JSON, so the
SDK works with dictionaries. The ``TypedDict`` definitions below document
their shape and give editors and type checkers something to work with.

Vocabulary:

- **Experiment**: a named switch in your code, e.g. ``new-checkout``.
- **Treatment / variant**: one arm of the experiment. ``C`` is always the
  control (today's behaviour). ``T1``, ``T2``, ... are new treatments.
- **Traffic**: the % of eligible users that enter the experiment at all.
- **Weights**: how users *inside* the experiment are split across treatments.
- **Environment**: development / staging / production, each with its own
  on/off status and traffic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, TypedDict, Union

#: A treatment key such as ``"C"``, ``"T1"``, ``"T2"`` (or any custom key).
Treatment = str

#: The control treatment. Returned whenever anything is off, missing or failing.
CONTROL: Treatment = "C"

EnvironmentStatus = Literal["off", "running", "launched"]

EvaluationReason = Literal[
    "not_found",
    "archived",
    "override",
    "off",
    "launched",
    "forced",
    "not_targeted",
    "not_in_traffic",
    "no_user",
    "assigned",
]


class Variant(TypedDict, total=False):
    key: Treatment
    name: str
    weight: float
    payload: Any


class Condition(TypedDict, total=False):
    attribute: str
    operator: str
    value: Union[str, int, float, bool, List[Union[str, int, float]]]


class Audience(TypedDict, total=False):
    match: Literal["all", "any"]
    conditions: List[Condition]


class ForcedAssignment(TypedDict):
    variant: Treatment
    userIds: List[str]


class EnvironmentSettings(TypedDict, total=False):
    status: EnvironmentStatus
    traffic: float
    launchedVariant: Treatment


class Experiment(TypedDict, total=False):
    key: str
    name: str
    description: str
    type: Literal["experiment", "flag"]
    variants: List[Variant]
    salt: str
    audience: Audience
    forced: List[ForcedAssignment]
    environments: Dict[str, EnvironmentSettings]
    metrics: List[str]
    archived: bool


class ForkcastConfig(TypedDict, total=False):
    version: int
    experiments: List[Experiment]


#: Who is being evaluated: ``{"id": "user-42", "country": "IN", "plan": "pro"}``.
#: Any extra attribute can be used for targeting.
UserContext = Dict[str, Any]


@dataclass(frozen=True)
class Evaluation:
    """The result of evaluating one experiment for one user."""

    experiment: str
    variant: Treatment
    reason: EvaluationReason
    payload: Optional[Any] = None
    #: True only when the user was randomly bucketed and counts towards results.
    in_experiment: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment": self.experiment,
            "variant": self.variant,
            "payload": self.payload,
            "reason": self.reason,
            "in_experiment": self.in_experiment,
        }
