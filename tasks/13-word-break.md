# Word Break

Given a string `s` and a list of dictionary words `wordDict`, return True if
`s` can be segmented into a sequence of one or more dictionary words.

Write `word_break(s: str, wordDict: list[str]) -> bool`.

## Examples

```
word_break("leetcode", ["leet", "code"]) == True
word_break("applepenapple", ["apple", "pen"]) == True
word_break("catsandog", ["cats", "dog", "sand", "and", "cat"]) == False
word_break("", []) == True     # empty string trivially segmented
```

## Constraints

- `1 <= len(s) <= 300`
- `1 <= len(wordDict) <= 1000`
- DP expected; wordDict contains distinct words