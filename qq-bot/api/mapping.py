"""Aptitude format mapping between Web and Bot representations.

Web format (characters.data.attrs):
    { "专注": { "v": "8/10", "current": 8, "max": 10, "m": [3,5,7] } }

Bot format (PlayerState.aptitudes):
    { "专注": 8 }   ← corresponds to web's "current" value
"""

from __future__ import annotations

from game.models import APTITUDE_SET


def web_attrs_to_bot(web_attrs: dict) -> dict[str, int]:
    """Convert web aptitude format to bot format.

    Extracts the ``current`` value from each aptitude entry.
    Unknown aptitude names are silently ignored.
    """
    result: dict[str, int] = {}
    for name, entry in web_attrs.items():
        if name not in APTITUDE_SET:
            continue
        if isinstance(entry, dict):
            result[name] = int(entry.get("current", 0))
        elif isinstance(entry, (int, float)):
            result[name] = int(entry)
    return result


def bot_apt_to_web_attrs(bot_aptitudes: dict[str, int]) -> dict[str, int]:
    """Convert bot aptitude dict to a simple {name: value} dict for the web set-aptitudes endpoint."""
    return {name: val for name, val in bot_aptitudes.items() if name in APTITUDE_SET}
