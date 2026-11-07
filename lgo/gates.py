from __future__ import annotations
import hmac
import hashlib
import time
from pathlib import Path
from .util import canonical, digest, PolicyError

VERDICTS = {"PASS", "FAIL", "RETRY", "REPLAN", "BLOCKED", "HUMAN_APPROVAL_REQUIRED"}


def decision(
    verdict, reason, unit=None, evidence=(), policy="default", next_action=None
):
    if verdict not in VERDICTS:
        raise ValueError(verdict)
    return {
        "schema_version": "1.0",
        "verdict": verdict,
        "reason": reason,
        "unit": unit,
        "evidence": list(evidence),
        "policy": policy,
        "next_action": next_action or verdict.lower(),
    }


class ApprovalAuthority:
    """Operator trust boundary. Never provide this key or token minting to a worker.

    HMAC authenticates the operator/service owning the external key. It cannot
    prove human presence; use a protected CI approval service for production.
    """

    def __init__(self, key_file, project):
        path = Path(key_file).resolve()
        if path.is_relative_to(Path(project).resolve()):
            raise PolicyError("Authority key must be outside project")
        if path.stat().st_mode & 0o077:
            raise PolicyError("Authority key must have permissions 0600")
        self.key = path.read_bytes()
        if len(self.key) < 32:
            raise PolicyError("Authority key needs at least 32 bytes")

    def sign(self, payload):
        return {
            "payload": payload,
            "signature": hmac.new(
                self.key, canonical(payload).encode(), hashlib.sha256
            ).hexdigest(),
        }

    def verify(self, token, binding, action):
        try:
            payload = token["payload"]
            expected = hmac.new(
                self.key, canonical(payload).encode(), hashlib.sha256
            ).hexdigest()
            valid = hmac.compare_digest(expected, token["signature"])
            return (
                valid
                and payload["binding"] == binding
                and payload["action"] == action
                and payload["expires_at"] > time.time()
                and bool(payload["actor"])
            )
        except (KeyError, TypeError, ValueError):
            return False


class GateEngine:
    def __init__(self, authority=None):
        self.authority = authority
        self.policy = {
            "schema_version": "1.0",
            "high_risk_paths": [],
            "medium_requires_approval": False,
            "max_files_per_patch": 100,
        }

    def configure(self, path):
        import yaml

        if not Path(path).exists():
            return
        data = yaml.safe_load(Path(path).read_text())
        if (
            not isinstance(data, dict)
            or data.get("schema_version") != "1.0"
            or set(data) - set(self.policy)
        ):
            raise PolicyError("Invalid policies configuration")
        combined = {**self.policy, **data}
        if type(combined["medium_requires_approval"]) is not bool:
            raise PolicyError("medium_requires_approval must be boolean")
        if (
            type(combined["max_files_per_patch"]) is not int
            or combined["max_files_per_patch"] < 1
        ):
            raise PolicyError("max_files_per_patch must be positive")
        if not isinstance(combined["high_risk_paths"], list) or not all(
            isinstance(x, str) and x for x in combined["high_risk_paths"]
        ):
            raise PolicyError("high_risk_paths must be pattern list")
        self.policy = combined

    def effective_risk(self, unit, paths=None):
        from pathlib import PurePosixPath

        high = {
            "auth",
            "authentication",
            "authorization",
            "migrations",
            "infrastructure",
            "production",
            "payments",
            "financial",
            "secrets",
            ".github",
        }
        names = paths if paths is not None else unit["file_scope"]
        from .util import matches

        if any(matches(p, self.policy["high_risk_paths"]) for p in names):
            return "HIGH"
        if unit["risk"] == "MEDIUM" and self.policy["medium_requires_approval"]:
            return "HIGH"
        if any(
            any(part.lower() in high for part in PurePosixPath(p).parts) for p in names
        ):
            return "HIGH"
        return unit["risk"]

    def authorize(self, run, unit=None, token=None, action="execute"):
        if unit and self.effective_risk(unit) != "HIGH":
            return decision(
                "PASS", "Reversible local patch within configured policy", unit["id"]
            )
        binding = digest(
            {
                "run_id": run["id"],
                "graph": run["graph"],
                "unit": unit["id"] if unit else None,
                "evidence": run.get("evidence_digest"),
                "policy_hash": run.get("policy_hash"),
            }
        )
        if self.authority and token and self.authority.verify(token, binding, action):
            return decision(
                "PASS",
                "External authority signature verified",
                unit["id"] if unit else None,
                policy="external-authority",
            )
        d = decision(
            "HUMAN_APPROVAL_REQUIRED",
            "External authority approval required",
            unit["id"] if unit else None,
            policy="blast-radius",
            next_action="obtain signed approval from operator/service",
        )
        d["approval_request"] = {
            "binding": binding,
            "action": action,
            "run_id": run["id"],
            "unit": unit["id"] if unit else None,
        }
        return d

    def quality(self, run):
        if not run["nodes"] or any(
            n["state"] != "PASSED" or not n.get("verified") or not n.get("integrated")
            for n in run["nodes"].values()
        ):
            return decision(
                "FAIL", "Not all units verified and integrated", policy="quality"
            )
        if not run.get("integration", {}).get("passed"):
            return decision(
                "FAIL", "Integration checks absent or failing", policy="quality"
            )
        return decision(
            "PASS",
            "Unit and integration evidence available",
            evidence=[run.get("evidence_digest")],
            policy="quality",
        )
