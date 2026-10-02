import hashlib
import json

import pytest


BODY = b"Independent report: the agent completed all required steps."
URL = "https://raw.githubusercontent.com/example/evidence/" + "a" * 40 + "/report.txt"


@pytest.fixture
def registry(direct_deploy):
    return direct_deploy("contracts/OrivexProofRegistry.py")


def submit(registry, vm, requester, agent, reference="action-1", task_id="task-1", url=URL, digest=None):
    vm.sender = requester
    registry.create_task(task_id, agent, "The action completed", "All steps completed")
    vm.sender = agent
    return registry.submit_proof(task_id, reference, url, digest or hashlib.sha256(BODY).hexdigest())


def mocks(vm, status="SUCCESS", body=BODY):
    vm.clear_mocks()
    vm.mock_web(r"raw\.githubusercontent\.com", {"status": 200, "body": body})
    vm.mock_llm(r"Evaluate this Orivex proof", json.dumps({"status": status}))


@pytest.mark.parametrize("status", ["SUCCESS", "FAILED", "INCONCLUSIVE"])
def test_finalization_and_hash(registry, direct_vm, direct_alice, direct_bob, status):
    proof_id = submit(registry, direct_vm, direct_alice, direct_bob)
    mocks(direct_vm, status)
    digest = registry.verify_proof(proof_id)
    record = json.loads(registry.get_proof(proof_id))
    assert record.pop("proof_hash") == digest
    assert record["status"] == status
    task = json.loads(registry.get_task("task-1"))
    assert task["status"] == status
    assert registry.get_credential(direct_bob, "task-1") == (proof_id if status == "SUCCESS" else 0)
    assert registry.get_verified_count(direct_bob) == (1 if status == "SUCCESS" else 0)
    assert hashlib.sha256(json.dumps(record, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=True).encode()).hexdigest() == digest
    with direct_vm.expect_revert("proof already finalized"):
        registry.verify_proof(proof_id)


def test_submitter_ownership_and_reference_namespace(registry, direct_vm, direct_alice, direct_bob):
    alice_id = submit(registry, direct_vm, direct_bob, direct_alice)
    direct_vm.sender = direct_bob
    registry.create_task("task-2", direct_alice, "The action completed", "All steps completed")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("reference already submitted"):
        registry.submit_proof("task-2", "action-1", URL, hashlib.sha256(BODY).hexdigest())
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only submitter"):
        registry.verify_proof(alice_id)
    bob_id = submit(registry, direct_vm, direct_alice, direct_bob, task_id="task-3")
    assert alice_id != bob_id
    assert registry.get_proof_id(direct_alice, "action-1") == alice_id
    assert registry.get_proof_id(direct_bob, "action-1") == bob_id
    assert registry.total_proofs() == 2


@pytest.mark.parametrize("body", [b"tampered", b"", b"x" * 24001], ids=["tampered", "empty", "oversized"])
def test_invalid_evidence_never_finalizes(registry, direct_vm, direct_alice, direct_bob, body):
    proof_id = submit(registry, direct_vm, direct_alice, direct_bob)
    mocks(direct_vm, body=body)
    with direct_vm.expect_revert("[EXTERNAL]"):
        registry.verify_proof(proof_id)
    assert json.loads(registry.get_proof(proof_id))["status"] == "PENDING"


def test_validators_independently_check_decision_and_hash(registry, direct_vm, direct_alice, direct_bob):
    proof_id = submit(registry, direct_vm, direct_alice, direct_bob)
    mocks(direct_vm)
    registry.verify_proof(proof_id)
    assert direct_vm.run_validator() is True
    mocks(direct_vm, "FAILED")
    assert direct_vm.run_validator() is False
    mocks(direct_vm, body=b"tampered")
    assert direct_vm.run_validator() is False
    assert direct_vm.run_validator(leader_error=Exception("[LLM_ERROR] bad response")) is False
    assert direct_vm.run_validator(leader_result={"status": "made-up"}) is False


def test_malformed_llm_does_not_write(registry, direct_vm, direct_alice, direct_bob):
    proof_id = submit(registry, direct_vm, direct_alice, direct_bob)
    mocks(direct_vm, "made-up")
    with direct_vm.expect_revert("[LLM_ERROR]"):
        registry.verify_proof(proof_id)
    assert json.loads(registry.get_proof(proof_id))["status"] == "PENDING"


@pytest.mark.parametrize("url", [
    "http://localhost/report.txt", "https://127.0.0.1/report.txt",
    "https://raw.githubusercontent.com/example/evidence/main/report.txt",
    "https://raw.githubusercontent.com/example/evidence/long-branch/report.txt",
    URL + "?redirect=http://localhost", URL + "/../secret", URL + "#fragment",
])
def test_rejects_unpinned_and_noncanonical_sources(registry, direct_vm, direct_alice, direct_bob, url):
    with direct_vm.expect_revert("[EXTERNAL]"):
        submit(registry, direct_vm, direct_alice, direct_bob, url=url)
    assert registry.total_proofs() == 0


def test_requester_fixes_semantics_and_agent_cannot_self_assign(registry, direct_vm, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("requester and agent must differ"):
        registry.create_task("self-task", direct_alice, "claim", "criterion")
    registry.create_task("task-1", direct_bob, "Requester claim", "Requester criterion")
    with direct_vm.expect_revert("only assigned agent may submit"):
        registry.submit_proof("task-1", "ref", URL, hashlib.sha256(BODY).hexdigest())
    direct_vm.sender = direct_bob
    proof_id = registry.submit_proof("task-1", "ref", URL, hashlib.sha256(BODY).hexdigest())
    record = json.loads(registry.get_proof(proof_id))
    assert record["claim"] == "Requester claim"
    assert record["criterion"] == "Requester criterion"
    with direct_vm.expect_revert("task already submitted"):
        registry.submit_proof("task-1", "another", URL, hashlib.sha256(BODY).hexdigest())
