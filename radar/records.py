"""Shared classification for harvested records, including older local snapshots."""


def is_container(article_type):
    # Reject explicit container metadata, not article titles or DOI patterns:
    # editorials, corrections and RSS records still belong in the reading feed.
    return str(article_type or "").strip().lower() in {
        "journal",
        "journal-volume",
        "journal-issue",
    }
