import hashlib
import json
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from test_proofs import BODY, URL, mocks, submit

NOW = int(datetime(2026, 10, 20, 12, tzinfo=timezone.utc).timestamp())


@pytest.fixture
def board(direct_deploy, direct_vm):
    direct_vm.warp("2026-10-20T12:00:00Z")
    return direct_deploy("contracts/OrivexProofRegistry.py", sdk_version="v0.2.16")


def post(board, vm, requester, issuer=None, minimum=0, task_id="offer", deadline=NOW + 3600):
    vm.sender = requester
    return board.post_task(task_id, "Review the document", "The evidence supports the claim",
                           issuer or requester, minimum, deadline)


def qualify(board, vm, issuer, agent, status="SUCCESS", task_id="qualification"):
    proof_id = submit(board, vm, issuer, agent, reference=f"{task_id}:proof", task_id=task_id)
    mocks(vm, status)
    board.verify_proof(proof_id)
    return proof_id


@pytest.fixture
def portable(board, direct_vm, direct_alice, direct_bob, monkeypatch):
    direct_vm._chain_id = 61997
    registry = "0xe9045A2ea5A5F43eB6677e2ae6b02E67E8b3B53a"
    module = sys.modules[type(object.__getattribute__(board, "_instance")).__module__]
    rows = {}
    reads = []

    def contract_at(address):
        def view(*, state):
            reads.append((str(address).lower(), state.name))
            return SimpleNamespace(get_issuer_verified_count=lambda issuer, agent: rows[str(issuer).lower(), str(agent).lower()])
        return SimpleNamespace(view=view)

    monkeypatch.setattr(module.gl, "get_contract_at", contract_at)
    direct_vm.sender = direct_alice
    board.post_portable_task("portable", "Review", "The document supports the claim", direct_alice, 1, NOW + 3600)
    rows[str(direct_alice).lower(), str(direct_bob).lower()] = 0
    return registry, rows, reads


def test_portable_offer_uses_old_count_only_and_commits_source(portable, board, direct_vm, direct_alice, direct_bob):
    registry, rows, reads = portable
    qualify(board, direct_vm, direct_alice, direct_bob)
    assert board.get_issuer_verified_count(direct_alice, direct_bob) == 1
    reason = json.loads(board.get_eligibility("portable", direct_bob))["reason"]
    assert reads == [(registry.lower(), "LATEST_FINAL")]
    assert reason == "CREDENTIAL_REQUIRED"
    with direct_vm.expect_revert("CREDENTIAL_REQUIRED"):
        board.claim_task("portable")
    rows[str(direct_alice).lower(), str(direct_bob).lower()] = 1
    board.claim_task("portable")
    assignment = json.loads(board.get_task("portable"))
    assert assignment["credential_registry"] == registry
    assert assignment["qualifying_count"] == 1
    proof = board.submit_proof("portable", "portable-proof", URL, hashlib.sha256(BODY).hexdigest())
    mocks(direct_vm)
    board.verify_proof(proof)
    record = json.loads(board.get_proof(proof))
    assert record["credential_registry"] == registry
    assert board.get_issuer_verified_count(direct_alice, direct_bob) == 2


def test_portable_claim_fails_closed_when_source_unavailable(portable, board, direct_vm, direct_alice, direct_bob):
    _, rows, _ = portable
    rows.clear()
    direct_vm.sender = direct_bob
    result = json.loads(board.get_eligibility("portable", direct_bob))
    assert result["reason"] == "CREDENTIAL_SOURCE_UNAVAILABLE"
    with direct_vm.expect_revert("CREDENTIAL_SOURCE_UNAVAILABLE"):
        board.claim_task("portable")
    assert json.loads(board.get_task("portable"))["status"] == "AVAILABLE"


def test_portable_claim_cannot_borrow_another_issuers_count(portable, board, direct_vm, direct_bob, direct_charlie):
    _, rows, _ = portable
    rows[str(direct_charlie).lower(), str(direct_bob).lower()] = 12
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("CREDENTIAL_REQUIRED"):
        board.claim_task("portable")


