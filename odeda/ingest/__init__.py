"""Ingestion: Garmin Connect, the official data-export ZIP, and raw FIT files.

All three paths land payloads in `raw_documents` first and normalise out of that, so
a parser bug is fixed by re-running `normalize`, never by re-fetching.
"""
