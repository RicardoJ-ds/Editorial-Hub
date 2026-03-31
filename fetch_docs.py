"""
Fetch Google Docs using a service account and save their content locally.

These documents are uploaded .docx files (not native Google Docs), so we use
the Google Drive API to:
  1. Get file metadata (title, MIME type)
  2. Export native Google Docs as plain text, OR
  3. Download the original file for uploaded formats (.docx, etc.)

We also attempt to export as plain text via Drive export for .docx files
that have been opened in Google Docs.
"""

import io
import json
import os
import re

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SA_KEY_PATH = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", os.path.join(SCRIPT_DIR, "sa-key.json"))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "data")

SCOPES = [
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

DOC_IDS = os.environ.get("DOC_IDS", "").split(",") if os.environ.get("DOC_IDS") else []


def authenticate():
    """Authenticate using the service account key file."""
    credentials = service_account.Credentials.from_service_account_file(
        SA_KEY_PATH, scopes=SCOPES
    )
    return credentials


def sanitize_filename(title: str) -> str:
    """Create a safe filename from a document title."""
    safe = re.sub(r'[^\w\s-]', '', title).strip()
    safe = re.sub(r'[\s]+', '_', safe)
    return safe[:100] if safe else "untitled"


def extract_text_from_doc(document: dict) -> str:
    """Extract plain text from a Google Docs API document resource."""
    body = document.get("body", {})
    content = body.get("content", [])
    text_parts = []

    for element in content:
        if "paragraph" in element:
            paragraph = element["paragraph"]
            for para_element in paragraph.get("elements", []):
                text_run = para_element.get("textRun")
                if text_run:
                    text_parts.append(text_run.get("content", ""))
        elif "table" in element:
            table = element["table"]
            for row in table.get("tableRows", []):
                row_cells = []
                for cell in row.get("tableCells", []):
                    cell_text_parts = []
                    for cell_content in cell.get("content", []):
                        if "paragraph" in cell_content:
                            for para_element in cell_content["paragraph"].get("elements", []):
                                text_run = para_element.get("textRun")
                                if text_run:
                                    cell_text_parts.append(text_run.get("content", "").strip())
                    row_cells.append(" ".join(cell_text_parts))
                text_parts.append("\t".join(row_cells) + "\n")

    return "".join(text_parts)


def fetch_with_docs_api(docs_service, doc_id, output_dir):
    """Try fetching via the native Google Docs API. Returns True on success."""
    try:
        document = docs_service.documents().get(documentId=doc_id).execute()
        title = document.get("title", "untitled")
        print(f"  [Docs API] Title: {title}")

        json_path = os.path.join(output_dir, f"{sanitize_filename(title)}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(document, f, ensure_ascii=False, indent=2)
        print(f"  Saved JSON: {json_path}")

        text = extract_text_from_doc(document)
        txt_path = os.path.join(output_dir, f"{sanitize_filename(title)}.txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"  Saved text: {txt_path}")
        return True
    except Exception as e:
        print(f"  [Docs API] Not available: {e}")
        return False


def fetch_with_drive_api(drive_service, doc_id, output_dir):
    """Fetch via Drive API -- works for uploaded .docx and native Google Docs."""
    # Get file metadata
    file_meta = drive_service.files().get(
        fileId=doc_id, fields="id,name,mimeType"
    ).execute()
    title = file_meta.get("name", "untitled")
    mime_type = file_meta.get("mimeType", "")
    print(f"  [Drive API] Title: {title}")
    print(f"  [Drive API] MIME type: {mime_type}")

    safe_name = sanitize_filename(title)

    # Try exporting as plain text (works for Google Docs and .docx opened in Docs)
    try:
        request = drive_service.files().export_media(
            fileId=doc_id, mimeType="text/plain"
        )
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        text_content = buf.getvalue().decode("utf-8")
        txt_path = os.path.join(output_dir, f"{safe_name}.txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(text_content)
        print(f"  Saved text export: {txt_path}")
    except Exception as e:
        print(f"  [Drive API] Text export failed: {e}")

    # Also export as docx for fidelity (works for native Google Docs)
    # or download original file (for uploaded .docx)
    try:
        if "google-apps" in mime_type:
            # Native Google Doc -- export as docx
            request = drive_service.files().export_media(
                fileId=doc_id,
                mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        else:
            # Uploaded file -- download original
            request = drive_service.files().get_media(fileId=doc_id)

        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        ext = ".docx" if "word" in mime_type or "google-apps" in mime_type else os.path.splitext(title)[-1] or ".bin"
        docx_path = os.path.join(output_dir, f"{safe_name}{ext}")
        with open(docx_path, "wb") as f:
            f.write(buf.getvalue())
        print(f"  Saved original/docx: {docx_path}")
    except Exception as e:
        print(f"  [Drive API] Binary download failed: {e}")


def main():
    credentials = authenticate()
    docs_service = build("docs", "v1", credentials=credentials)
    drive_service = build("drive", "v3", credentials=credentials)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for doc_id in DOC_IDS:
        print(f"\n{'='*60}")
        print(f"Fetching document: {doc_id}")
        print(f"{'='*60}")

        # Try Docs API first; fall back to Drive API
        success = fetch_with_docs_api(docs_service, doc_id, OUTPUT_DIR)
        if not success:
            print("  Falling back to Drive API...")
            try:
                fetch_with_drive_api(drive_service, doc_id, OUTPUT_DIR)
            except Exception as e:
                print(f"  ERROR with Drive API: {e}")

    print(f"\nDone. Files saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