def test_portable_tasks_require_studio_next(board, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("CREDENTIAL_SOURCE_UNAVAILABLE"):
        board.post_portable_task("portable", "Review", "Test", direct_alice, 1, NOW + 3600)


def test_portable_tasks_require_positive_threshold(portable, board, direct_vm, direct_alice):
    with direct_vm.expect_revert("positive credential threshold"):
        board.post_portable_task("zero", "Review", "Test", direct_alice, 0, NOW + 3600)


def test_success_unlocks_atomic_assignment_and_commits_policy(board, direct_vm, direct_alice, direct_bob):
    post(board, direct_vm, direct_alice, minimum=1)
    assert json.loads(board.get_task("offer"))["status"] == "AVAILABLE"
    assert json.loads(board.get_eligibility("offer", direct_bob))["reason"] == "CREDENTIAL_REQUIRED"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("CREDENTIAL_REQUIRED"):
        board.claim_task("offer")
    qualify(board, direct_vm, direct_alice, direct_bob)
    assert board.get_issuer_verified_count(direct_alice, direct_bob) == 1
    assert json.loads(board.get_eligibility("offer", direct_bob))["eligible"] is True
    board.claim_task("offer")
    task = json.loads(board.get_task("offer"))
    assert task["status"] == "OPEN" and task["agent"].lower() == str(direct_bob).lower()
    proof_id = board.submit_proof("offer", "board-result", URL, hashlib.sha256(BODY).hexdigest())
    proof = json.loads(board.get_proof(proof_id))
    assert proof["board_task"] and proof["minimum_verified"] == 1 and proof["qualifying_count"] == 1
    mocks(direct_vm)
    board.verify_proof(proof_id)
    assert json.loads(board.get_task("offer"))["status"] == "SUCCESS"
    assert board.get_credential(direct_bob, "offer") == proof_id
    assert board.get_issuer_verified_count(direct_alice, direct_bob) == 2
    assert direct_vm.run_validator() is True
    mocks(direct_vm, "FAILED")
    assert direct_vm.run_validator() is False


@pytest.mark.parametrize("status", ["SUCCESS", "FAILED", "INCONCLUSIVE"])
def test_only_success_from_pinned_issuer_unlocks(board, direct_vm, direct_alice, direct_bob, direct_charlie, status):
    post(board, direct_vm, direct_alice, minimum=1)
    qualify(board, direct_vm, direct_charlie, direct_bob, task_id="other-issuer")
    assert board.get_verified_count(direct_bob) == 1
    assert json.loads(board.get_eligibility("offer", direct_bob))["eligible"] is False
    proof_id = qualify(board, direct_vm, direct_alice, direct_bob, status)
    eligibility = json.loads(board.get_eligibility("offer", direct_bob))
    assert eligibility["eligible"] is (status == "SUCCESS")
    before = board.get_issuer_verified_count(direct_alice, direct_bob)
    with direct_vm.expect_revert("proof already finalized"):
        board.verify_proof(proof_id)
    assert board.get_issuer_verified_count(direct_alice, direct_bob) == before


def test_claim_race_and_cancellation_never_reassign(board, direct_vm, direct_alice, direct_bob, direct_charlie):
    post(board, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    board.claim_task("offer")
    before = board.get_task("offer")
    for actor in (direct_bob, direct_charlie):
        direct_vm.sender = actor
        with direct_vm.expect_revert("NOT_AVAILABLE"):
            board.claim_task("offer")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only unclaimed"):
        board.cancel_task("offer")
    assert board.get_task("offer") == before
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only assigned agent"):
        board.submit_proof("offer", "stolen", URL, hashlib.sha256(BODY).hexdigest())
    assert board.total_proofs() == 0


def test_only_requester_cancels_unclaimed_work(board, direct_vm, direct_alice, direct_bob):
    post(board, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only requester"):
        board.cancel_task("offer")
    direct_vm.sender = direct_alice
    board.cancel_task("offer")
    assert json.loads(board.get_task("offer"))["status"] == "CANCELLED"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("NOT_AVAILABLE"):
        board.claim_task("offer")


def test_requester_cannot_claim_even_without_credential_gate(board, direct_vm, direct_alice):
    post(board, direct_vm, direct_alice)
    assert json.loads(board.get_eligibility("offer", direct_alice))["reason"] == "REQUESTER_CANNOT_CLAIM"
    with direct_vm.expect_revert("REQUESTER_CANNOT_CLAIM"):
        board.claim_task("offer")


def test_deadline_is_enforced_at_equality_without_cleanup(board, direct_vm, direct_alice, direct_bob):
    post(board, direct_vm, direct_alice, deadline=NOW + 60)
    direct_vm.warp("2026-10-20T12:01:00Z")
    assert json.loads(board.get_task("offer"))["status"] == "EXPIRED"
    assert json.loads(board.list_board_tasks(0, 20))["tasks"][0]["status"] == "EXPIRED"
    assert json.loads(board.get_eligibility("offer", direct_bob))["reason"] == "EXPIRED"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("EXPIRED"):
        board.claim_task("offer")


def test_claimed_work_remains_submitable_after_claim_deadline(board, direct_vm, direct_alice, direct_bob):
    post(board, direct_vm, direct_alice, deadline=NOW + 60)
    direct_vm.sender = direct_bob
    board.claim_task("offer")
    direct_vm.warp("2026-10-20T12:01:00Z")
    proof_id = board.submit_proof("offer", "late-work", URL, hashlib.sha256(BODY).hexdigest())
    assert json.loads(board.get_proof(proof_id))["status"] == "PENDING"


@pytest.mark.parametrize("field,value", [
    ("task_id", ""), ("task_id", "bad id"), ("task_id", "x" * 129),
    ("claim", " "), ("claim", "x" * 2049), ("criterion", ""),
    ("minimum_verified", 1001), ("claim_deadline", NOW),
    ("claim_deadline", NOW + 30 * 86400 + 1),
])
def test_invalid_post_never_enters_board(board, direct_vm, direct_alice, field, value):
    direct_vm.sender = direct_alice
    args = dict(task_id="offer", claim="claim", criterion="criterion", credential_issuer=direct_alice,
                minimum_verified=0, claim_deadline=NOW + 3600)
    args[field] = value
    with direct_vm.expect_revert("[EXPECTED]"):
        board.post_task(**args)
    assert json.loads(board.list_board_tasks(0, 20)) == {"total": 0, "tasks": []}


def test_post_cannot_edit_terms_or_direct_assignment(board, direct_vm, direct_alice, direct_bob):
    post(board, direct_vm, direct_alice)
    before = board.get_task("offer")
    with direct_vm.expect_revert("already used"):
        board.post_task("offer", "new claim", "new criterion", direct_bob, 0, NOW + 60)
    assert board.get_task("offer") == before
    with direct_vm.expect_revert("already used"):
        board.create_task("offer", direct_bob, "new", "new")
    board.create_task("direct", direct_bob, "fixed claim", "fixed criterion")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("DIRECT_ASSIGNMENT"):
        board.claim_task("direct")


def test_pagination_is_bounded_and_returns_newest_first(board, direct_vm, direct_alice):
    for index in range(4):
        post(board, direct_vm, direct_alice, task_id=f"offer-{index}")
    page = json.loads(board.list_board_tasks(1, 2))
    assert page["total"] == 4 and [task["task_id"] for task in page["tasks"]] == ["offer-2", "offer-1"]
    assert json.loads(board.list_board_tasks(100, 20))["tasks"] == []
    for limit in (0, 21):
        with direct_vm.expect_revert("page size"):
            board.list_board_tasks(0, limit)
    assert board.get_protocol_version() == 5
