import ast
import io
import json
from pathlib import Path
import sys
import tokenize


def check(path):
    text = path.read_text()
    if path.suffix == ".json":
        json.loads(text)
        return []
    if path.suffix != ".py":
        raise ValueError("Use this adapter only for Python and JSON files.")
    errors = []
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type == tokenize.COMMENT:
            errors.append(str(path) + ":" + str(token.start[0]) + ": Remove the source comment.")
    tree = ast.parse(text)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and ast.get_docstring(node):
            errors.append(str(path) + ":" + str(node.body[0].lineno) + ": Move the prose docstring to docs.")
    return errors


def main():
    if len(sys.argv) < 2:
        raise ValueError("Pass every authored Python and JSON file.")
    errors = []
    for argument in sys.argv[1:]:
        errors.extend(check(Path(argument)))
    for error in errors:
        print(error, file=sys.stderr)
    return bool(errors)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, SyntaxError, tokenize.TokenError) as error:
        print("Source check failed: " + str(error), file=sys.stderr)
        sys.exit(1)
