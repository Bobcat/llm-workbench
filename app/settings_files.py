"""Reading the workbench's JSON settings files.

Every settings reader needs the same two steps: load a file as an object, and put one object on top
of another. Those two lived as copies in seven modules; they live here now, so a change in how a
settings file is read cannot reach six of the seven.

There are two loaders on purpose, and the difference is the point:

- :func:`load_object` is lenient. A missing file, an empty file and a file whose root is not an
  object all mean "nothing here", which is what the service settings want: they fall back to their
  own defaults and the workbench keeps working.
- :func:`load_object_or_raise` refuses a file that is not an object, and names the path. That is what
  the plugin switch wants: there a silently ignored file would drop the menu list next to it, so the
  mistake has to be loud.
"""

from __future__ import annotations

import json
from pathlib import Path


def load_object(path: Path) -> dict[str, object]:
    """One settings file as an object, or an empty one when there is nothing usable in it.

    A syntax error is not swallowed: it propagates as the decoder's own error, which is what the
    service settings have always done.
    """
    if not path.exists():
        return {}
    raw_text = path.read_text(encoding="utf-8")
    if raw_text.strip() == "":
        return {}
    payload = json.loads(raw_text)
    if not isinstance(payload, dict):
        return {}
    return dict(payload)


def load_object_or_raise(path: Path) -> dict[str, object]:
    """The same file, but a file that is not an object is an error that names the path.

    A typo in a hand-edited settings file is otherwise indistinguishable from "no switch here", and
    the reader would be looking at a workbench that quietly ignores what they wrote.
    """
    if not path.exists():
        return {}
    raw_text = path.read_text(encoding="utf-8")
    if raw_text.strip() == "":
        return {}
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise ValueError(f"{path} is not valid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def merge_objects(base: dict[str, object], override: dict[str, object]) -> dict[str, object]:
    """The override on top of the base; nested objects merge, anything else replaces."""
    merged: dict[str, object] = dict(base)
    for key, value in override.items():
        base_value = merged.get(key)
        if isinstance(base_value, dict) and isinstance(value, dict):
            merged[key] = merge_objects(base_value, value)
        else:
            merged[key] = value
    return merged
