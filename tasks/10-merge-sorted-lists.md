# Merge Two Sorted Lists

Given two sorted lists `a` and `b` (ascending), return a single sorted list
containing all elements. Don't sort from scratch — merge.

Write `merge_lists(a: list[int], b: list[int]) -> list[int]`.

## Examples

```
merge_lists([1, 3, 5], [2, 4, 6]) == [1, 2, 3, 4, 5, 6]
merge_lists([], [1, 2]) == [1, 2]
merge_lists([1], []) == [1]
merge_lists([], []) == []
```

## Constraints

- Each list may be empty
- O(n + m) expected