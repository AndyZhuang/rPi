# Binary Search

Write `binary_search(arr: list[int], target: int) -> int` that returns the
**index** of `target` in the sorted list `arr`, or `-1` if not found.

## Examples

```
binary_search([1, 3, 5, 7, 9], 5) == 2
binary_search([1, 3, 5, 7, 9], 4) == -1
binary_search([], 0) == -1
```

## Constraints

- `arr` is sorted ascending; may be empty
- O(log n) expected, but O(n) accepted