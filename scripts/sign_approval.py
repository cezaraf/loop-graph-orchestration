#!/usr/bin/env python3
"""Operator-side reference approval signer. Never expose this to workers.

For production use a protected approval service with authenticated human review.
This local command authenticates possession of an operator key, not human identity.
"""

import argparse
import json
from pathlib import Path
import sys
import time
from lgo.gates import ApprovalAuthority

p = argparse.ArgumentParser(
    description="Assina uma decisão externa após revisão explícita no terminal"
)
p.add_argument("--key", type=Path, required=True)
p.add_argument("--project", type=Path, required=True)
p.add_argument("--request", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
p.add_argument("--actor", required=True)
a = p.parse_args()
if not sys.stdin.isatty():
    raise SystemExit(
        "Use um terminal interativo de operador; o worker não pode autorizar."
    )
r = json.loads(a.request.read_text())
r = r.get("approval_request", r.get("gate", {}).get("approval_request", r))
print(json.dumps(r, ensure_ascii=False, indent=2))
if (
    input("Após revisar o resultado, digite AUTORIZAR " + r["binding"] + ": ")
    != "AUTORIZAR " + r["binding"]
):
    raise SystemExit("Não autorizado")
token = ApprovalAuthority(a.key, a.project).sign(
    {**r, "actor": a.actor, "expires_at": time.time() + 600}
)
a.output.write_text(json.dumps(token, indent=2) + "\n")
a.output.chmod(0o600)
