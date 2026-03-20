from datetime import datetime
from flask import Flask, jsonify, render_template, request, send_file
from io import BytesIO

from formatter import analyze_text, build_docx_bytes, render_preview


app = Flask(__name__)


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/api/format", methods=["POST"])
def format_text():
    payload = request.get_json(silent=True) or {}
    raw_text = payload.get("text", "")
    structured = analyze_text(raw_text)
    preview_text = render_preview(structured)
    return jsonify(
        {
            "structured": structured,
            "preview_text": preview_text,
        }
    )


@app.route("/api/format/docx", methods=["POST"])
def export_docx():
    payload = request.get_json(silent=True) or {}
    raw_text = payload.get("text", "")
    structured = analyze_text(raw_text)
    docx_bytes = build_docx_bytes(structured)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"formatted_{timestamp}.docx"
    stream = BytesIO(docx_bytes)
    stream.seek(0)

    return send_file(
        stream,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
