import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "hrt", os.path.join(HERE, "hindsight-retain-tagged.py")
)
hrt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hrt)


def test_build_extra_tags_full():
    tags = hrt.build_extra_tags(user="work", project="app", base=["{session_id}"])
    assert tags == ["{session_id}", "source:claude-code", "profile:work", "project:app"]


def test_build_extra_tags_dedupes_and_skips_blanks():
    tags = hrt.build_extra_tags(user="", project="", base=["source:claude-code"])
    assert tags == ["source:claude-code"]  # no blank profile:/project:, no dup source


def test_build_extra_tags_none_base():
    tags = hrt.build_extra_tags(user="me", project="repo", base=None)
    assert tags == ["source:claude-code", "profile:me", "project:repo"]
