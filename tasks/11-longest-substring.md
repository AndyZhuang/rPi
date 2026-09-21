# Longest Substring Without Repeating Characters

Write `length_of_longest_substring(s: str) -> int` that returns the length of
the longest substring of `s` without repeating characters.

## Examples

```
length_of_longest_substring("abcabcbb") == 3   # "abc"
length_of_longest_substring("bbbbb") == 1       # "b"
length_of_longest_substring("pwwkew") == 3      # "wke"
length_of_longest_substring("") == 0
```

## Constraints

- `0 <= len(s) <= 5 * 10^4`
- ASCII; O(n) sliding window expected