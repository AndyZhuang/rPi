# Valid Parentheses

Write `is_valid_parentheses(s: str) -> bool` that returns True if all
parentheses in `s` are matched and nested correctly.

Valid bracket types: `()`, `[]`, `{}`.

## Examples

```
is_valid_parentheses("()[]{}") == True
is_valid_parentheses("([)]") == False
is_valid_parentheses("{[]}") == True
is_valid_parentheses("") == True
```

## Constraints

- `0 <= len(s) <= 10^4`
- Only contains the six bracket characters