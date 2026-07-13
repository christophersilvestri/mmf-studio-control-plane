#!/usr/bin/env python3
import json
import os
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mmf_drive_brain_import import FixtureDrive, compile_brain, folder_id_from_ref, slugify


class DriveBrainImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.brain_root = self.root / "brains"
        self.template = self.root / "template"
        (self.template / "00_project-context").mkdir(parents=True)
        (self.template / "01_onboarding").mkdir(parents=True)
        (self.template / "00_project-context" / "brief.md").write_text("# Brief\n", encoding="utf-8")
        self.fixture = self.root / "drive.json"
        self.fixture.write_text(json.dumps({
            "folder": {
                "id": "folder_1234567890", "name": "Acme Client Project",
                "mimeType": "application/vnd.google-apps.folder",
                "webViewLink": "https://drive.google.com/drive/folders/folder_1234567890",
            },
            "items": [
                {
                    "id": "proposal_123456", "name": "Acme Proposal",
                    "mimeType": "application/vnd.google-apps.document",
                    "modifiedTime": "2026-07-01T10:00:00Z",
                    "webViewLink": "https://docs.google.com/document/d/proposal_123456/edit",
                    "path": "Acme Client Project/Proposal/Acme Proposal",
                    "content": "# Scope\r\nConversion strategy",
                },
                {
                    "id": "kickoff_1234567", "name": "Kickoff Call Transcript",
                    "mimeType": "text/plain", "modifiedTime": "2026-07-02T10:00:00Z",
                    "webViewLink": "https://drive.google.com/file/d/kickoff_1234567/view",
                    "path": "Acme Client Project/Calls/Kickoff Call Transcript.txt",
                    "content": "Client: We need clearer messaging.",
                },
                {
                    "id": "video_12345678", "name": "Call recording.mp4",
                    "mimeType": "video/mp4", "modifiedTime": "2026-07-02T10:00:00Z",
                    "size": 60 * 1024 * 1024,
                    "webViewLink": "https://drive.google.com/file/d/video_12345678/view",
                    "path": "Acme Client Project/Calls/Call recording.mp4",
                },
            ],
        }), encoding="utf-8")
        self.drive = FixtureDrive(self.fixture)

    def tearDown(self):
        self.tmp.cleanup()

    def test_parses_folder_url_and_rejects_bad_input(self):
        self.assertEqual(folder_id_from_ref("https://drive.google.com/drive/folders/folder_1234567890?usp=sharing"), "folder_1234567890")
        self.assertEqual(folder_id_from_ref("folder_1234567890"), "folder_1234567890")
        with self.assertRaises(ValueError):
            folder_id_from_ref("https://example.com/not-drive")

    def test_compiles_fixture_atomically_into_private_mmf_brain(self):
        result = compile_brain(
            drive=self.drive, folder_id="folder_1234567890", project_name="Acme Website",
            project_slug=slugify("Acme Website"), brain_root=self.brain_root,
            template_root=self.template, dry_run=False,
        )
        target = self.brain_root / "acme-website"
        self.assertTrue(result["ok"])
        self.assertEqual(result["importedCount"], 2)
        self.assertEqual(result["skippedCount"], 1)
        proposal = target / "01_onboarding/proposal.md"
        kickoff = target / "01_onboarding/kickoff-call.md"
        self.assertIn("source_drive_id: \"proposal_123456\"", proposal.read_text())
        self.assertIn("Conversion strategy", proposal.read_text())
        self.assertIn("clearer messaging", kickoff.read_text())
        manifest = json.loads((target / "00_project-context/drive-import-manifest.json").read_text())
        self.assertEqual(manifest["folderId"], "folder_1234567890")
        self.assertEqual(len(manifest["records"]), 3)
        self.assertEqual(
            next(record["reason"] for record in manifest["records"] if record["id"] == "video_12345678"),
            "source_too_large",
        )
        self.assertEqual(os.stat(target).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(proposal).st_mode & 0o777, 0o600)
        self.assertFalse(any(path.name.startswith(".acme-website.staging") for path in self.brain_root.iterdir()))

    def test_duplicate_canonical_sources_are_preserved(self):
        data = json.loads(self.fixture.read_text(encoding="utf-8"))
        data["items"].append({
            "id": "proposal_abcdef12", "name": "Revised Proposal",
            "mimeType": "application/vnd.google-apps.document",
            "modifiedTime": "2026-07-03T10:00:00Z",
            "webViewLink": "https://docs.google.com/document/d/proposal_abcdef12/edit",
            "path": "Acme Client Project/Proposal/Revised Proposal",
            "content": "# Revised scope\nDo not overwrite the first proposal.",
        })
        duplicate_fixture = self.root / "drive-duplicates.json"
        duplicate_fixture.write_text(json.dumps(data), encoding="utf-8")
        result = compile_brain(
            drive=FixtureDrive(duplicate_fixture), folder_id="folder_1234567890",
            project_name="Duplicate Sources", project_slug="duplicate-sources",
            brain_root=self.brain_root, template_root=self.template, dry_run=False,
        )
        proposals = sorted((Path(result["targetPath"]) / "01_onboarding").glob("proposal*.md"))
        self.assertEqual(len(proposals), 2)
        self.assertTrue(any("Conversion strategy" in path.read_text() for path in proposals))
        self.assertTrue(any("Do not overwrite" in path.read_text() for path in proposals))

    def test_concurrent_import_lock_fails_closed_without_removing_owner_lock(self):
        self.brain_root.mkdir(parents=True)
        lock = self.brain_root / ".locked-project.import.lock"
        lock.write_text("pid=123\n", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "already running"):
            compile_brain(
                drive=self.drive, folder_id="folder_1234567890", project_name="Locked Project",
                project_slug="locked-project", brain_root=self.brain_root,
                template_root=self.template, dry_run=False,
            )
        self.assertEqual(lock.read_text(encoding="utf-8"), "pid=123\n")
        self.assertFalse((self.brain_root / "locked-project").exists())

    def test_existing_project_brain_fails_without_modifying_it(self):
        target = self.brain_root / "acme-website"
        target.mkdir(parents=True)
        sentinel = target / "manual.md"
        sentinel.write_text("keep me", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            compile_brain(
                drive=self.drive, folder_id="folder_1234567890", project_name="Acme Website",
                project_slug="acme-website", brain_root=self.brain_root,
                template_root=self.template, dry_run=False,
            )
        self.assertEqual(sentinel.read_text(), "keep me")

    def test_dry_run_writes_nothing(self):
        result = compile_brain(
            drive=self.drive, folder_id="folder_1234567890", project_name="Acme Website",
            project_slug="acme-website", brain_root=self.brain_root,
            template_root=self.template, dry_run=True,
        )
        self.assertTrue(result["dryRun"])
        self.assertEqual(result["inventoryCount"], 3)
        self.assertFalse(self.brain_root.exists())


if __name__ == "__main__":
    unittest.main()
