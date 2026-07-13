#!/usr/bin/env python3
"""Compile a Google Drive folder into a private MMF project brain.

Drive access is read-only. Output is created atomically from the existing MMF
project template. Use --fixture for tests; fixture mode never imports Google SDKs.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any

FOLDER_MIME = "application/vnd.google-apps.folder"
DOC_MIME = "application/vnd.google-apps.document"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
SLIDE_MIME = "application/vnd.google-apps.presentation"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TEXT_MIMES = {"text/plain", "text/markdown", "text/csv", "application/json"}
FOLDER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,}$")


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value[:80] or "source"


def folder_id_from_ref(value: str) -> str:
    value = value.strip()
    if FOLDER_ID_RE.fullmatch(value):
        return value
    patterns = [r"/folders/([A-Za-z0-9_-]+)", r"[?&]id=([A-Za-z0-9_-]+)"]
    for pattern in patterns:
        match = re.search(pattern, value)
        if match and FOLDER_ID_RE.fullmatch(match.group(1)):
            return match.group(1)
    raise ValueError("Enter a valid Google Drive folder URL or folder ID")


def normalized_text(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n").strip() + "\n"


def content_hash(value: str) -> str:
    return hashlib.sha256(normalized_text(value).encode("utf-8")).hexdigest()


def classify_target(name: str, source_path: str, file_id: str) -> Path:
    probe = f"{source_path} {name}".lower()
    if "proposal" in probe:
        return Path("01_onboarding/proposal.md")
    if "intake" in probe or "questionnaire" in probe:
        return Path("01_onboarding/intake-questionnaire.md")
    if "kickoff" in probe or "kick-off" in probe:
        return Path("01_onboarding/kickoff-call.md")
    stem = slugify(Path(name).stem)
    suffix = file_id[:8]
    if "transcript" in probe or " call" in probe or "meeting" in probe:
        return Path("01_onboarding/source-transcripts") / f"{stem}-{suffix}.md"
    return Path("00_project-context/imported-sources") / f"{stem}-{suffix}.md"


def source_frontmatter(item: dict[str, Any], digest: str) -> str:
    fields = {
        "source_system": "google_drive",
        "source_drive_id": item["id"],
        "source_path": item["path"],
        "source_url": item.get("webViewLink") or "",
        "source_mime_type": item.get("mimeType") or "",
        "source_modified": item.get("modifiedTime") or "",
        "source_content_sha256": digest,
    }
    lines = ["---"] + [f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in fields.items()] + ["---", ""]
    return "\n".join(lines)


def command_text(command: list[str], *, input_bytes: bytes | None = None) -> str:
    result = subprocess.run(command, input=input_bytes, capture_output=True, timeout=90, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace").strip() or f"Converter failed: {command[0]}")
    return result.stdout.decode("utf-8", errors="replace")


class FixtureDrive:
    def __init__(self, fixture_path: Path):
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.folder = payload["folder"]
        self.items = payload.get("items", [])

    def validate_folder(self, folder_id: str) -> dict[str, Any]:
        if self.folder.get("id") != folder_id or self.folder.get("mimeType") != FOLDER_MIME:
            raise ValueError("Drive folder was not found or is not a folder")
        return self.folder

    def inventory(self, folder_id: str) -> list[dict[str, Any]]:
        self.validate_folder(folder_id)
        return [dict(item) for item in self.items]

    def extract(self, item: dict[str, Any]) -> tuple[str | None, str | None]:
        if item.get("content") is None:
            return None, "unsupported_fixture_item"
        return str(item["content"]), None


class GoogleDrive:
    def __init__(self, service_account_file: Path, impersonate_user: str):
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        scopes = ["https://www.googleapis.com/auth/drive.readonly"]
        credentials = service_account.Credentials.from_service_account_file(
            str(service_account_file), scopes=scopes, subject=impersonate_user,
        )
        self.service = build("drive", "v3", credentials=credentials, cache_discovery=False)

    @staticmethod
    def fields() -> str:
        return "id,name,mimeType,modifiedTime,webViewLink,parents,driveId,capabilities(canListChildren)"

    def validate_folder(self, folder_id: str) -> dict[str, Any]:
        result = self.service.files().get(
            fileId=folder_id, fields=self.fields(), supportsAllDrives=True,
        ).execute()
        if result.get("mimeType") != FOLDER_MIME:
            raise ValueError("Drive reference is not a folder")
        if result.get("capabilities", {}).get("canListChildren") is False:
            raise PermissionError("The Google Workspace account cannot list this folder")
        return result

    def inventory(self, folder_id: str) -> list[dict[str, Any]]:
        root = self.validate_folder(folder_id)
        output: list[dict[str, Any]] = []

        def walk(parent_id: str, prefix: str) -> None:
            page_token = None
            while True:
                result = self.service.files().list(
                    q=f"'{parent_id}' in parents and trashed=false",
                    pageSize=1000,
                    fields=f"nextPageToken,files({self.fields()})",
                    includeItemsFromAllDrives=True,
                    supportsAllDrives=True,
                    pageToken=page_token,
                ).execute()
                for item in result.get("files", []):
                    item_path = f"{prefix}/{item['name']}" if prefix else item["name"]
                    if item.get("mimeType") == FOLDER_MIME:
                        walk(item["id"], item_path)
                    else:
                        item["path"] = item_path
                        output.append(item)
                page_token = result.get("nextPageToken")
                if not page_token:
                    break

        walk(folder_id, root.get("name", ""))
        return output

    def _download(self, item: dict[str, Any]) -> bytes:
        return self.service.files().get_media(fileId=item["id"], supportsAllDrives=True).execute()

    def _export(self, item: dict[str, Any], mime_type: str) -> bytes:
        return self.service.files().export(fileId=item["id"], mimeType=mime_type).execute()

    def extract(self, item: dict[str, Any]) -> tuple[str | None, str | None]:
        mime = item.get("mimeType", "")
        try:
            if mime == DOC_MIME:
                return self._export(item, "text/plain").decode("utf-8", errors="replace"), None
            if mime == SHEET_MIME:
                return self._export(item, "text/csv").decode("utf-8", errors="replace"), None
            if mime in TEXT_MIMES:
                return self._download(item).decode("utf-8", errors="replace"), None
            if mime == "application/pdf":
                if not shutil.which("pdftotext"):
                    return None, "pdftotext_not_installed"
                with tempfile.TemporaryDirectory() as tmp:
                    src = Path(tmp) / "source.pdf"
                    dst = Path(tmp) / "source.txt"
                    src.write_bytes(self._download(item))
                    subprocess.run(["pdftotext", "-layout", str(src), str(dst)], capture_output=True, timeout=90, check=True)
                    return dst.read_text(encoding="utf-8", errors="replace"), None
            if mime == DOCX_MIME:
                if not shutil.which("pandoc"):
                    return None, "pandoc_not_installed"
                with tempfile.TemporaryDirectory() as tmp:
                    src = Path(tmp) / "source.docx"
                    src.write_bytes(self._download(item))
                    return command_text(["pandoc", str(src), "-t", "gfm", "--wrap=none"]), None
            if mime == SLIDE_MIME:
                if not shutil.which("pdftotext"):
                    return None, "pdftotext_not_installed"
                with tempfile.TemporaryDirectory() as tmp:
                    src = Path(tmp) / "source.pdf"
                    dst = Path(tmp) / "source.txt"
                    src.write_bytes(self._export(item, "application/pdf"))
                    subprocess.run(["pdftotext", "-layout", str(src), str(dst)], capture_output=True, timeout=90, check=True)
                    return dst.read_text(encoding="utf-8", errors="replace"), None
            return None, "unsupported_mime_type"
        except Exception as exc:
            return None, f"conversion_failed:{type(exc).__name__}"


def ensure_private_tree(root: Path) -> None:
    for path in [root, *root.rglob("*")]:
        try:
            os.chmod(path, 0o700 if path.is_dir() else 0o600)
        except FileNotFoundError:
            continue


def compile_brain(*, drive: Any, folder_id: str, project_name: str, project_slug: str,
                  brain_root: Path, template_root: Path, dry_run: bool) -> dict[str, Any]:
    folder = drive.validate_folder(folder_id)
    inventory = drive.inventory(folder_id)
    inventory.sort(key=lambda item: (str(item.get("path", "")).lower(), str(item.get("id", ""))))
    target = (brain_root / project_slug).resolve()
    brain_root_resolved = brain_root.resolve()
    if brain_root_resolved not in target.parents:
        raise ValueError("Project brain path escaped the configured brain root")
    if target.exists():
        raise FileExistsError(f"Project brain already exists: {target}")
    if not template_root.is_dir():
        raise FileNotFoundError(f"MMF project brain template not found: {template_root}")

    if dry_run:
        return {
            "ok": True, "dryRun": True, "folderId": folder_id,
            "folderName": folder.get("name"), "targetPath": str(target),
            "inventoryCount": len(inventory),
            "files": [{k: item.get(k) for k in ("id", "name", "mimeType", "modifiedTime", "path")} for item in inventory],
        }

    brain_root.mkdir(parents=True, exist_ok=True)
    os.chmod(brain_root, 0o700)
    stage = brain_root / f".{project_slug}.staging-{uuid.uuid4().hex}"
    records: list[dict[str, Any]] = []
    used_targets: set[str] = set()
    try:
        shutil.copytree(template_root, stage)
        for item in inventory:
            text, error = drive.extract(item)
            record = {k: item.get(k) for k in ("id", "name", "mimeType", "modifiedTime", "webViewLink", "path")}
            if text is None:
                record.update({"status": "skipped", "reason": error})
                records.append(record)
                continue
            normalized = normalized_text(text)
            digest = content_hash(normalized)
            relative_target = classify_target(str(item.get("name", "source")), str(item.get("path", "")), str(item["id"]))
            if relative_target.as_posix() in used_targets:
                relative_target = relative_target.with_name(
                    f"{relative_target.stem}-{str(item['id'])[:8]}{relative_target.suffix}"
                )
            used_targets.add(relative_target.as_posix())
            output = stage / relative_target
            output.parent.mkdir(parents=True, exist_ok=True)
            rendered = source_frontmatter(item, digest) + normalized
            output.write_text(rendered, encoding="utf-8")
            record.update({"status": "imported", "brainPath": relative_target.as_posix(), "contentSha256": digest})
            records.append(record)

        manifest = {
            "version": 1,
            "sourceSystem": "google_drive",
            "folderId": folder_id,
            "folderName": folder.get("name"),
            "folderUrl": folder.get("webViewLink"),
            "projectName": project_name,
            "projectSlug": project_slug,
            "importedAt": datetime.now(timezone.utc).isoformat(),
            "records": records,
        }
        context = stage / "00_project-context"
        context.mkdir(parents=True, exist_ok=True)
        (context / "drive-import-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        source_lines = ["# Google Drive source index", "", f"Source folder: [{folder.get('name', project_name)}]({folder.get('webViewLink', '')})", ""]
        for record in records:
            status = record["status"]
            source_lines.append(f"- **{record.get('name', 'Untitled')}** — `{status}` — [Drive source]({record.get('webViewLink', '')})" + (f" → `{record['brainPath']}`" if record.get("brainPath") else f" ({record.get('reason', 'unknown')})"))
        (context / "source-index.md").write_text("\n".join(source_lines) + "\n", encoding="utf-8")
        ensure_private_tree(stage)
        os.replace(stage, target)
        ensure_private_tree(target)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise

    imported = sum(1 for record in records if record["status"] == "imported")
    return {
        "ok": True, "dryRun": False, "folderId": folder_id,
        "folderName": folder.get("name"), "folderUrl": folder.get("webViewLink"),
        "targetPath": str(target), "inventoryCount": len(records),
        "importedCount": imported, "skippedCount": len(records) - imported,
        "manifestPath": str(target / "00_project-context/drive-import-manifest.json"),
        "records": records,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", required=True)
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--project-slug")
    parser.add_argument("--brain-root", required=True)
    parser.add_argument("--template-root", required=True)
    parser.add_argument("--service-account-file")
    parser.add_argument("--impersonate-user", default="chris@conversionalchemy.net")
    parser.add_argument("--fixture")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        folder_id = folder_id_from_ref(args.folder)
        project_slug = slugify(args.project_slug or args.project_name)
        drive = FixtureDrive(Path(args.fixture)) if args.fixture else GoogleDrive(Path(args.service_account_file), args.impersonate_user)
        result = compile_brain(
            drive=drive, folder_id=folder_id, project_name=args.project_name,
            project_slug=project_slug, brain_root=Path(args.brain_root).expanduser(),
            template_root=Path(args.template_root).expanduser(), dry_run=args.dry_run,
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "errorType": type(exc).__name__}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
